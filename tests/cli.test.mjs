import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, stat, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { argumentsFor, install } from "../packages/cli/src/cli.mjs";
import { Store, readJson, writeJson } from "../packages/cli/src/store.mjs";
import { baseConfig, checksum, filesIn, privatePaths, verifyRuntime, stageRuntime, checkUpgrade, configuration } from "../packages/cli/src/runtime.mjs";
import { Cloudflare, CloudflareError } from "../packages/cli/src/cloudflare.mjs";
import { preflight, provision, validateAccess, appOverlaps, zeroTrust } from "../packages/cli/src/infrastructure.mjs";
import { publishInstallation } from "../packages/cli/src/operations.mjs";
import { adopt, selectAccessApp, verifyEncryptionKey } from "../packages/cli/src/adoption.mjs";
import { doctor } from "../packages/cli/src/doctor.mjs";
import { assertPublishEnvironment } from "../packages/cli/src/publish-guard.mjs";
import { Cancelled } from "../packages/cli/src/messages.mjs";
import { assertArtifactIntegrity, matchesProvenance, readRegistryJson } from "../scripts/release/provenance.mjs";

const sha = "a".repeat(40);
const account = "b".repeat(32);
const secrets = { CONFIG_KEY: "c".repeat(64), ACCESS_EMAIL: "owner@example.com" };
const ui = { log() {}, async confirm() {} };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "monitor-cli-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function runtime(root, version = "0.12.5", options = {}) {
  const directory = join(root, `runtime-${version}`);
  for (const name of ["worker", "assets", "migrations"]) await mkdir(join(directory, name), { recursive: true });
  await writeFile(join(directory, "worker/index.js"), "export class MonitorScheduler {}\nexport class MonitorRunner {}\nexport default {fetch(){return new Response('test')}};");
  await writeFile(join(directory, "assets/index.html"), "<!doctype html><title>Monitor test</title>");
  await writeFile(join(directory, "migrations/0001_initial.sql"), "CREATE TABLE engine(id INTEGER PRIMARY KEY, last_finished INTEGER);\n");
  if (options.migration) await writeFile(join(directory, "migrations/0002_next.sql"), "ALTER TABLE engine ADD COLUMN extra INTEGER;\n");
  await writeJson(join(directory, "config.json"), baseConfig());
  const files = {};
  for (const name of await filesIn(directory)) files[name] = checksum(await readFile(join(directory, name)));
  const manifest = { format: 1, version, sourceSha: options.sha ?? sha, files };
  await writeJson(join(directory, "manifest.json"), manifest);
  return { directory, manifest };
}

async function installation(t, { ready = false } = {}) {
  const root = await fixture(t);
  const store = new Store(join(root, "installation"));
  await store.initialize();
  const state = await store.load();
  Object.assign(state, { accountId: account, zoneId: "zone", hostname: "monitor.example.com", name: "my-monitor", databaseName: "my-monitor-db", queueName: "my-monitor-checks", teamDomain: "https://team.cloudflareaccess.com", language: "es" });
  await writeJson(store.secretsPath, secrets);
  const release = await runtime(root);
  await stageRuntime(store, release.directory);
  const cf = new FakeCloudflare(state);
  if (ready) {
    await provision(cf, store, state, [], secrets);
    state.deployedVersion = release.manifest.version;
    state.sourceSha = release.manifest.sourceSha;
    state.phase = "ready";
    cf.publish(release.manifest);
    state.resources.namespaces = { SCHEDULER: "scheduler-id", CHECK_RUNNERS: "runner-id" };
  }
  await store.save(state);
  return { root, store, state, release: { ...release, directory: join(store.directory, "releases", release.manifest.version) }, cf };
}

class FakeCloudflare {
  constructor(state) {
    this.state = state;
    this.databases = [];
    this.queues = [];
    this.apps = [];
    this.providers = [];
    this.writes = [];
    this.settings = null;
    this.applied = ["0001_initial.sql"];
  }
  account(state, path) { return `/accounts/${state.accountId}${path}`; }
  async list(path) {
    if (path.includes("dns_records")) return this.settings ? [{ name: this.state.hostname }] : [];
    if (path.endsWith("/d1/database")) return this.databases;
    if (path.endsWith("/queues")) return this.queues;
    if (path.endsWith("/workers/scripts")) return this.settings ? [{ id: this.state.name }] : [];
    if (path.endsWith("/workers/domains")) return this.settings ? [{ hostname: this.state.hostname, service: this.state.name, zone_id: "zone" }] : [];
    if (path.endsWith("/access/apps")) return this.apps;
    if (path.endsWith("/access/identity_providers")) return this.providers;
    if (path.endsWith("/policies")) return this.policies ?? [];
    throw new Error(`Unexpected list: ${path}`);
  }
  async get(path) {
    if (path === "/zones/zone") return { id: "zone", name: "example.com", status: "active", account: { id: account } };
    if (path.endsWith("/access/organizations")) return { auth_domain: "team.cloudflareaccess.com" };
    if (path.includes("/d1/database/")) return this.databases[0];
    if (path.includes("/queues/")) return this.queues[0];
    if (path.endsWith("/settings")) return this.settings;
    if (path.endsWith("/schedules")) return { schedules: [{ cron: "* * * * *" }] };
    if (path.includes("/access/apps/")) return this.apps[0];
    if (path.includes("/identity_providers/")) return this.providers[0];
    throw new Error(`Unexpected get: ${path}`);
  }
  async post(path, body) {
    this.writes.push({ path, body });
    if (this.fail && path.endsWith(this.fail)) throw new CloudflareError(403, [10000]);
    if (path.endsWith("/d1/database")) { const db = { uuid: "database-id", name: body.name }; this.databases.push(db); return db; }
    if (path.endsWith("/queues")) { const queue = { queue_id: "queue-id", queue_name: body.queue_name }; this.queues.push(queue); return queue; }
    if (path.endsWith("/access/identity_providers")) { const provider = { id: "otp-id", ...body }; this.providers.push(provider); return provider; }
    if (path.endsWith("/access/apps")) { const app = { id: "access-id", aud: "audience", ...body }; this.apps.push(app); this.policies = body.policies; return app; }
    throw new Error(`Unexpected post: ${path}`);
  }
  async query(_state, sql) {
    if (sql.includes("d1_migrations")) return this.applied.map((name) => ({ name }));
    if (sql.includes("last_finished")) return [{ last_finished: Math.floor(Date.now() / 1000) }];
    if (sql.includes("FROM monitors")) return this.encrypted ? [this.encrypted] : [];
    if (sql.includes("app_settings")) return [];
    throw new Error(`Unexpected SQL: ${sql}`);
  }
  publish(manifest) {
    const state = this.state;
    this.settings = { bindings: [
      { name: "DB", type: "d1", database_id: "database-id" }, { name: "CHECKS", type: "queue", queue_name: state.queueName },
      { name: "SCHEDULER", type: "durable_object_namespace", namespace_id: "scheduler-id" },
      { name: "CHECK_RUNNERS", type: "durable_object_namespace", namespace_id: "runner-id" },
      ...Object.entries({ ENVIRONMENT: "production", APP_ORIGIN: `https://${state.hostname}`, ACCESS_TEAM_DOMAIN: state.teamDomain, ACCESS_AUDIENCES: "audience", MONITOR_VERSION: manifest.version, MONITOR_SOURCE_SHA: manifest.sourceSha }).map(([name, text]) => ({ name, text, type: "plain_text" })),
      { name: "CONFIG_KEY", type: "secret_text" }, { name: "ACCESS_EMAIL", type: "secret_text" }
    ] };
  }
}

function deployment(context, { fail } = {}) {
  const calls = [];
  const execute = async (args) => {
    calls.push(args);
    if (args[0] === "d1" && args[1] === "export") {
      if (fail === "backup") throw new Error("backup failed");
      await writeFile(args[args.indexOf("--output") + 1], "CREATE TABLE backup(id INTEGER);\n");
    } else if (args[0] === "d1") {
      if (fail === "migration") throw new Error("migration failed");
      context.cf.applied = Object.keys(context.release.manifest.files).filter((name) => name.startsWith("migrations/")).map((name) => name.slice("migrations/".length));
    } else {
      if (fail === "publish") throw new Error("publish failed");
      context.cf.publish(context.release.manifest);
    }
  };
  return { ...context, calls, execute, credentials: {}, ui, kind: context.state.deployedVersion ? "update" : "init" };
}

async function adoptionFixture(t, { markerless = false, fail } = {}) {
  const original = await installation(t, { ready: true });
  const config = await configuration(original.state, original.release);
  config.main = "src/worker/index.ts";
  const path = join(original.root, "original.json");
  await writeJson(path, config);
  if (markerless) original.cf.settings.bindings = original.cf.settings.bindings.filter((binding) => !["MONITOR_VERSION", "MONITOR_SOURCE_SHA"].includes(binding.name));
  const store = new Store(join(original.root, "adopted"));
  await store.initialize();
  const state = await store.load();
  const context = deployment({ ...original, store, state }, { fail });
  const answers = [path, secrets.ACCESS_EMAIL];
  return { ...context, source: original.release.directory,
    ui: { log() {}, async text() { return answers.shift(); }, async secret() { return secrets.CONFIG_KEY; }, async confirm() {} },
    fetcher: async () => Response.json({ name: "@am25/monitor", version: "0.12.5", gitHead: sha, dist: { attestations: { provenance: {} } } }) };
}

test("only init accepts a positional directory; maintenance supports cwd", () => {
  assert.equal(argumentsFor(["init", "."]).target, ".");
  for (const command of ["deploy", "doctor", "update"]) {
    assert.throws(() => argumentsFor([command, "."]));
    assert.equal(argumentsFor([command, "--cwd", "/tmp/test"]).cwd, "/tmp/test");
  }
  assert.throws(() => argumentsFor(["deploy", "--adopt"]));
  assert.throws(() => argumentsFor(["init", "--language", "fr"]));
  assert.throws(() => argumentsFor(["init", "a", "b"]));
});

test("installation rejects unrelated contents and protects secrets and concurrent operations", async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, "user.txt"), "keep");
  await assert.rejects(new Store(root).initialize());
  assert.equal(await readFile(join(root, "user.txt"), "utf8"), "keep");
  const store = new Store(join(root, "clean"));
  await store.initialize();
  await writeJson(store.secretsPath, secrets);
  assert.equal((await stat(store.secretsPath)).mode & 0o777, 0o600);
  assert.equal((await stat(store.directory)).mode & 0o777, 0o700);
  assert.equal((await store.secrets()).CONFIG_KEY, secrets.CONFIG_KEY);
  const unlock = await store.lock();
  await assert.rejects(store.lock());
  await unlock();
  await (await store.lock())();
});

test("runtime rejects tampering, extra files, path traversal and symlinks", async (t) => {
  const root = await fixture(t);
  const release = await runtime(root);
  await verifyRuntime(release.directory);
  await writeFile(join(release.directory, "worker/index.js"), "tampered");
  await assert.rejects(verifyRuntime(release.directory));
  const next = await runtime(root, "0.12.6");
  await writeFile(join(next.directory, "extra.txt"), "extra");
  await assert.rejects(verifyRuntime(next.directory));
  await rm(join(next.directory, "extra.txt"));
  await symlink(join(root, "secret"), join(next.directory, "leak"));
  await assert.rejects(verifyRuntime(next.directory));
  const other = await runtime(root, "0.12.7");
  other.manifest.files["../outside"] = "anything";
  await writeJson(join(other.directory, "manifest.json"), other.manifest);
  await assert.rejects(verifyRuntime(other.directory));
});

test("updates allow version jumps while rejecting downgrades and rewritten migrations", async (t) => {
  const root = await fixture(t);
  const current = await runtime(root), next = await runtime(root, "0.12.6", { migration: true });
  checkUpgrade(current.manifest, next.manifest);
  assert.throws(() => checkUpgrade(next.manifest, current.manifest));
  checkUpgrade(current.manifest, { ...next.manifest, version: "1.0.0" });
  checkUpgrade(current.manifest, { ...next.manifest, compatibleFrom: [] });
  assert.throws(() => checkUpgrade(current.manifest, { ...next.manifest, files: { ...next.manifest.files, "migrations/0001_initial.sql": "changed" } }));
});

test("legacy runtime compatibility lists do not restrict updates", async (t) => {
  const root = await fixture(t);
  const current = await runtime(root);
  current.manifest.compatibleFrom = ["0.12.0"];
  await writeJson(join(current.directory, "manifest.json"), current.manifest);
  await verifyRuntime(current.directory);
  const next = await runtime(root, "0.13.6");
  next.manifest.compatibleFrom = [];
  await writeJson(join(next.directory, "manifest.json"), next.manifest);
  await verifyRuntime(next.directory);
  checkUpgrade(current.manifest, next.manifest);
});

test("the prepared release updates installations without declaring previous versions", async (t) => {
  const pkg = await readJson(new URL("../packages/cli/package.json", import.meta.url));
  for (const version of ["0.12.6", "0.13.3", "0.13.4", "0.13.5"]) {
    const context = await installation(t, { ready: true });
    const previous = await runtime(context.root, version);
    previous.manifest.compatibleFrom = [];
    await writeJson(join(previous.directory, "manifest.json"), previous.manifest);
    await stageRuntime(context.store, previous.directory);
    context.state.deployedVersion = version;
    context.cf.publish(previous.manifest);
    await context.store.save(context.state);
    const next = await runtime(context.root, pkg.version);
    const release = await stageRuntime(context.store, next.directory);
    await publishInstallation(deployment({ ...context, release }));
    assert.equal(context.state.deployedVersion, pkg.version);
    assert.equal(context.state.phase, "ready");
    assert.equal(context.state.operation, undefined);
  }
});

test("application, CLI and workflows use one exact Node version", async () => {
  const app = await readJson(new URL("../package.json", import.meta.url));
  const cli = await readJson(new URL("../packages/cli/package.json", import.meta.url));
  assert.match(app.engines.node, /^24\.\d+\.\d+$/);
  assert.equal(cli.engines.node, app.engines.node);
  for (const name of ["deploy", "publish"]) {
    const workflow = await readFile(new URL(`../.github/workflows/${name}.yml`, import.meta.url), "utf8");
    assert.match(workflow, /node-version-file: package\.json/);
    assert.doesNotMatch(workflow, /node-version:/);
  }
});

test("CLI rejects Node versions other than the declared version before accessing an installation", async () => {
  const cli = new URL("../packages/cli/src/cli.mjs", import.meta.url).href;
  for (const version of ["22.23.4", "24.22.0", "26.12.1"]) {
    const script = `Object.defineProperty(process.versions, "node", { value: ${JSON.stringify(version)} });
      const { main } = await import(${JSON.stringify(cli)});
      await main(["doctor", "--language", "en"]);`;
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], { encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Node\.js 24\.22\.1 is required/);
  }
});

test("generated runtime configuration preserves engine contract without AM25 installation IDs", async () => {
  const production = await readJson(new URL("../wrangler.jsonc", import.meta.url));
  const generic = baseConfig();
  for (const key of ["durable_objects", "migrations", "triggers", "compatibility_date", "compatibility_flags", "workers_dev", "preview_urls", "observability", "secrets"]) assert.deepEqual(generic[key], production[key]);
  assert.equal(generic.assets.run_worker_first, true);
  assert.equal(JSON.stringify(generic).includes(production.account_id), false);
  assert.equal(JSON.stringify(generic).includes("monitor.example.com"), false);
});

test("Access overlap catches wildcard and whole-worker applications", () => {
  const state = { hostname: "monitor.example.com", name: "monitor" };
  assert.equal(appOverlaps({ domain: "*.example.com" }, state), true);
  assert.equal(appOverlaps({ destinations: [{ type: "all_workers" }] }, state), true);
  assert.equal(appOverlaps({ domain: "other.example.com/app" }, state), false);
});

test("adoption identifies Access applications and distinguishes selection failures", () => {
  const state = { hostname: "monitor.example.com", name: "monitor" };
  const app = { id: "monitor-access", type: "self_hosted", aud: "audience", domain: `${state.hostname}/app`,
    destinations: privatePaths.map((path) => ({ type: "public", uri: `${state.hostname}${path}` })) };
  assert.equal(selectAccessApp([app], state, "audience"), app);
  assert.throws(() => selectAccessApp([], state, "audience"), /returned 0 Access applications/);
  assert.throws(() => selectAccessApp([{ ...app, destinations: [{ type: "public", uri: "other.example.com/app" }] }], state, "audience"), /none protect monitor.example.com/);
  assert.throws(() => selectAccessApp([app, { ...app, id: "other-access" }], state, "audience"), /2 Access applications overlapping/);
  assert.throws(() => selectAccessApp([app], state, "different"), /monitor-access does not match ACCESS_AUDIENCES/);
});

test("Access validation rejects public-path protection and broad policies", async (t) => {
  const { store, state, cf } = await installation(t);
  await provision(cf, store, state, [], secrets);
  validateAccess(cf.apps[0], cf.policies, state, secrets.ACCESS_EMAIL);
  assert.deepEqual(cf.apps[0].destinations.map((item) => item.uri), privatePaths.map((path) => `${state.hostname}${path}`));
  assert.throws(() => validateAccess({ ...cf.apps[0], destinations: [{ type: "public", uri: state.hostname }] }, cf.policies, state, secrets.ACCESS_EMAIL));
  assert.throws(() => validateAccess(cf.apps[0], [{ decision: "allow", include: [{ everyone: {} }] }], state, secrets.ACCESS_EMAIL));
});

test("provisioning resumes after a denied operation without duplicating completed resources", async (t) => {
  const { store, state, cf } = await installation(t);
  cf.fail = "/queues";
  await assert.rejects(provision(cf, store, state, [], secrets));
  const resumed = await store.load();
  assert.equal(resumed.resources.database.id, "database-id");
  assert.equal(resumed.pending, undefined);
  cf.fail = undefined;
  await provision(cf, store, resumed, [], secrets);
  assert.equal(cf.databases.length, 1);
  assert.equal(cf.queues.length, 1);
  assert.equal(cf.apps.length, 1);
  assert.equal((await store.secrets()).CONFIG_KEY, secrets.CONFIG_KEY);
});

test("unknown creation outcome is retained and never retried", async (t) => {
  const { store, state, cf } = await installation(t);
  let calls = 0;
  cf.post = async () => { calls++; throw new Error("connection closed after creation"); };
  await assert.rejects(provision(cf, store, state, [], secrets));
  assert.equal((await store.load()).pending.kind, "database");
  await assert.rejects(provision(cf, store, await store.load(), [], secrets));
  assert.equal(calls, 1);
});

test("preflight rejects existing DNS, Workers, databases and Access before mutations", async (t) => {
  const { state, cf } = await installation(t);
  await preflight(cf, state);
  cf.databases.push({ uuid: "other", name: state.databaseName });
  await assert.rejects(preflight(cf, state));
  cf.databases = [];
  cf.apps.push({ id: "other", domain: "*.example.com" });
  await assert.rejects(preflight(cf, state));
  cf.apps = [];
  const original = cf.list.bind(cf);
  cf.list = async (path) => path.includes("dns_records") ? [{ name: state.hostname }] : original(path);
  await assert.rejects(preflight(cf, state));
  assert.equal(cf.writes.length, 0);
});

test("cancelled install performs no remote writes", async (t) => {
  const context = await installation(t);
  await assert.rejects(install({ ...context, source: context.release.directory, ui: { log() {}, async confirm() { throw new Cancelled(); } } }), Cancelled);
  assert.equal(context.cf.writes.length, 0);
});

test("clean installation migrates before publishing and records remote namespaces", async (t) => {
  const context = await installation(t);
  const pipeline = deployment(context);
  await install({ ...pipeline, source: context.release.directory });
  assert.equal(pipeline.calls[0][1], "migrations");
  assert.equal(pipeline.calls[1][0], "deploy");
  assert.ok(pipeline.calls[1].includes("--no-bundle"));
  const saved = await context.store.load();
  assert.equal(saved.phase, "ready");
  assert.equal(saved.deployedVersion, "0.12.5");
  assert.equal(saved.resources.namespaces.SCHEDULER, "scheduler-id");
  assert.equal(saved.operation, undefined);
});

test("backup failure prevents migrations and publishing", async (t) => {
  const context = await installation(t, { ready: true });
  const next = await runtime(context.root, "0.12.6", { migration: true });
  context.release = await stageRuntime(context.store, next.directory);
  const pipeline = deployment(context, { fail: "backup" });
  await assert.rejects(publishInstallation(pipeline));
  assert.equal(pipeline.calls.length, 1);
  assert.equal(pipeline.calls[0][1], "export");
  assert.equal((await context.store.load()).deployedVersion, "0.12.5");
});

test("migration failure preserves the original backup across resume", async (t) => {
  const context = await installation(t, { ready: true });
  const next = await runtime(context.root, "0.12.6", { migration: true });
  context.release = await stageRuntime(context.store, next.directory);
  const pipeline = deployment(context, { fail: "migration" });
  await assert.rejects(publishInstallation(pipeline));
  assert.deepEqual(pipeline.calls.map((args) => args[1]), ["export", "migrations"]);
  const saved = await context.store.load();
  const originalBackup = saved.operation.backup;
  assert.ok(originalBackup);
  assert.equal(saved.operation.migrated, undefined);
  assert.equal(saved.deployedVersion, "0.12.5");
  const resumed = deployment({ ...context, state: saved });
  await publishInstallation(resumed);
  assert.equal(resumed.calls.some((args) => args[1] === "export"), false);
  assert.equal((await readJson(join(originalBackup, "installation.json"))).deployedVersion, "0.12.5");
  assert.equal((await context.store.load()).deployedVersion, "0.12.6");
  assert.equal((await context.store.secrets()).CONFIG_KEY, secrets.CONFIG_KEY);
});

test("publication failure resumes without reapplying migrations or changing resource IDs", async (t) => {
  const context = await installation(t, { ready: true });
  const next = await runtime(context.root, "0.12.6", { migration: true });
  context.release = await stageRuntime(context.store, next.directory);
  const initialResources = structuredClone(context.state.resources);
  await assert.rejects(publishInstallation(deployment(context, { fail: "publish" })));
  const saved = await context.store.load();
  assert.equal(saved.operation.migrated, true);
  const resumed = deployment({ ...context, state: saved });
  await publishInstallation(resumed);
  assert.equal(resumed.calls.length, 1);
  assert.equal(resumed.calls[0][0], "deploy");
  assert.deepEqual((await context.store.load()).resources, initialResources);
});

test("external version changes and changed namespaces stop publication", async (t) => {
  const context = await installation(t, { ready: true });
  context.cf.settings.bindings.find((binding) => binding.name === "MONITOR_SOURCE_SHA").text = "d".repeat(40);
  const pipeline = deployment(context);
  await assert.rejects(publishInstallation(pipeline));
  assert.equal(pipeline.calls.length, 0);
  context.cf.publish(context.release.manifest);
  context.cf.settings.bindings.find((binding) => binding.name === "SCHEDULER").namespace_id = "another-namespace";
  await assert.rejects(publishInstallation(pipeline));
  assert.equal(pipeline.calls.length, 0);
});

test("adoption backs up and deploys locally without creating resources or requiring GitHub variables", async (t) => {
  const context = await adoptionFixture(t);
  const before = context.cf.writes.length;
  await adopt(context);
  assert.equal(context.cf.writes.length, before);
  assert.deepEqual(context.calls.map((args) => args[0] === "deploy" ? "deploy" : args[1]), ["export", "migrations", "deploy"]);
  assert.equal((await context.store.load()).adopted, true);
  assert.equal((await context.store.load()).adoption, undefined);
  assert.equal((await context.store.secrets()).CONFIG_KEY, secrets.CONFIG_KEY);
  assert.deepEqual(context.state.resources.namespaces, { SCHEDULER: "scheduler-id", CHECK_RUNNERS: "runner-id" });
});

test("adoption preserves a legacy Postmark secret without reading or rewriting its value", async (t) => {
  const context = await adoptionFixture(t);
  const legacy = { name: "POSTMARK_TOKEN", type: "secret_text" };
  context.cf.settings.bindings.push(legacy);
  const publish = context.cf.publish.bind(context.cf);
  context.cf.publish = (manifest) => { publish(manifest); context.cf.settings.bindings.push(legacy); };
  await adopt(context);
  assert.equal(context.state.phase, "ready");
  assert.ok(context.cf.settings.bindings.includes(legacy));
  assert.deepEqual(await context.store.secrets(), secrets);
});

test("adoption still rejects unknown bindings and a non-secret Postmark binding before deploying", async (t) => {
  for (const binding of [{ name: "CUSTOM_SECRET", type: "secret_text" }, { name: "POSTMARK_TOKEN", type: "plain_text" }]) {
    const context = await adoptionFixture(t);
    context.cf.settings.bindings.push({ ...binding, text: "private-test-value" });
    await assert.rejects(adopt(context), (error) => error.message.includes(`${binding.name} (${binding.type})`) && !error.message.includes("private-test-value"));
    assert.equal(context.calls.length, 0);
  }
});

test("adoption accepts an existing installation without release markers", async (t) => {
  const context = await adoptionFixture(t, { markerless: true });
  await adopt(context);
  const saved = await context.store.load();
  assert.equal(saved.phase, "ready");
  assert.equal(saved.deployedVersion, "0.12.5");
  assert.equal(saved.sourceSha, sha);
  const snapshot = await readJson(join(context.calls[0][context.calls[0].indexOf("--output") + 1], "../installation.json"));
  assert.equal(snapshot.deployedVersion, null);
});

test("adoption stops before changes if the package is unpublished or the schema differs", async (t) => {
  const unpublished = await adoptionFixture(t, { markerless: true });
  unpublished.fetcher = async () => new Response("", { status: 404 });
  await assert.rejects(adopt(unpublished));
  assert.equal(unpublished.calls.length, 0);
  assert.equal((await unpublished.store.load()).phase, "setup");
  const mismatch = await adoptionFixture(t);
  mismatch.cf.applied.push("0002_unknown.sql");
  await assert.rejects(adopt(mismatch));
  assert.equal(mismatch.calls.length, 0);
});

test("adoption resumes a failed publication with the original backup and no repeated questions", async (t) => {
  const context = await adoptionFixture(t, { markerless: true, fail: "publish" });
  await assert.rejects(adopt(context));
  const saved = await context.store.load();
  assert.equal(saved.phase, "adopting");
  assert.equal(saved.operation.migrated, true);
  const resumed = deployment({ ...context, state: saved });
  await adopt({ ...resumed, source: context.source, ui: { log() {}, async text() { assert.fail("Must not ask for configuration again"); }, async secret() { assert.fail("Must reuse the original key"); } } });
  assert.equal(resumed.calls.length, 1);
  assert.equal(resumed.calls[0][0], "deploy");
  assert.equal((await context.store.load()).phase, "ready");
});

test("adoption does not deploy when its initial backup fails", async (t) => {
  const context = await adoptionFixture(t, { markerless: true, fail: "backup" });
  await assert.rejects(adopt(context));
  assert.equal(context.calls.length, 1);
  assert.equal(context.calls[0][1], "export");
  assert.equal((await context.store.load()).phase, "adopting");
});

test("adoption rejects a wrong encryption key using authenticated decryption", async (t) => {
  const { state, cf } = await installation(t, { ready: true });
  const id = "monitor-id", iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", Buffer.from(secrets.CONFIG_KEY, "hex"), "AES-GCM", false, ["encrypt"]);
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(id) }, key, new TextEncoder().encode("{}"));
  cf.encrypted = { id, value: JSON.stringify({ iv: [...iv], data: [...new Uint8Array(data)] }) };
  assert.equal(await verifyEncryptionKey(cf, state, secrets.CONFIG_KEY), true);
  await assert.rejects(verifyEncryptionKey(cf, state, "e".repeat(64)));
});

test("doctor makes only read requests and never sends heartbeats or notifications", async (t) => {
  const context = await installation(t, { ready: true });
  const before = context.cf.writes.length;
  const requests = [];
  const result = await doctor({ ...context, ui, fetcher: async (url, options) => {
    requests.push({ url, options });
    return new Response("", { status: url.includes("/public/") || url.includes("/heartbeats/") ? 404 : 401 });
  } });
  assert.equal(result, true);
  assert.equal(context.cf.writes.length, before);
  assert.equal(requests.every(({ options }) => options.method === undefined && options.redirect === "manual"), true);
});

test("doctor reports missing cron or malformed schedule responses without a generic failure", async (t) => {
  for (const [response, expected] of [[{ schedules: [] }, "The per-minute cron is missing."], [{}, "Cloudflare returned an unrecognized cron response."]]) {
    const context = await installation(t, { ready: true });
    const get = context.cf.get.bind(context.cf);
    context.cf.get = async (path) => path.endsWith("/schedules") ? response : get(path);
    const messages = [];
    const result = await doctor({ ...context, ui: { log(_es, en) { messages.push(en); } },
      fetcher: async (url) => new Response("", { status: url.includes("/public/") || url.includes("/heartbeats/") ? 404 : 401 }) });
    assert.equal(result, false);
    assert.ok(messages.some((message) => message.includes(expected)));
    assert.ok(messages.includes("Automated diagnostics incomplete. Review checks marked with ✗."));
    assert.ok(!messages.some((message) => message.startsWith("Free:")));
  }
});

test("Cloudflare pagination and errors do not expose response bodies or tokens", async () => {
  const token = "super-secret-token", requests = [];
  const cf = new Cloudflare(token, async (url, options) => {
    requests.push({ url, options });
    return Response.json({ success: true, result: [{ id: requests.length }], result_info: { total_pages: 2 } });
  });
  assert.deepEqual(await cf.list("/accounts"), [{ id: 1 }, { id: 2 }]);
  const denied = new Cloudflare(token, async () => Response.json({ success: false, errors: [{ code: 10000, message: token }] }, { status: 403 }));
  await assert.rejects(denied.get("/accounts"), (error) => !error.message.includes(token) && !error.es.includes(token));
});

test("publishing requires official stable release on GitHub-hosted Actions", () => {
  const env = { GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "release", RUNNER_ENVIRONMENT: "github-hosted", GITHUB_REPOSITORY: "am25-labs/monitor", GITHUB_REF: "refs/tags/0.12.5", MONITOR_RELEASE_TAG: "0.12.5", MONITOR_RELEASE_PRERELEASE: "false", MONITOR_RELEASE_DRAFT: "false", GITHUB_SHA: sha };
  assertPublishEnvironment(env, "0.12.5");
  assert.throws(() => assertPublishEnvironment({ ...env, MONITOR_RELEASE_TAG: "0.13.0", GITHUB_REF: "refs/tags/0.13.0" }, "0.12.5"), /Release 0\.13\.0 does not match package version 0\.12\.5/);
  for (const [key, value] of Object.entries({ GITHUB_ACTIONS: "false", GITHUB_EVENT_NAME: "push", GITHUB_REPOSITORY: "other/monitor", RUNNER_ENVIRONMENT: "self-hosted", MONITOR_RELEASE_PRERELEASE: "true", MONITOR_RELEASE_DRAFT: "true", GITHUB_REF: "refs/tags/1.0.0" })) assert.throws(() => assertPublishEnvironment({ ...env, [key]: value }, "0.12.5"));
});

test("the release guard runs without a version compatibility declaration", async () => {
  const pkg = await readJson(new URL("../packages/cli/package.json", import.meta.url));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../packages/cli/src/publish-guard.mjs", import.meta.url))], {
    encoding: "utf8",
    env: { ...process.env, GITHUB_ACTIONS: "true", GITHUB_EVENT_NAME: "release", RUNNER_ENVIRONMENT: "github-hosted",
      GITHUB_REPOSITORY: "am25-labs/monitor", GITHUB_REF: `refs/tags/${pkg.version}`, MONITOR_RELEASE_TAG: pkg.version,
      MONITOR_RELEASE_PRERELEASE: "false", MONITOR_RELEASE_DRAFT: "false", GITHUB_SHA: sha }
  });
  assert.equal(result.status, 0, result.stderr);
});

test("Zero Trust onboarding pauses for the user and rechecks without writes", async () => {
  let checks = 0, confirmations = 0;
  const cf = { account: (_state, path) => path, async get() { return ++checks === 1 ? null : { auth_domain: "team.cloudflareaccess.com" }; } };
  const wizard = { log() {}, async confirm() { confirmations++; } };
  assert.equal(await zeroTrust(cf, {}, wizard), "https://team.cloudflareaccess.com");
  assert.equal(confirmations, 1);
  assert.equal(checks, 2);
});

test("missing permissions stop installation before confirmation or mutation", async (t) => {
  const context = await installation(t);
  context.cf.list = async () => { throw new CloudflareError(403, [10000]); };
  let confirmations = 0;
  await assert.rejects(install({ ...context, source: context.release.directory, ui: { log() {}, async confirm() { confirmations++; } } }));
  assert.equal(confirmations, 0);
  assert.equal(context.cf.writes.length, 0);
});

test("registry verification retries transient failures but rejects permanent failures", async () => {
  const url = "https://registry.npmjs.org/@am25%2fmonitor/0.13.0";
  for (const error of [new DOMException("Timed out", "TimeoutError"), new DOMException("Aborted", "AbortError"), new TypeError("fetch failed")]) {
    assert.equal(await readRegistryJson(url, async () => { throw error; }), null);
  }
  for (const status of [404, 408, 429, 503]) {
    assert.equal(await readRegistryJson(url, async () => new Response(null, { status })), null);
  }
  assert.deepEqual(await readRegistryJson(url, async () => Response.json({ version: "0.13.0" })), { version: "0.13.0" });
  await assert.rejects(readRegistryJson(url, async () => new Response(null, { status: 403 })), /HTTP 403/);
  await assert.rejects(readRegistryJson(url, async () => new Response("invalid JSON")), SyntaxError);
});

test("provenance is bound to workflow, tag, source commit, hosted builder and artifact", () => {
  const options = { version: "0.12.5", sha, digest: "f".repeat(128) };
  const statement = {
    _type: "https://in-toto.io/Statement/v1", predicateType: "https://slsa.dev/provenance/v1", subject: [{ digest: { sha512: options.digest } }],
    predicate: { buildDefinition: {
      buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
      externalParameters: { workflow: { repository: "https://github.com/am25-labs/monitor", path: ".github/workflows/publish.yml", ref: "refs/tags/0.12.5" } },
      resolvedDependencies: [{ uri: "git+https://github.com/am25-labs/monitor@refs/tags/0.12.5", digest: { gitCommit: sha } }]
    }, runDetails: { builder: { id: "https://github.com/actions/runner/github-hosted" } } }
  };
  const bundle = (value) => ({ dsseEnvelope: { payload: Buffer.from(JSON.stringify(value)).toString("base64") } });
  assert.equal(matchesProvenance(bundle(statement), options), true);
  for (const mutate of [
    (value) => value.predicate.buildDefinition.externalParameters.workflow.repository = "https://github.com/other/monitor",
    (value) => value.predicate.buildDefinition.externalParameters.workflow.path = ".github/workflows/other.yml",
    (value) => value.predicate.buildDefinition.externalParameters.workflow.ref = "refs/heads/main",
    (value) => value.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "0".repeat(40),
    (value) => value.predicate.runDetails.builder.id = "https://github.com/actions/runner/self-hosted",
    (value) => value.subject[0].digest.sha512 = "changed"
  ]) {
    const changed = structuredClone(statement);
    mutate(changed);
    assert.equal(matchesProvenance(bundle(changed), options), false);
  }
  assert.equal(matchesProvenance({}, options), false);
  assertArtifactIntegrity({ gitHead: sha, dist: { integrity: "expected" } }, { sha, integrity: "expected" });
  assert.throws(() => assertArtifactIntegrity({ gitHead: sha, dist: { integrity: "changed" } }, { sha, integrity: "expected" }));
});
