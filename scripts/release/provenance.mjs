import { requireValue } from "../../packages/cli/src/messages.mjs";

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
