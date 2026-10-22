import { fileURLToPath } from "node:url";
import { requireValue } from "./messages.mjs";
import { readJson } from "./store.mjs";
import { versionParts } from "./runtime.mjs";

export function assertPatchCompatibility(version, compatibleFrom) {
  const [major, minor, patch] = versionParts(version);
  if (patch === 0) return;
  const previous = `${major}.${minor}.${patch - 1}`;
  requireValue(Array.isArray(compatibleFrom) && compatibleFrom.includes(previous),
    `El patch ${version} debe permitir actualizar desde ${previous}. Agregá esa versión a compatibleFrom antes de publicar.`,
    `Patch ${version} must support upgrading from ${previous}. Add that version to compatibleFrom before publishing.`);
}

export function assertPublishEnvironment(env, version) {
  requireValue(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "release" && env.RUNNER_ENVIRONMENT === "github-hosted"
    && env.GITHUB_REPOSITORY === "am25-labs/monitor"
    && env.MONITOR_RELEASE_PRERELEASE === "false" && env.MONITOR_RELEASE_DRAFT === "false"
    && /^[a-f\d]{40}$/.test(env.GITHUB_SHA ?? ""),
    "La publicación requiere un Release estable del repositorio oficial en GitHub Actions.", "Publishing requires a stable Release of the official repository in GitHub Actions.");
  requireValue(env.MONITOR_RELEASE_TAG === version,
    `El Release ${env.MONITOR_RELEASE_TAG} no coincide con la versión del paquete ${version}. Revisá el package.json del commit etiquetado.`,
    `Release ${env.MONITOR_RELEASE_TAG} does not match package version ${version}. Check package.json in the tagged commit.`);
  requireValue(env.GITHUB_REF === `refs/tags/${version}`,
    `La referencia ${env.GITHUB_REF} no coincide con la etiqueta esperada refs/tags/${version}.`,
    `Ref ${env.GITHUB_REF} does not match expected tag refs/tags/${version}.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pkg = await readJson(new URL("../package.json", import.meta.url));
  assertPublishEnvironment(process.env, pkg.version);
  const compatibility = await readJson(new URL("../compatibility.json", import.meta.url));
  assertPatchCompatibility(pkg.version, compatibility.compatibleFrom);
}
