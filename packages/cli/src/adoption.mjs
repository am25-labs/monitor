import { resolve } from "node:path";
import { readJson, writeJson } from "./store.mjs";
import { inspectResources, appOverlaps } from "./infrastructure.mjs";
import { publishInstallation, remoteRelease } from "./operations.mjs";
import { baseConfig, compareVersions, sameJson, stageRuntime } from "./runtime.mjs";
import { requireValue } from "./messages.mjs";

export function selectAccessApp(apps, state, audience) {
  const overlapping = apps.filter((app) => appOverlaps(app, state));
  requireValue(overlapping.length > 0,
    `El token devolvió ${apps.length} aplicaciones de Access, pero ninguna protege ${state.hostname}. Revisá la cuenta y el acceso del token a esa aplicación.`,
    `The token returned ${apps.length} Access applications, but none protect ${state.hostname}. Check the account and token access to that application.`);
  requireValue(overlapping.length === 1,
    `Se encontraron ${overlapping.length} aplicaciones de Access superpuestas con ${state.hostname}: ${overlapping.map((app) => app.id).join(", ")}.`,
    `Found ${overlapping.length} Access applications overlapping ${state.hostname}: ${overlapping.map((app) => app.id).join(", ")}.`);
  const app = overlapping[0];
  requireValue(app.aud === audience,
    `La audiencia de Access de la aplicación ${app.id} no coincide con ACCESS_AUDIENCES del archivo original.`,
    `Access audience for application ${app.id} does not match ACCESS_AUDIENCES in the original file.`);
  return app;
}

export async function verifyPublishedRelease(manifest, fetcher = fetch) {
  const response = await fetcher(`https://registry.npmjs.org/@am25%2fmonitor/${manifest.version}`, { signal: AbortSignal.timeout(15000) });
  requireValue(response.ok, "La versión debe estar publicada en npm antes de adoptar la instalación.", "The version must be published to npm before adopting the installation.");
  const published = await response.json();
  requireValue(published.name === "@am25/monitor" && published.version === manifest.version && published.gitHead === manifest.sourceSha
    && Boolean(published.dist?.attestations?.provenance), "La versión publicada, su commit o su provenance no coincide.", "Published version, commit or provenance does not match.");
  return published;
}

export async function verifyEncryptionKey(cf, state, key) {
  const rows = await cf.query(state, "SELECT id,config AS value FROM monitors LIMIT 1");
  let sample = rows[0], context = sample?.id;
  if (!sample) {
    const settings = await cf.query(state, "SELECT value FROM app_settings WHERE id='notifications'");
    sample = settings[0];
    context = "settings:notifications";
  }
  if (!sample) return false;
  try {
    const payload = JSON.parse(sample.value);
    const imported = await crypto.subtle.importKey("raw", Buffer.from(key, "hex"), "AES-GCM", false, ["decrypt"]);
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(payload.iv), additionalData: new TextEncoder().encode(context) }, imported, new Uint8Array(payload.data));
    return true;
  } catch {
    requireValue(false, "La llave no descifra los datos existentes. Recuperá la llave original; no se modificó producción.", "The key cannot decrypt existing data. Recover the original key; production was not modified.");
  }
}

export async function adopt({ store, state, cf, ui, source, execute, credentials, fetcher = fetch }) {
  if (state.adoption) {
    const release = await stageRuntime(store, source);
    await publishInstallation({ store, state, cf, ui, release, execute, credentials, kind: "adopt" });
    ui.log("Instalación adoptada. Ya podés administrarla desde esta carpeta.", "Installation adopted. You can now manage it from this directory.");
    return state;
  }
  if (state.phase === "ready") return state;
  const configPath = await ui.text("Ruta al wrangler.jsonc original (JSON sin comentarios)", "Path to the original wrangler.jsonc (JSON without comments)", { fallback: resolve("wrangler.jsonc") });
  const config = await readJson(configPath);
  requireValue(/^[a-f\d]{32}$/i.test(config.account_id ?? "") && /^[a-z\d][a-z\d-]{0,62}$/.test(config.name ?? ""), "Cuenta o nombre de Worker inválidos.", "Invalid account or Worker name.");
  const hostname = config.routes?.[0]?.pattern;
  requireValue(config.routes?.length === 1 && config.routes[0].custom_domain === true && config.vars?.APP_ORIGIN === `https://${hostname}` && config.vars.ENVIRONMENT === "production"
    && config.workers_dev === false && config.preview_urls === false, "La configuración debe corresponder a una instalación de Monitor con un Custom Domain dedicado.", "Configuration must describe a Monitor installation with one dedicated Custom Domain.");
  const reference = baseConfig();
  requireValue(sameJson(config.durable_objects, reference.durable_objects) && sameJson(config.migrations, reference.migrations)
    && sameJson(config.triggers, reference.triggers), "La configuración de Durable Objects o cron está personalizada. La adopción automática no puede reemplazarla.", "Durable Objects or cron configuration is customized. Automatic adoption cannot replace it.");
  const allowed = new Set([...Object.keys(reference), "$schema", "account_id", "routes"]);
  const allowedVars = new Set(["ENVIRONMENT", "APP_ORIGIN", "ACCESS_TEAM_DOMAIN", "ACCESS_AUDIENCES", "MONITOR_VERSION", "MONITOR_SOURCE_SHA"]);
  requireValue(Object.keys(config).every((key) => allowed.has(key)) && Object.keys(config.vars).every((key) => allowedVars.has(key))
    && config.compatibility_date === reference.compatibility_date && sameJson(config.compatibility_flags, reference.compatibility_flags)
    && config.assets?.binding === "ASSETS" && config.assets.run_worker_first === true
    && sameJson(config.secrets, reference.secrets)
    && sameJson(config.observability, reference.observability),
    "Hay personalizaciones de configuración que requieren conciliación manual antes de adoptar.", "Configuration customizations require manual reconciliation before adoption.");
  const databases = config.d1_databases ?? [], producers = config.queues?.producers ?? [], consumers = config.queues?.consumers ?? [];
  requireValue(databases.length === 1 && databases[0].binding === "DB" && producers.length === 1 && producers[0].binding === "CHECKS"
    && consumers.length === 1 && consumers[0].queue === producers[0].queue, "Bindings de Monitor no reconocidos.", "Unrecognized Monitor bindings.");
  const normalizedQueue = { ...consumers[0], queue: "monitor-checks" };
  requireValue(sameJson(normalizedQueue, reference.queues.consumers[0]), "La cola tiene ajustes personalizados que deben conciliarse manualmente.", "Custom queue settings require manual reconciliation.");
  state.accountId = config.account_id;
  state.name = config.name;
  state.hostname = hostname;
  state.teamDomain = config.vars.ACCESS_TEAM_DOMAIN;
  state.databaseName = databases[0].database_name;
  state.queueName = producers[0].queue;
  const domains = await cf.list(cf.account(state, "/workers/domains"));
  const domain = domains.find((item) => item.hostname === hostname && item.service === state.name);
  requireValue(Boolean(domain), "El dominio no está conectado al Worker indicado.", "The domain is not connected to this Worker.");
  state.zoneId = domain.zone_id;
  const apps = await cf.list(cf.account(state, "/access/apps"));
  const app = selectAccessApp(apps, state, config.vars.ACCESS_AUDIENCES);
  requireValue(app.allowed_idps?.length === 1, "Access debe usar únicamente One-time PIN.", "Access must use only One-time PIN.");
  const queues = await cf.list(cf.account(state, "/queues"));
  const queue = queues.find((item) => item.queue_name === state.queueName);
  requireValue(Boolean(queue), "No se encontró la cola de la instalación.", "Installation queue was not found.");
  state.resources = { database: { id: databases[0].database_id, name: state.databaseName }, queue: { id: queue.queue_id, name: state.queueName }, access: { id: app.id, aud: app.aud }, identityProvider: app.allowed_idps[0] };
  const email = process.env.ACCESS_EMAIL?.trim() || await ui.text("Correo del propietario autorizado en Access", "Owner email authorized in Access", { validate: (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) });
  const key = process.env.MONITOR_CONFIG_KEY?.trim() || await ui.secret("Llave CONFIG_KEY original de producción", "Original production CONFIG_KEY");
  requireValue(/^[a-f\d]{64}$/i.test(key), "La llave debe contener 64 caracteres hexadecimales.", "The key must contain 64 hexadecimal characters.");
  const secrets = { CONFIG_KEY: key, ACCESS_EMAIL: email };
  const remote = await inspectResources(cf, state, secrets);
  const actual = remoteRelease(remote.settings);
  const release = await stageRuntime(store, source);
  if (actual.version) requireValue(compareVersions(release.manifest.version, actual.version) >= 0, "La adopción no permite instalar una versión anterior a la publicada.", "Adoption cannot install a version older than the deployed release.");
  await verifyPublishedRelease(release.manifest, fetcher);
  const applied = await cf.query(state, "SELECT name FROM d1_migrations ORDER BY name");
  const expected = Object.keys(release.manifest.files).filter((name) => name.startsWith("migrations/")).map((name) => name.slice("migrations/".length)).sort();
  requireValue(JSON.stringify(applied.map((row) => row.name).sort()) === JSON.stringify(expected), "Las migraciones remotas no corresponden a la versión publicada.", "Remote migrations do not match the published release.");
  const verified = await verifyEncryptionKey(cf, state, key);
  if (!verified) await ui.confirm("No hay datos cifrados para verificar la llave. ¿Confirmás que es la llave original respaldada?", "There is no encrypted data to verify the key. Do you confirm this is the original backed-up key?");
  ui.log(`Adoptar: ${state.name} · ${state.hostname} · ${state.accountId}`, `Adopt: ${state.name} · ${state.hostname} · ${state.accountId}`);
  await ui.confirm(`¿Respaldar y adoptar esta instalación publicando Monitor ${release.manifest.version} sobre sus mismos recursos?`, `Back up and adopt this installation by deploying Monitor ${release.manifest.version} to its existing resources?`);
  state.deployedVersion = actual.version;
  state.sourceSha = actual.sourceSha;
  state.resources.namespaces = remote.namespaces;
  state.phase = "adopting";
  state.adopted = true;
  state.adoption = { target: release.manifest.version, sourceSha: release.manifest.sourceSha, observed: actual };
  await writeJson(store.secretsPath, secrets);
  await store.save(state);
  await publishInstallation({ store, state, cf, ui, release, execute, credentials, kind: "adopt" });
  ui.log("Instalación adoptada. Ya podés administrarla desde esta carpeta.", "Installation adopted. You can now manage it from this directory.");
  return state;
}
