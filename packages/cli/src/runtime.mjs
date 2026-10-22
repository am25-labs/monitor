import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { exists, readJson, writeJson } from "./store.mjs";
import { requireValue } from "./messages.mjs";

export const packageRoot = fileURLToPath(new URL("../", import.meta.url));
export const runtimeRoot = join(packageRoot, "runtime");
export const privatePaths = ["/app", "/app/*", "/api/v1/admin", "/api/v1/admin/*"];

export function versionParts(value) {
  requireValue(/^\d+\.\d+\.\d+$/.test(value ?? ""), "La versión debe tener formato X.Y.Z estable.", "Version must use stable X.Y.Z format.");
  return value.split(".").map(Number);
}

export function compareVersions(a, b) {
  const left = versionParts(a), right = versionParts(b);
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] > right[index] ? 1 : -1;
  return 0;
}

export function safePath(root, name) {
  const path = resolve(root, name);
  const local = relative(root, path);
  requireValue(name && !isAbsolute(name) && local && !local.startsWith("..") && !local.includes("\\"), "El paquete contiene una ruta inválida.", "The package contains an invalid path.");
  return path;
}

export async function filesIn(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    requireValue(!entry.isSymbolicLink(), "El paquete no debe contener enlaces simbólicos.", "The package must not contain symbolic links.");
    if (entry.isDirectory()) result.push(...await filesIn(root, name));
    else if (entry.isFile()) result.push(name);
    else requireValue(false, "Tipo de archivo de paquete no permitido.", "Unsupported package file type.");
  }
  return result.sort();
}

export function checksum(value) { return createHash("sha256").update(value).digest("hex"); }

export function sameJson(left, right) {
  const normalized = (value) => Array.isArray(value) ? value.map(normalized)
    : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, normalized(value[key])])) : value;
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
}

export async function verifyRuntime(directory) {
  requireValue(await exists(join(directory, "manifest.json")), "No hay un runtime publicado. Instalá una versión oficial de @am25/monitor.", "No published runtime found. Install an official @am25/monitor release.");
  const manifest = await readJson(join(directory, "manifest.json"));
  versionParts(manifest.version);
  requireValue(manifest.format === 1 && /^[a-f\d]{40}$/.test(manifest.sourceSha ?? "") && Array.isArray(manifest.compatibleFrom) && manifest.files && typeof manifest.files === "object", "Manifiesto de versión inválido.", "Invalid release manifest.");
  manifest.compatibleFrom.forEach(versionParts);
  const files = (await filesIn(directory)).filter((name) => name !== "manifest.json");
  requireValue(JSON.stringify(files) === JSON.stringify(Object.keys(manifest.files).sort()), "El contenido de la versión no coincide con su manifiesto.", "Release contents do not match the manifest.");
  for (const name of files) {
    requireValue(checksum(await readFile(safePath(directory, name))) === manifest.files[name], "Falló la verificación de integridad del paquete.", "Package integrity verification failed.");
  }
  requireValue(files.includes("worker/index.js") && files.includes("assets/index.html") && files.includes("config.json") && files.some((name) => /^migrations\/.*\.sql$/.test(name)), "La versión está incompleta.", "The release is incomplete.");
  return manifest;
}

export async function stageRuntime(store, source = runtimeRoot) {
  const manifest = await verifyRuntime(source);
  const destination = join(store.directory, "releases", manifest.version);
  if (await exists(destination)) {
    requireValue(checksum(await readFile(join(destination, "manifest.json"))) === checksum(await readFile(join(source, "manifest.json"))), "La versión guardada tiene otro manifiesto. Recuperá el paquete oficial.", "Stored version has a different manifest. Recover the official package.");
    await verifyRuntime(destination);
    return { manifest, directory: destination };
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    await cp(source, temporary, { recursive: true, errorOnExist: true, force: false });
    await verifyRuntime(temporary);
    await rename(temporary, destination);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  return { manifest, directory: destination };
}

export function baseConfig() {
  return {
    name: "monitor", main: "worker/index.js", compatibility_date: "2026-10-10", compatibility_flags: ["nodejs_compat"],
    workers_dev: false, preview_urls: false,
    secrets: { required: ["CONFIG_KEY", "ACCESS_EMAIL"] },
    assets: { directory: "assets", binding: "ASSETS", run_worker_first: true },
    vars: { ENVIRONMENT: "production" },
    d1_databases: [{ binding: "DB", database_name: "monitor", database_id: "00000000-0000-0000-0000-000000000000", migrations_dir: "migrations" }],
    queues: {
      producers: [{ binding: "CHECKS", queue: "monitor-checks" }],
      consumers: [{ queue: "monitor-checks", max_batch_size: 5, max_batch_timeout: 0, max_concurrency: 20, max_retries: 3 }]
    },
    triggers: { crons: ["* * * * *"] }, observability: { enabled: true, head_sampling_rate: 1 },
    durable_objects: { bindings: [{ name: "SCHEDULER", class_name: "MonitorScheduler" }, { name: "CHECK_RUNNERS", class_name: "MonitorRunner" }] },
    migrations: [{ tag: "scheduler-1", new_sqlite_classes: ["MonitorScheduler"] }, { tag: "runners-1", new_sqlite_classes: ["MonitorRunner"] }]
  };
}

export async function configuration(state, release) {
  const config = await readJson(join(release.directory, "config.json"));
  const { database, queue } = state.resources;
  config.name = state.name;
  config.account_id = state.accountId;
  config.main = join(release.directory, "worker/index.js");
  config.assets.directory = join(release.directory, "assets");
  config.routes = [{ pattern: state.hostname, custom_domain: true, zone_id: state.zoneId }];
  config.vars = { ...config.vars, APP_ORIGIN: `https://${state.hostname}`, ACCESS_TEAM_DOMAIN: state.teamDomain,
    ACCESS_AUDIENCES: state.resources.access.aud, MONITOR_VERSION: release.manifest.version, MONITOR_SOURCE_SHA: release.manifest.sourceSha };
  config.d1_databases = [{ binding: "DB", database_name: database.name, database_id: database.id, migrations_dir: join(release.directory, "migrations") }];
  config.queues.producers[0].queue = queue.name;
  config.queues.consumers[0].queue = queue.name;
  return config;
}

export async function writeConfiguration(store, state, release) {
  const path = join(store.directory, "deploy.json");
  await writeJson(path, await configuration(state, release));
  return path;
}

export function checkUpgrade(current, target) {
  requireValue(compareVersions(target.version, current.version) >= 0, "No se permiten downgrades.", "Downgrades are not supported.");
  requireValue(target.version === current.version || target.compatibleFrom.includes(current.version), "Este salto de versión no es compatible. Consultá las notas de la versión.", "This upgrade path is unsupported. Read the release notes.");
  for (const [name, hash] of Object.entries(current.files)) {
    if (name.startsWith("migrations/")) requireValue(target.files[name] === hash, "La actualización cambia migraciones existentes y requiere intervención manual.", "The update changes existing migrations and requires manual intervention.");
  }
}
