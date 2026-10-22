import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { checksum } from "../../packages/cli/src/runtime.mjs";
import { requireValue } from "../../packages/cli/src/messages.mjs";

requireValue(process.env.GITHUB_ACTIONS === "true", "La prueba del paquete compilado se ejecuta en GitHub Actions.", "Compiled package smoke testing runs in GitHub Actions.");
const artifact = process.argv[2];
const expected = (await readFile(new URL("../../.release/artifact.sha256", import.meta.url), "utf8")).trim();
requireValue(checksum(await readFile(artifact)) === expected, "El paquete cambió después de validarlo.", "The package changed after validation.");
const directory = await mkdtemp(join(tmpdir(), "monitor-package-"));
try {
  execFileSync("npm", ["install", "--prefix", directory, "--ignore-scripts", "--no-audit", "--no-fund", artifact], { stdio: "inherit" });
  const pkg = join(directory, "node_modules/@am25/monitor");
  execFileSync(process.execPath, [join(pkg, "bin/monitor.mjs"), "--help"], { cwd: directory, stdio: "inherit" });
  const { verifyRuntime, baseConfig } = await import(pathToFileURL(join(pkg, "src/runtime.mjs")));
  await verifyRuntime(join(pkg, "runtime"));
  const { writeJson } = await import(pathToFileURL(join(pkg, "src/store.mjs")));
  const config = baseConfig();
  config.main = join(pkg, "runtime/worker/index.js");
  config.assets.directory = join(pkg, "runtime/assets");
  config.d1_databases[0].migrations_dir = join(pkg, "runtime/migrations");
  const path = join(directory, "wrangler.json");
  await writeJson(path, config);
  const { wrangler } = await import(pathToFileURL(join(pkg, "src/process.mjs")));
  await wrangler(["deploy", "--dry-run", "--no-bundle", "--config", path], { cwd: directory });
} finally { await rm(directory, { recursive: true, force: true }); }
