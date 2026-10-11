export function allowed(env) {
  return (
    env.GITHUB_ACTIONS === "true" &&
    env.GITHUB_REF === "refs/heads/main" &&
    env.GITHUB_EVENT_NAME === "push"
  );
}
export function deploySteps(run, prepareSecrets) {
  run("pnpm", [
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--remote",
    "--config",
    "wrangler.jsonc"
  ]);
  const secretsFile = prepareSecrets();
  run("pnpm", [
    "exec",
    "wrangler",
    "deploy",
    "--config",
    "wrangler.jsonc",
    "--secrets-file",
    secretsFile
  ]);
}
