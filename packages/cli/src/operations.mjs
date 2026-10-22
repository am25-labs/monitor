import { chmod, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { exists, writeJson } from "./store.mjs";
import { checkUpgrade, verifyRuntime, writeConfiguration } from "./runtime.mjs";
import { inspectResources } from "./infrastructure.mjs";
import { requireValue } from "./messages.mjs";

export function remoteRelease(settings) {
  const value = (name) => settings.bindings?.find((binding) => binding.name === name && binding.type === "plain_text")?.text;
  return { version: value("MONITOR_VERSION") ?? null, sourceSha: value("MONITOR_SOURCE_SHA") ?? null };
}

async function backup(store, state, config, execute, credentials) {
  const directory = join(store.directory, "backups", `${new Date().toISOString().replaceAll(":", "-")}-${randomUUID()}`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeJson(join(directory, "installation.json"), state);
  await writeJson(join(directory, "secrets.json"), await store.secrets());
  await writeJson(join(directory, "deploy.json"), JSON.parse(await readFile(config, "utf8")));
  const output = join(directory, "database.sql");
  await execute(["d1", "export", "DB", "--remote", "--config", config, "--output", output], credentials);
  requireValue(await exists(output) && (await stat(output)).size > 0, "El respaldo de D1 no se completó. No se aplicaron migraciones.", "D1 backup did not complete. No migrations were applied.");
  await chmod(output, 0o600);
  return directory;
}

export async function publishInstallation({ store, state, release, cf, execute, credentials, ui, kind }) {
  const secrets = await store.secrets();
  requireValue(!state.pending, "Hay un recurso con creación sin confirmar. Revisá doctor antes de desplegar.", "A resource creation is unconfirmed. Review doctor before deploying.");
  const currentDirectory = !state.adoption && state.deployedVersion ? join(store.directory, "releases", state.deployedVersion) : null;
  if (state.adoption) {
    requireValue(kind === "adopt" && state.adoption.target === release.manifest.version && state.adoption.sourceSha === release.manifest.sourceSha,
      "Reanudá la adopción con la misma versión de la CLI.", "Resume adoption with the same CLI version.");
    const remote = await inspectResources(cf, state, secrets);
    const actual = remoteRelease(remote.settings);
    const unchanged = actual.version === state.adoption.observed.version && actual.sourceSha === state.adoption.observed.sourceSha;
    const published = state.operation?.publishing && actual.version === release.manifest.version && actual.sourceSha === release.manifest.sourceSha;
    requireValue(unchanged || published, "La instalación cambió durante la adopción. Revisá el diagnóstico antes de continuar.", "The installation changed during adoption. Review diagnostics before continuing.");
  } else if (currentDirectory) {
    const current = await verifyRuntime(currentDirectory);
    checkUpgrade(current, release.manifest);
    const remote = await inspectResources(cf, state, secrets);
    const actual = remoteRelease(remote.settings);
    const matchesCurrent = actual.version === state.deployedVersion && actual.sourceSha === state.sourceSha;
    const matchesPending = state.operation?.publishing && actual.version === release.manifest.version && actual.sourceSha === release.manifest.sourceSha;
    requireValue(matchesCurrent || matchesPending, "La versión remota cambió fuera de la CLI. Revisá la instalación antes de continuar.", "The remote version changed outside the CLI. Review the installation before continuing.");
  } else await inspectResources(cf, state, secrets, { worker: false });
  if (state.operation) {
    requireValue(state.operation.kind === kind && state.operation.target === release.manifest.version && state.operation.sourceSha === release.manifest.sourceSha,
      "Hay otra operación pendiente. Reanudala con el mismo comando y versión del paquete.", "Another operation is pending. Resume using the same command and package version.");
  } else {
    state.operation = { kind, target: release.manifest.version, sourceSha: release.manifest.sourceSha, startedAt: new Date().toISOString() };
    await store.save(state);
  }
  const config = await writeConfiguration(store, state, release);
  if ((state.deployedVersion || state.adoption) && !state.operation.backup) {
    ui.log("Guardando respaldo de configuración y D1…", "Backing up configuration and D1…");
    const previous = state.adoption ? release : { manifest: await verifyRuntime(currentDirectory), directory: currentDirectory };
    const previousConfig = await writeConfiguration(store, state, previous);
    state.operation.backup = await backup(store, state, previousConfig, execute, credentials);
    await store.save(state);
    await writeConfiguration(store, state, release);
  }
  if (!state.operation.migrated) {
    ui.log("Aplicando migraciones…", "Applying migrations…");
    await execute(["d1", "migrations", "apply", "DB", "--remote", "--config", config], credentials);
    state.operation.migrated = true;
    await store.save(state);
  }
  ui.log("Publicando Monitor…", "Publishing Monitor…");
  state.operation.publishing = true;
  await store.save(state);
  await execute(["deploy", "--no-bundle", "--config", config, "--secrets-file", store.secretsPath], credentials);
  state.deployedVersion = release.manifest.version;
  state.sourceSha = release.manifest.sourceSha;
  state.phase = state.adoption ? "adopting" : "ready";
  await store.save(state);
  const remote = await inspectResources(cf, state, secrets);
  const actual = remoteRelease(remote.settings);
  requireValue(actual.version === state.deployedVersion && actual.sourceSha === state.sourceSha, "No se confirmó la versión publicada. Reanudá la operación para verificarla.", "Published version was not confirmed. Resume to verify it.");
  state.resources.namespaces = remote.namespaces;
  state.phase = "ready";
  delete state.adoption;
  delete state.operation;
  await store.save(state);
}
