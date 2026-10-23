import { parseArgs } from "node:util";
import { randomBytes } from "node:crypto";
import { join, resolve } from "node:path";
import { Store, readJson, writeJson } from "./store.mjs";
import { Prompts } from "./prompts.mjs";
import { CliError, translator, requireValue } from "./messages.mjs";
import { Cloudflare } from "./cloudflare.mjs";
import { packageRoot, runtimeRoot, compareVersions, stageRuntime, verifyRuntime } from "./runtime.mjs";
import { run, wrangler } from "./process.mjs";
import { preflight, provision, zeroTrust } from "./infrastructure.mjs";
import { publishInstallation } from "./operations.mjs";
import { doctor } from "./doctor.mjs";
import { adopt } from "./adoption.mjs";

export function argumentsFor(args) {
  let parsed;
  try {
    parsed = parseArgs({ args, allowPositionals: true, options: { cwd: { type: "string" }, language: { type: "string" }, adopt: { type: "boolean" }, help: { type: "boolean", short: "h" }, version: { type: "boolean", short: "v" } } });
  } catch { throw new CliError("Argumentos desconocidos. Consultá --help.", "Unknown arguments. See --help."); }
  const [command, target, ...extra] = parsed.positionals;
  requireValue(!extra.length && (command === "init" || !target), "Solo init acepta un directorio posicional. Usá --cwd con los demás comandos.", "Only init accepts a positional directory. Use --cwd with other commands.");
  requireValue(!parsed.values.language || ["es", "en"].includes(parsed.values.language), "El idioma debe ser es o en.", "Language must be es or en.");
  requireValue(!parsed.values.adopt || command === "init", "--adopt solo se admite con init.", "--adopt is only supported by init.");
  return { command, target, ...parsed.values };
}

async function tokenFor(ui) {
  if (process.env.CLOUDFLARE_API_TOKEN?.trim()) return process.env.CLOUDFLARE_API_TOKEN.trim();
  ui.log("Creá un API Token limitado a tu cuenta y zona. Permisos y pasos: https://github.com/am25-labs/monitor/blob/main/docs/cli/es.md", "Create an API token scoped to your account and zone. Permissions and steps: https://github.com/am25-labs/monitor/blob/main/docs/cli/en.md");
  const token = await ui.secret("API Token de Cloudflare", "Cloudflare API token");
  requireValue(token.length > 0 && !/\s/.test(token), "Token inválido.", "Invalid token.");
  return token;
}

async function collectSetup(cf, store, state, ui) {
  if (state.accountId) return;
  const accounts = await cf.list("/accounts");
  state.accountId = await ui.choose("Cuenta de Cloudflare", "Cloudflare account", accounts.map((account) => ({ label: `${account.name} (${account.id})`, value: account.id })));
  const zones = await cf.list(`/zones?account.id=${encodeURIComponent(state.accountId)}&status=active`);
  const zone = await ui.choose("Zona DNS activa", "Active DNS zone", zones.map((item) => ({ label: item.name, value: item })));
  state.zoneId = zone.id;
  state.hostname = (await ui.text("Hostname dedicado", "Dedicated hostname", { fallback: `monitor.${zone.name}`, validate: (value) => value.length <= 253 && /^(?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,}$/i.test(value) && value.toLowerCase().endsWith(`.${zone.name}`) })).toLowerCase();
  state.name = await ui.text("Nombre del Worker", "Worker name", { fallback: "my-monitor", validate: (value) => /^[a-z\d][a-z\d-]{0,62}$/.test(value) });
  state.databaseName = `${state.name}-db`;
  state.queueName = `${state.name}-checks`;
  const email = await ui.text("Correo del propietario para iniciar sesión", "Owner email for sign-in", { validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) });
  await writeJson(store.secretsPath, { CONFIG_KEY: randomBytes(32).toString("hex"), ACCESS_EMAIL: email });
  await store.save(state);
}

export async function install({ store, state, cf, ui, source, execute, credentials }) {
  if (state.phase === "ready" && !state.operation) {
    ui.log("Esta instalación ya está lista. Usá deploy, update o doctor.", "This installation is already ready. Use deploy, update or doctor.");
    return;
  }
  const manifest = await verifyRuntime(source);
  requireValue(!state.targetVersion || state.targetVersion === manifest.version, "Reanudá init usando la misma versión del paquete.", "Resume init using the same package version.");
  state.targetVersion = manifest.version;
  await collectSetup(cf, store, state, ui);
  state.teamDomain = await zeroTrust(cf, state, ui);
  const { providers } = await preflight(cf, state);
  const release = await stageRuntime(store, source);
  ui.log(`Cuenta: ${state.accountId}\nDominio: ${state.hostname}\nWorker: ${state.name}\nD1: ${state.databaseName}\nQueue: ${state.queueName}\nAccess: ${state.name} dashboard`,
    `Account: ${state.accountId}\nDomain: ${state.hostname}\nWorker: ${state.name}\nD1: ${state.databaseName}\nQueue: ${state.queueName}\nAccess: ${state.name} dashboard`);
  await ui.confirm("¿Crear los recursos pendientes y publicar Monitor?", "Create pending resources and publish Monitor?");
  await store.save(state);
  await provision(cf, store, state, providers, await store.secrets());
  await publishInstallation({ store, state, release, cf, execute, credentials, ui, kind: "init" });
}

export async function main(args = process.argv.slice(2)) {
  let language = args.includes("en") && args.includes("--language") ? "en" : "es";
  let unlock;
  try {
    const options = argumentsFor(args);
    const pkg = await readJson(join(packageRoot, "package.json"));
    if (options.version) { console.log(pkg.version); return; }
    if (options.help || !options.command) {
      console.log("@am25/monitor\n\n  init [directory] [--adopt]\n  deploy [--cwd directory]\n  doctor [--cwd directory]\n  update [--cwd directory]\n\n  --language es|en  --help  --version");
      return;
    }
    requireValue(["init", "deploy", "doctor", "update"].includes(options.command), "Comando desconocido. Consultá --help.", "Unknown command. See --help.");
    requireValue(process.versions.node === pkg.engines.node, `Se requiere Node.js ${pkg.engines.node}.`, `Node.js ${pkg.engines.node} is required.`);
    if (options.command !== "doctor") {
      const agentVersion = process.env.npm_config_user_agent?.match(/(?:^|\s)pnpm\/(\d+\.\d+\.\d+)(?:\s|$)/)?.[1];
      const pnpmVersion = agentVersion ?? (await run(process.platform === "win32" ? "cmd.exe" : "pnpm", process.platform === "win32" ? ["/d", "/s", "/c", "pnpm --version"] : ["--version"], { capture: true })).trim();
      requireValue(compareVersions(pnpmVersion, "10.23.0") >= 0, "Se requiere pnpm 10.23 o superior.", "pnpm 10.23 or newer is required.");
    }
    const directory = resolve(options.cwd ?? ".", options.target ?? ".");
    const store = new Store(directory);
    if (options.command === "init") {
      const manifest = await verifyRuntime(runtimeRoot);
      requireValue(manifest.version === pkg.version, "La versión de CLI no coincide con el runtime.", "CLI version does not match runtime.");
      await store.initialize();
    }
    let state = await store.load();
    language = options.language ?? state.language ?? language;
    let ui = new Prompts(language);
    if (options.command === "init" && !options.language && !state.language) {
      language = await ui.choose("Idioma / Language", "Idioma / Language", [{ label: "Español", value: "es" }, { label: "English", value: "en" }]);
      ui = new Prompts(language);
    }
    if (options.command !== "doctor") {
      unlock = await store.lock();
      state = await store.load();
      state.language = language;
      requireValue(!state.mode || state.mode === (options.adopt ? "adopt" : "install") || options.command !== "init", "Esta carpeta tiene otro tipo de instalación en curso.", "This directory has another installation mode in progress.");
      if (options.command === "init") state.mode = options.adopt ? "adopt" : "install";
      await store.save(state);
    }
    const token = await tokenFor(ui);
    const cf = new Cloudflare(token);
    const credentials = { token, accountId: state.accountId, cwd: store.directory };
    const execute = (commandArgs) => wrangler(commandArgs, { ...credentials, accountId: state.accountId });
    const context = { store, state, cf, ui, source: runtimeRoot, execute, credentials };
    if (options.command === "init") {
      if (options.adopt) await adopt(context);
      else await install(context);
    } else if (options.command !== "doctor") {
      requireValue(state.phase === "ready" || Boolean(state.operation && state.deployedVersion), "La instalación todavía no está lista. Reanudá init.", "Installation is not ready. Resume init.");
      const source = options.command === "update" ? runtimeRoot : join(store.directory, "releases", state.deployedVersion);
      const release = await stageRuntime(store, source);
      ui.log(`${state.hostname}: ${state.deployedVersion} → ${release.manifest.version}`);
      await ui.confirm("¿Respaldar, migrar y desplegar esta instalación?", "Back up, migrate and deploy this installation?");
      await publishInstallation({ ...context, release, kind: options.command });
    }
    const valid = await doctor(context);
    ui.log(`Dashboard: https://${state.hostname}/app/`);
    ui.log("Respaldá .monitor/secrets.json de forma segura. Contiene la llave necesaria para descifrar las credenciales. Configurá los canales de alertas desde el dashboard.", "Back up .monitor/secrets.json securely. It contains the key needed to decrypt credentials. Configure alert channels from the dashboard.");
    if (!valid) process.exitCode = 1;
  } catch (error) {
    const t = translator(language);
    console.error(error instanceof CliError ? t(error.es, error.en) : t("La operación falló. Revisá conectividad, permisos y archivos de instalación; no compartás secretos en reportes.", "Operation failed. Check connectivity, permissions and installation files; do not include secrets in reports."));
    process.exitCode = 1;
  } finally { await unlock?.(); }
}
