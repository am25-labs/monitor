import { fileURLToPath } from "node:url";
import { requireValue } from "./messages.mjs";
import { readJson } from "./store.mjs";

export function assertPublishEnvironment(env, version) {
  requireValue(env.GITHUB_ACTIONS === "true" && env.GITHUB_EVENT_NAME === "release" && env.RUNNER_ENVIRONMENT === "github-hosted"
    && env.GITHUB_REPOSITORY === "am25-labs/monitor" && env.GITHUB_REF === `refs/tags/${version}` && env.MONITOR_RELEASE_TAG === version
    && env.MONITOR_RELEASE_PRERELEASE === "false" && env.MONITOR_RELEASE_DRAFT === "false"
    && /^[a-f\d]{40}$/.test(env.GITHUB_SHA ?? ""),
    "La publicación requiere un Release estable del repositorio oficial en GitHub Actions.", "Publishing requires a stable Release of the official repository in GitHub Actions.");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const pkg = await readJson(new URL("../package.json", import.meta.url));
  assertPublishEnvironment(process.env, pkg.version);
}
