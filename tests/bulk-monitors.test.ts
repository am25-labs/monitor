import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { first, rows, statement } from "../src/worker/db";
import { bulkMonitors } from "../src/worker/bulk-monitors";
import { visibleSelection } from "../src/shared/bulk-monitors";
import { saveGeneralSettings } from "../src/worker/settings";
import { requireOrigin } from "../src/worker/auth";
import { createMonitor, createProject, projectId, setup } from "./setup";

let otherProject: string;
let group: string;
beforeEach(async () => {
  await setup();
  await createProject();
  otherProject = crypto.randomUUID();
  group = crypto.randomUUID();
  await statement(env.DB, "INSERT INTO projects(id,name,created_at) VALUES(?,'Other',1000)", otherProject).run();
  await statement(env.DB, "INSERT INTO groups(id,project_id,name) VALUES(?,?,'APIs')", group, projectId).run();
});

function request(body: unknown, origin = "http://localhost") {
  return new Request("http://localhost/api/v1/admin/monitors/bulk", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body)
  });
}

it("moves selected monitors together, clears their old groups and preserves credentials and heartbeat tokens", async () => {
  const a = await createMonitor({ group_id: group });
  const b = await createMonitor({ kind: "heartbeat", heartbeat_hash: "original-token-hash", last_heartbeat: 990 });
  const untouched = await createMonitor();
  const response = await worker.fetch(request({ action: "project", ids: [a.id, b.id], project_id: otherProject }), env);
  expect(response.status).toBe(200);
  for (const monitor of [a, b])
    expect(await first(env.DB, "SELECT project_id,group_id,config,heartbeat_hash,last_heartbeat FROM monitors WHERE id=?", monitor.id))
      .toEqual({ project_id: otherProject, group_id: null, config: monitor.config, heartbeat_hash: monitor.heartbeat_hash, last_heartbeat: monitor.last_heartbeat });
  expect(await first(env.DB, "SELECT * FROM monitors WHERE id=?", untouched.id)).toEqual(untouched);
});

it("keeps a group and configuration version when the destination project is already assigned", async () => {
  const m = await createMonitor({ group_id: group });
  await bulkMonitors(env, { action: "project", ids: [m.id], project_id: projectId }, 1000);
  expect(await first(env.DB, "SELECT * FROM monitors WHERE id=?", m.id)).toEqual(m);
});

it("assigns and removes groups without moving projects", async () => {
  const a = await createMonitor();
  const b = await createMonitor();
  await bulkMonitors(env, { action: "group", ids: [a.id, b.id], group_id: group }, 1000);
  expect(await rows(env.DB, "SELECT project_id,group_id FROM monitors")).toEqual(Array(2).fill({ project_id: projectId, group_id: group }));
  const other = await createMonitor({ project_id: otherProject });
  await bulkMonitors(env, { action: "group", ids: [a.id, b.id, other.id], group_id: null }, 1060);
  expect(await rows(env.DB, "SELECT group_id FROM monitors")).toEqual(Array(3).fill({ group_id: null }));
});

it("rejects incompatible groups and missing monitors before changing any selected monitor", async () => {
  const a = await createMonitor();
  const b = await createMonitor({ project_id: otherProject });
  const before = await rows(env.DB, "SELECT * FROM monitors ORDER BY id");
  expect((await worker.fetch(request({ action: "group", ids: [a.id, b.id], group_id: group }), env)).status).toBe(400);
  expect((await worker.fetch(request({ action: "pause", ids: [a.id, crypto.randomUUID()], paused: true }), env)).status).toBe(404);
  expect((await worker.fetch(request({ action: "project", ids: [a.id], project_id: crypto.randomUUID() }), env)).status).toBe(404);
  expect(await rows(env.DB, "SELECT * FROM monitors ORDER BY id")).toEqual(before);
});

it("preserves public-page move restrictions for the entire batch", async () => {
  const a = await createMonitor();
  const b = await createMonitor();
  await statement(env.DB, "INSERT INTO pages(id,slug,title,project_id,included_ids) VALUES('page','status','Status',?,?)", projectId, JSON.stringify([b.id])).run();
  const before = await rows(env.DB, "SELECT * FROM monitors ORDER BY id");
  expect((await worker.fetch(request({ action: "project", ids: [a.id, b.id], project_id: otherProject }), env)).status).toBe(409);
  expect(await rows(env.DB, "SELECT * FROM monitors ORDER BY id")).toEqual(before);
});

it("preserves published-incident project ownership when moving a batch", async () => {
  const m = await createMonitor();
  await statement(env.DB, "INSERT INTO public_incidents(id,project_id,title_es,impact,stage,opened_at,updated_at,origin) VALUES('incident',?,'Issue','down','investigating',1000,1000,'manual')", projectId).run();
  await statement(env.DB, "INSERT INTO incident_monitors(incident_id,monitor_id) VALUES('incident',?)", m.id).run();
  expect((await worker.fetch(request({ action: "project", ids: [m.id], project_id: otherProject }), env)).status).toBe(409);
  expect(await first(env.DB, "SELECT project_id FROM monitors WHERE id=?", m.id)).toEqual({ project_id: projectId });
});

it("pauses and resumes selected monitors without resetting an already matching state", async () => {
  const a = await createMonitor();
  const b = await createMonitor({ paused: 1, config_version: 2 });
  const untouched = await createMonitor();
  await bulkMonitors(env, { action: "pause", ids: [a.id, b.id, a.id], paused: true }, 1000);
  expect(await first(env.DB, "SELECT paused,config_version FROM monitors WHERE id=?", a.id)).toEqual({ paused: 1, config_version: 2 });
  expect(await first(env.DB, "SELECT * FROM monitors WHERE id=?", b.id)).toEqual(b);
  await bulkMonitors(env, { action: "pause", ids: [a.id, b.id], paused: false }, 1060);
  expect(await first(env.DB, "SELECT paused FROM monitors WHERE id=?", a.id)).toEqual({ paused: 0 });
  expect(await first(env.DB, "SELECT paused FROM monitors WHERE id=?", b.id)).toEqual({ paused: 0 });
  expect(await first(env.DB, "SELECT * FROM monitors WHERE id=?", untouched.id)).toEqual(untouched);
});

it.each(["pause", "maintenance"])("cancels pending notifications when applying bulk %s", async (action) => {
  const m = await createMonitor();
  await statement(env.DB, "INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES('incident',?,1000,'timeout')", m.id).run();
  await statement(env.DB, "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) VALUES('alert','incident','opened','API',1000,1000)").run();
  await bulkMonitors(env, { action, ids: [m.id], ...(action === "pause" ? { paused: true } : { enabled: true }) }, 1000);
  expect(await first(env.DB, "SELECT state FROM notifications WHERE id='alert'")).toEqual({ state: "cancelled" });
});

it("activates maintenance once per monitor and ends all selected individual windows while preserving broader and scheduled windows", async () => {
  const a = await createMonitor();
  const b = await createMonitor();
  await saveGeneralSettings(env, { language: "en" });
  const input = { action: "maintenance", ids: [a.id, b.id], enabled: true };
  await Promise.all([bulkMonitors(env, input, 1000), bulkMonitors(env, input, 1000)]);
  expect(await rows(env.DB, "SELECT title FROM maintenance")).toEqual(Array(2).fill({ title: "Manual maintenance" }));
  await statement(env.DB, "INSERT INTO maintenance(id,scope,target_id,title,starts_at,ends_at) VALUES('extra','monitor',?,'Extra',1000,NULL)", a.id).run();
  await statement(env.DB, "INSERT INTO maintenance(id,scope,title,starts_at,ends_at) VALUES('global','global','Global',1000,NULL)").run();
  await statement(env.DB, "INSERT INTO maintenance(id,scope,target_id,title,starts_at,ends_at) VALUES('future','monitor',?,'Future',2000,3000)", a.id).run();
  await bulkMonitors(env, { ...input, enabled: false }, 1060);
  expect(await rows(env.DB, "SELECT ends_at FROM maintenance WHERE scope='monitor' AND starts_at=1000")).toEqual(Array(3).fill({ ends_at: 1060 }));
  expect(await first(env.DB, "SELECT ends_at FROM maintenance WHERE id='global'")).toEqual({ ends_at: null });
  expect(await first(env.DB, "SELECT ends_at FROM maintenance WHERE id='future'")).toEqual({ ends_at: 3000 });
});

it("requires a valid nonempty selection and retains Access and origin protection", async () => {
  const m = await createMonitor();
  const input = { action: "pause", ids: [m.id], paused: true };
  expect((await worker.fetch(request({ ...input, ids: [] }), env)).status).toBe(400);
  expect((await worker.fetch(request(input), { ...env, ENVIRONMENT: "production", APP_ORIGIN: "http://localhost" })).status).toBe(401);
  let denied: unknown;
  try { requireOrigin(request(input, "https://other.test"), { ...env, ENVIRONMENT: "production", APP_ORIGIN: "http://localhost" }); }
  catch (error) { denied = error; }
  expect(denied).toBeInstanceOf(Response);
  expect((denied as Response).status).toBe(403);
  expect(await first(env.DB, "SELECT paused FROM monitors WHERE id=?", m.id)).toEqual({ paused: 0 });
});

it("excludes hidden or deleted monitors from the selection used for bulk actions", () => {
  expect(visibleSelection(["hidden", "visible", "deleted"], [{ id: "visible" }])).toEqual(["visible"]);
});
