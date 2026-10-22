import { requireValue } from "../../packages/cli/src/messages.mjs";

export async function readRegistryJson(url, fetcher = fetch) {
  let response;
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(30000) });
    if (response.ok) return await response.json();
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError" || error instanceof TypeError) {
      console.warn(`Registry request failed (${error.name}); retrying verification.`);
      return null;
    }
    throw error;
  }
  requireValue(response.status === 404 || response.status === 408 || response.status === 429 || response.status >= 500,
    `No se pudo consultar npm: HTTP ${response.status}.`, `Could not query npm: HTTP ${response.status}.`);
  console.warn(`Registry returned HTTP ${response.status}; retrying verification.`);
  return null;
}

export function matchesProvenance(bundle, { version, sha, digest }) {
  try {
    const statement = JSON.parse(Buffer.from(bundle.dsseEnvelope.payload, "base64").toString("utf8"));
    const definition = statement.predicate?.buildDefinition;
    const workflow = definition?.externalParameters?.workflow;
    return statement._type === "https://in-toto.io/Statement/v1"
      && statement.predicateType === "https://slsa.dev/provenance/v1"
      && definition.buildType === "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1"
      && workflow?.repository === "https://github.com/am25-labs/monitor"
      && workflow.path === ".github/workflows/publish.yml" && workflow.ref === `refs/tags/${version}`
      && definition.resolvedDependencies?.some((dependency) => dependency.uri === `git+https://github.com/am25-labs/monitor@refs/tags/${version}` && dependency.digest?.gitCommit === sha)
      && statement.predicate.runDetails?.builder?.id === "https://github.com/actions/runner/github-hosted"
      && statement.subject?.length === 1 && statement.subject[0].digest?.sha512 === digest;
  } catch { return false; }
}

export function assertArtifactIntegrity(published, { sha, integrity }) {
  requireValue(published.gitHead === sha && published.dist?.integrity === integrity,
    "El paquete publicado no coincide con el artefacto validado.", "Published package does not match the validated artifact.");
}
