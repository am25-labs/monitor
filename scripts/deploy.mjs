import { spawnSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allowed, deploySteps } from "./pipeline.mjs";
export function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env
  });
  if (result.error || result.status !== 0)
    throw new Error(`Deployment step failed: ${command}`);
}
if (
  process.argv[1] &&
  import.meta.url === new URL(process.argv[1], "file:").href
) {
  if (!allowed(process.env))
    throw new Error(
      "Production deploys require a GitHub Actions push on main."
    );
  const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8"));
  if (!config.vars.ACCESS_AUDIENCES)
    throw new Error("Configure Access before deployment.");
  for (const name of [
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "MONITOR_CONFIG_KEY",
    "ACCESS_EMAIL"
  ])
    if (!process.env[name])
      throw new Error(`Missing deployment setting: ${name}`);
  if (!/^[a-f\d]{64}$/i.test(process.env.MONITOR_CONFIG_KEY))
    throw new Error("Invalid encryption key.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(process.env.ACCESS_EMAIL.trim()))
    throw new Error("Invalid access email.");
  const directory = mkdtempSync(join(tmpdir(), "monitor-secrets-"));
  try {
    deploySteps(run, () => {
      const path = join(directory, "secrets.json");
      writeFileSync(
        path,
        JSON.stringify({
          CONFIG_KEY: process.env.MONITOR_CONFIG_KEY,
          ACCESS_EMAIL: process.env.ACCESS_EMAIL.trim()
        }),
        { mode: 0o600 }
      );
      return path;
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
