import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { rows, statement } from "../src/worker/db";
import { seal } from "../src/worker/crypto";
import type { Backup } from "../src/shared/backup";
import { createMonitor, createProject, projectId, setup } from "./setup";

beforeEach(async () => { await setup(); await createProject(); });

async function download(scope = "full") {
  const response = await worker.fetch(new Request(`http://localhost/api/v1/admin/settings/export?scope=${scope}${scope === "projects" ? `&project=${projectId}` : ""}`), env);
  return await response.json() as Backup;
}

function restore(backup: unknown, confirmation = "RESTORE_BACKUP", overrides: Partial<Env> = {}) {
  return worker.fetch(new Request(`${overrides.APP_ORIGIN ?? "http://localhost"}/api/v1/admin/settings/restore`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify({ backup, confirmation })
  }), { ...env, ...overrides });
}

it("restores full history and IDs atomically without replaying pending work", async () => {
  const monitor = await createMonitor();
  const job = crypto.randomUUID(), incident = crypto.randomUUID(), notification = crypto.randomUUID();
  await env.DB.batch([
    statement(env.DB, "INSERT INTO jobs(id,monitor_id,config_version,due_at,state,lease_token) VALUES(?,?,1,1000,'running','old-lease')", job, monitor.id),
    statement(env.DB, "INSERT INTO results(job_id,monitor_id,checked_at,ok,reason,diagnostic) VALUES(?,?,1000,0,'http_code','HTTP 500')", job, monitor.id),
    statement(env.DB, "INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES(?,?,1000,'http_code')", incident, monitor.id),
    statement(env.DB, "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt,state,lease_token) VALUES(?,?,'opened','Monitor',1000,1000,'sending','old-lease')", notification, incident)
  ]);
  const receipt = await seal("receipt-secret", env.CONFIG_KEY, `receipt:${notification}`);
  await statement(env.DB, "INSERT INTO notification_deliveries(notification_id,channel,next_attempt,receipt_token) VALUES(?,'pushover',1000,?)", notification, receipt).run();
  const backup = await download();
  await statement(env.DB, "UPDATE projects SET name='Changed'").run();
  await createMonitor();
  expect((await restore(backup)).status).toBe(200);
  expect(await rows(env.DB, "SELECT * FROM projects")).toEqual(backup.data.projects);
  expect((await rows<{ id: string; config: string }>(env.DB, "SELECT id,config FROM monitors"))).toEqual([{ id: monitor.id, config: monitor.config }]);
  expect(await rows(env.DB, "SELECT * FROM results")).toEqual(backup.data.results);
  expect(await rows(env.DB, "SELECT * FROM sqlite_sequence ORDER BY rowid")).toEqual(backup.data.sqlite_sequence);
  expect(await rows(env.DB, "SELECT state,lease_token FROM jobs")).toEqual([{ state: "cancelled", lease_token: null }]);
  expect(await rows(env.DB, "SELECT state,lease_token FROM notifications")).toEqual([{ state: "cancelled", lease_token: null }]);
  expect(await rows(env.DB, "SELECT state FROM notification_deliveries")).toEqual([{ state: "cancelled" }]);
});

it("replaces selected projects while preserving other projects and global maintenance", async () => {
  const selected = await createMonitor();
  const backup = await download("projects");
  const other = crypto.randomUUID();
  await statement(env.DB, "INSERT INTO projects(id,name,created_at) VALUES(?,'Other',1000)", other).run();
  const untouched = await createMonitor({ project_id: other });
  await statement(env.DB, "INSERT INTO maintenance(id,scope,title,starts_at) VALUES('global','global','Current',1000)").run();
  await statement(env.DB, "UPDATE projects SET name='Changed' WHERE id=?", projectId).run();
  expect((await restore(backup)).status).toBe(200);
  expect(await rows(env.DB, "SELECT * FROM monitors WHERE id=?", untouched.id)).toEqual([untouched]);
  expect(await rows(env.DB, "SELECT title FROM maintenance WHERE id='global'")).toEqual([{ title: "Current" }]);
  expect(await rows(env.DB, "SELECT id FROM monitors WHERE project_id=?", projectId)).toEqual([{ id: selected.id }]);
});

it("rejects incompatible, incomplete, and mismatched-key backups without changes", async () => {
  await createMonitor();
  const backup = await download();
  const original = await rows(env.DB, "SELECT * FROM monitors");
  for (const invalid of [{ ...backup, formatVersion: 2 }, { ...backup, completedAt: undefined }, { ...backup, data: { ...backup.data, results: undefined } }]) expect((await restore(invalid)).status).toBe(400);
  expect((await restore(backup, "RESTORE_BACKUP", { CONFIG_KEY: "1".repeat(64) })).status).toBe(400);
  expect(await rows(env.DB, "SELECT * FROM monitors")).toEqual(original);
});

it("rejects period reports before replacing any project history", async () => {
  const monitor = await createMonitor();
  await statement(env.DB, "INSERT INTO daily_stats(monitor_id,day) VALUES(?,'2025-01-01')", monitor.id).run();
  const response = await worker.fetch(new Request(`http://localhost/api/v1/admin/settings/export?scope=projects&project=${projectId}&period=month&year=2026&month=9`), env);
  const report = await response.json();
  const result = await restore(report);
  expect(result.status).toBe(400);
  expect(await result.text()).toContain("La copia contiene un reporte por período");
  expect(await rows(env.DB, "SELECT day FROM daily_stats")).toEqual([{ day: "2025-01-01" }]);
  expect(await rows(env.DB, "SELECT id FROM monitors")).toEqual([{ id: monitor.id }]);
});

it("rolls back replacement when a scoped restore conflicts with another project", async () => {
  await createMonitor();
  const backup = await download("projects");
  const other = crypto.randomUUID();
  await statement(env.DB, "INSERT INTO projects(id,name,created_at) VALUES(?,'Other',1000)", other).run();
  const untouched = await createMonitor({ project_id: other });
  backup.data.monitors[0].id = untouched.id;
  backup.data.monitors[0].config = untouched.config;
  const before = await rows(env.DB, "SELECT * FROM monitors ORDER BY id");
  expect((await restore(backup)).status).toBe(409);
  expect(await rows(env.DB, "SELECT * FROM monitors ORDER BY id")).toEqual(before);
});

it("requires confirmation and existing Access authentication", async () => {
  const backup = await download();
  expect((await restore(backup, "wrong")).status).toBe(400);
  expect((await restore(backup, "RESTORE_BACKUP", { ENVIRONMENT: "production", APP_ORIGIN: "https://monitor.example.test" })).status).toBe(401);
});

it("restores history across multiple insertion chunks", async () => {
  const monitor = await createMonitor();
  await statement(env.DB, "WITH RECURSIVE records(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM records WHERE n<1300) INSERT INTO results(job_id,monitor_id,checked_at,ok,reason,diagnostic) SELECT 'restore-job-'||n,?,n,1,'ok','OK' FROM records", monitor.id).run();
  const backup = await download();
  await statement(env.DB, "DELETE FROM results").run();
  expect((await restore(backup)).status).toBe(200);
  expect(await rows(env.DB, "SELECT * FROM results ORDER BY id")).toEqual(backup.data.results);
});

it("preserves stored references to deleted monitors in public pages", async () => {
  const deleted = crypto.randomUUID();
  await statement(env.DB, "INSERT INTO pages(id,slug,title,project_id,included_ids,excluded_ids) VALUES('page','page','Page',?,?,?)", projectId, JSON.stringify([deleted]), JSON.stringify([deleted])).run();
  const backup = await download();
  expect((await restore(backup)).status).toBe(200);
  expect(await rows(env.DB, "SELECT * FROM pages")).toEqual(backup.data.pages);
});
