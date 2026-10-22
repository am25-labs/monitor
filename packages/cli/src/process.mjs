import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { CliError } from "./messages.mjs";

export async function run(command, args, { cwd, env = process.env, capture = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit", shell: false });
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += chunk;
      if (output.length > 8 * 1024 * 1024) child.kill();
    });
    child.stderr?.resume();
    child.on("error", () => reject(new CliError(`No se pudo ejecutar ${command}.`, `Could not run ${command}.`)));
    child.on("close", (code) => code === 0 ? resolve(output) : reject(new CliError(`Falló ${command}. La operación quedó registrada para reanudarla.`, `${command} failed. Operation progress was saved for resuming.`)));
  });
}

export async function wrangler(args, { token, accountId, cwd, capture = true } = {}) {
  const require = createRequire(import.meta.url);
  const bin = join(dirname(require.resolve("wrangler/package.json")), "bin/wrangler.js");
  try { return await run(process.execPath, [bin, ...args], {
    cwd,
    capture,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_KEY: undefined, CLOUDFLARE_EMAIL: undefined,
      WRANGLER_SEND_METRICS: "false", CI: "true", NO_COLOR: "1" }
  }); } catch {
    const step = `Wrangler ${args[0]}${args[0] === "d1" ? ` ${args[1]}` : ""}`;
    throw new CliError(`Falló ${step}. Revisá permisos, conexión y configuración. Podés reanudar con el mismo comando.`, `${step} failed. Check permissions, connectivity and configuration. Resume using the same command.`);
  }
}
