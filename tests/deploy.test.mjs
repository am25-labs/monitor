import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { allowed, deploySteps } from "../scripts/pipeline.mjs";

test("only a push on main can deploy", () => {
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_REF: "refs/heads/main",
    GITHUB_EVENT_NAME: "push"
  };
  assert.equal(allowed(env), true);
  assert.equal(allowed({ ...env, GITHUB_REF: "refs/heads/develop" }), false);
  assert.equal(allowed({ ...env, GITHUB_EVENT_NAME: "pull_request" }), false);
  assert.equal(allowed({ ...env, GITHUB_ACTIONS: "" }), false);
});
test("a failed migration prevents configuring secrets and publishing", () => {
  const calls = [];
  assert.throws(() =>
    deploySteps(
      (_command, args) => {
        calls.push(args);
        throw new Error("migration failed");
      },
      () => calls.push("secrets")
    )
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].includes("migrations"));
});
test("migrations and secrets are completed before deploying", () => {
  const calls = [];
  deploySteps(
    (_command, args) => calls.push(args.join(" ")),
    () => {
      calls.push("secrets");
      return "/temporary/secrets.json";
    }
  );
  assert.match(calls[0], /d1 migrations apply/);
  assert.equal(calls[1], "secrets");
  assert.match(calls[2], /wrangler deploy/);
  assert.match(calls[2], /--secrets-file \/temporary\/secrets.json/);
});
test("production workflow triggers only on main, checks before build and serializes deploys", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8"
  );
  assert.match(workflow, /branches: \[main\]/);
  assert.doesNotMatch(workflow, /pull_request|workflow_dispatch|develop/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.ok(workflow.indexOf("pnpm check") < workflow.indexOf("pnpm build"));
  assert.ok(
    workflow.indexOf("pnpm build") < workflow.indexOf("pnpm run deploy")
  );
});
test("local configuration never binds production resources or enables a cron", () => {
  const config = JSON.parse(
    readFileSync(new URL("../wrangler.local.jsonc", import.meta.url), "utf8")
  );
  assert.equal(config.vars.ENVIRONMENT, "local");
  assert.equal(config.d1_databases[0].remote, false);
  assert.equal(config.triggers, undefined);
  assert.equal(config.routes, undefined);
  assert.equal(config.queues.producers[0].queue, "monitor-checks-local");
});
