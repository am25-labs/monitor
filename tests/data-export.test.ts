import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { rows, statement } from "../src/worker/db";
import { seal, unseal } from "../src/worker/crypto";
import { createMonitor, createProject, projectId, setup } from "./setup";

interface ExportFile {
  format: string;
  formatVersion: number;
  scope: { type: string; projectIds?: string[] };
  credentials: string;
  completedAt: string;
  schema: { type: string; name: string; sql: string }[];
  data: Record<string, Record<string, unknown>[]>;
}

beforeEach(async () => {
  await setup();
  await createProject();
});

function download(params = "scope=full", overrides: Partial<Env> = {}) {
  return worker.fetch(new Request(`${overrides.APP_ORIGIN ?? "http://localhost"}/api/v1/admin/settings/export?${params}`), { ...env, ...overrides });
}

async function seedProject(id: string) {
  const group = crypto.randomUUID();
  await statement(env.DB, "INSERT INTO groups(id,project_id,name) VALUES(?,?,?)", group, id, "Group").run();
  const monitor = await createMonitor({ project_id: id, group_id: group });
  const incident = crypto.randomUUID();
  const notification = crypto.randomUUID();
  const publicIncident = crypto.randomUUID();
  await env.DB.batch([
    statement(env.DB, "INSERT INTO jobs(id,monitor_id,config_version,due_at) VALUES(?,?,1,1000)", crypto.randomUUID(), monitor.id),
    statement(env.DB, "INSERT INTO results(job_id,monitor_id,checked_at,ok,reason,diagnostic) VALUES(?,?,1000,0,'http_code','HTTP 500')", crypto.randomUUID(), monitor.id),
    statement(env.DB, "INSERT INTO daily_stats(monitor_id,day) VALUES(?,'1970-01-01')", monitor.id),
    statement(env.DB, "INSERT INTO hourly_stats(monitor_id,hour) VALUES(?,'1970-01-01T00')", monitor.id),
    statement(env.DB, "INSERT INTO short_stats(monitor_id,slot) VALUES(?,'1970-01-01T00:00')", monitor.id),
    statement(env.DB, "INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES(?,?,1000,'http_code')", incident, monitor.id),
    statement(env.DB, "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) VALUES(?,?,'opened','Monitor',1000,1000)", notification, incident),
    statement(env.DB, "INSERT INTO notification_deliveries(notification_id,channel,next_attempt) VALUES(?,'email',1000)", notification),
    statement(env.DB, "INSERT INTO public_incidents(id,project_id,origin,monitor_id,technical_id,impact,stage,opened_at,updated_at) VALUES(?,?,'automatic',?,?,'down','investigating',1000,1000)", publicIncident, id, monitor.id, incident),
    statement(env.DB, "INSERT INTO incident_monitors(incident_id,monitor_id) VALUES(?,?)", publicIncident, monitor.id),
    statement(env.DB, "INSERT INTO incident_updates(id,incident_id,stage,impact,created_at) VALUES(?,?,'investigating','down',1000)", crypto.randomUUID(), publicIncident),
    statement(env.DB, "INSERT INTO pages(id,slug,title,project_id,included_ids) VALUES(?,?,'Page',?,?)", crypto.randomUUID(), `page-${id}`, id, JSON.stringify([monitor.id])),
    ...([ ["project", id], ["group", group], ["monitor", monitor.id] ] as const).map(([scope, target]) => statement(env.DB, "INSERT INTO maintenance(id,scope,target_id,title,starts_at,ends_at) VALUES(?,?,?,'Maintenance',900,1100)", crypto.randomUUID(), scope, target))
  ]);
  return monitor;
}

it("exports every application table and schema without redacting stored data", async () => {
  const monitor = await seedProject(projectId);
  const settings = await seal({ token: "notification-secret" }, env.CONFIG_KEY, "settings:notifications");
  await statement(env.DB, "INSERT INTO app_settings(id,value,updated_at) VALUES('notifications',?,1000)", settings).run();
  const response = await download();
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toContain("application/json");
  expect(response.headers.get("Content-Disposition")).toMatch(/attachment; filename="monitor-full-.*\.json"/);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const backup = await response.json() as ExportFile;
  expect(backup.formatVersion).toBe(1);
  expect(backup.scope).toEqual({ type: "full" });
  expect(backup.completedAt).toBeTruthy();
  expect(Object.keys(backup.data)).toHaveLength(19);
  for (const [table, records] of Object.entries(backup.data)) {
    expect(records).toEqual(await rows(env.DB, `SELECT * FROM ${table} ORDER BY rowid`));
    expect(records.every((record) => !("export_rowid" in record))).toBe(true);
  }
  expect(backup.schema.some((entry) => entry.name === "monitors_capacity")).toBe(true);
  expect(backup.data.monitors[0].id).toBe(monitor.id);
  expect(backup.data.monitors[0].config).toBe(monitor.config);
  expect(await unseal<{ headers: Record<string, string> }>(String(backup.data.monitors[0].config), env.CONFIG_KEY, monitor.id)).toMatchObject({ headers: { Authorization: "Bearer secret-value" } });
  expect(backup.data.app_settings[0].value).toBe(settings);
  expect(JSON.stringify(backup)).not.toContain(env.CONFIG_KEY);
});

it("exports one, several, or all projects with related records and original IDs", async () => {
  const second = crypto.randomUUID();
  const third = crypto.randomUUID();
  for (const id of [second, third]) await statement(env.DB, "INSERT INTO projects(id,name,created_at) VALUES(?,'Other',1000)", id).run();
  for (const id of [projectId, second, third]) await seedProject(id);
  await statement(env.DB, "INSERT INTO maintenance(id,scope,title,starts_at) VALUES(?,'global','Global',900)", crypto.randomUUID()).run();
  const one = await (await download(`scope=projects&project=${projectId}`)).json() as ExportFile;
  const many = await (await download(`scope=projects&project=${projectId}&project=${second}&project=${second}`)).json() as ExportFile;
  const all = await (await download(`scope=projects&project=${projectId}&project=${second}&project=${third}`)).json() as ExportFile;
  for (const [backup, count] of [[one, 1], [many, 2], [all, 3]] as const) {
    expect(backup.data.projects).toHaveLength(count);
    expect(backup.data.maintenance).toHaveLength(count * 3 + 1);
    for (const table of ["groups", "monitors", "jobs", "results", "daily_stats", "hourly_stats", "short_stats", "incidents", "notifications", "notification_deliveries", "pages", "public_incidents", "incident_monitors", "incident_updates"]) expect(backup.data[table]).toHaveLength(count);
    expect(backup.data).not.toHaveProperty("app_settings");
    expect(backup.data).not.toHaveProperty("engine");
    expect(backup.data).not.toHaveProperty("sqlite_sequence");
  }
  expect(many.scope.projectIds).toEqual([projectId, second]);
  expect(one.data.monitors[0].project_id).toBe(projectId);
  expect(one.data.groups[0].project_id).toBe(projectId);
  expect(one.data.incident_monitors[0].monitor_id).toBe(one.data.monitors[0].id);
});

it("includes history beyond a single batch", async () => {
  const monitor = await createMonitor();
  await statement(env.DB, "WITH RECURSIVE records(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM records WHERE n<1001) INSERT INTO results(job_id,monitor_id,checked_at,ok,reason,diagnostic) SELECT 'export-job-'||n,?,n,1,'ok','OK' FROM records", monitor.id).run();
  const backup = await (await download()).json() as ExportFile;
  expect(backup.data.results).toHaveLength(1001);
  expect(new Set(backup.data.results.map((record) => record.id)).size).toBe(1001);
  expect(backup.data.results[1000].checked_at).toBe(1001);
});

it("rejects missing, malformed, unknown scopes and unauthorized downloads", async () => {
  for (const params of ["", "scope=invalid", "scope=projects", "scope=projects&project=invalid"]) expect((await download(params)).status).toBe(400);
  expect((await download(`scope=projects&project=${crypto.randomUUID()}`)).status).toBe(404);
  expect((await download("scope=full", { ENVIRONMENT: "production", APP_ORIGIN: "https://monitor.example.test" })).status).toBe(401);
});

it("exports empty collections in a complete JSON document", async () => {
  const backup = await (await download()).json() as ExportFile;
  expect(backup.data.monitors).toEqual([]);
  expect(backup.data.results).toEqual([]);
  expect(backup.data.projects[0].id).toBe(projectId);
  expect(backup.completedAt).toBeTruthy();
});
