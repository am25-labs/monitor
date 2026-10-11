import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { first, rows, statement } from "../src/worker/db";
import { record } from "../src/worker/engine";
import { generalSettings, saveGeneralSettings } from "../src/worker/settings";
import type { Job, Monitor } from "../src/shared/types";
import { createMonitor, createProject, setup } from "./setup";

beforeEach(async () => {
  await setup();
  await createProject();
});

function reset(monitorId: string | null, confirmation = "DELETE_HISTORY") {
  return worker.fetch(
    new Request("http://localhost/api/v1/admin/settings/history", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:5173",
      },
      body: JSON.stringify({ monitorId, confirmation }),
    }),
    env,
  );
}

async function seedHistory(monitor: Monitor) {
  const job: Job = {
    id: crypto.randomUUID(),
    monitor_id: monitor.id,
    config_version: monitor.config_version,
    due_at: 1000,
    state: "running",
    lease_token: "lease",
    lease_until: 1090,
    dispatched_at: null,
    attempts: 1,
    completed_at: null,
  };
  await statement(
    env.DB,
    "INSERT INTO jobs(id,monitor_id,config_version,due_at,state,lease_token,lease_until) VALUES(?,?,?,?,'running','lease',1090)",
    job.id,
    monitor.id,
    monitor.config_version,
    1000,
  ).run();
  await record(
    env,
    job,
    monitor,
    {
      ok: false,
      latency: 100,
      code: 500,
      reason: "http_code",
      diagnostic: "HTTP 500",
    },
    "lease",
    1000,
  );
  for (const [table, column, date] of [
    ["daily_stats", "day", "1970-01-01"],
    ["hourly_stats", "hour", "1970-01-01T00"],
    ["short_stats", "slot", "1970-01-01T00:15"],
  ]) {
    await statement(
      env.DB,
      `INSERT INTO ${table}(monitor_id,${column},observed_seconds,up_seconds) VALUES(?,?,60,0) ON CONFLICT DO UPDATE SET observed_seconds=60`,
      monitor.id,
      date,
    ).run();
  }
  const incident = await first<{ id: string }>(
    env.DB,
    "SELECT id FROM incidents WHERE monitor_id=?",
    monitor.id,
  );
  await statement(
    env.DB,
    "INSERT INTO notification_deliveries(notification_id,channel,next_attempt) SELECT id,'email',1000 FROM notifications WHERE incident_id=?",
    incident!.id,
  ).run();
  return job;
}

it("defaults test mode off and blocks deletion without enabling it or confirming", async () => {
  const monitor = await createMonitor({ failure_threshold: 1 });
  await seedHistory(monitor);
  expect((await generalSettings(env)).testMode).toBe(false);
  expect((await reset(null)).status).toBe(403);
  await saveGeneralSettings(env, { language: "en", testMode: true });
  expect(await generalSettings(env)).toEqual({
    language: "en",
    testMode: true,
  });
  expect((await reset(null, "wrong")).status).toBe(400);
  expect((await reset(crypto.randomUUID())).status).toBe(404);
  await saveGeneralSettings(env, { language: "en", testMode: false });
  expect((await reset(monitor.id)).status).toBe(403);
  expect(await rows(env.DB, "SELECT * FROM results")).toHaveLength(1);
});

it("does not bypass Access when test mode is enabled", async () => {
  await saveGeneralSettings(env, { testMode: true });
  const response = await worker.fetch(
    new Request("https://monitor.example.test/api/v1/admin/settings/history", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://monitor.example.test",
      },
      body: JSON.stringify({ monitorId: null, confirmation: "DELETE_HISTORY" }),
    }),
    {
      ...env,
      ENVIRONMENT: "production",
      APP_ORIGIN: "https://monitor.example.test",
    },
  );
  expect(response.status).toBe(401);
});

it("deletes only the selected history and prevents old jobs restoring it", async () => {
  const selected = await createMonitor({ failure_threshold: 1 });
  const other = await createMonitor({ failure_threshold: 1 });
  const oldJob = await seedHistory(selected);
  await seedHistory(other);
  await saveGeneralSettings(env, { testMode: true });
  expect((await reset(selected.id)).status).toBe(200);
  for (const table of [
    "results",
    "daily_stats",
    "hourly_stats",
    "short_stats",
    "incidents",
    "jobs",
  ]) {
    expect(
      await rows(
        env.DB,
        `SELECT * FROM ${table} WHERE monitor_id=?`,
        selected.id,
      ),
    ).toHaveLength(0);
    expect(
      await rows(env.DB, `SELECT * FROM ${table} WHERE monitor_id=?`, other.id),
    ).toHaveLength(1);
  }
  expect(await rows(env.DB, "SELECT * FROM notifications")).toHaveLength(1);
  expect(
    await rows(env.DB, "SELECT * FROM notification_deliveries"),
  ).toHaveLength(1);
  const updated = (await first<Monitor>(
    env.DB,
    "SELECT * FROM monitors WHERE id=?",
    selected.id,
  ))!;
  expect(updated).toMatchObject({
    config: selected.config,
    config_version: 2,
    status: "pending",
    failures: 0,
    last_checked: null,
  });
  await record(
    env,
    oldJob,
    selected,
    { ok: true, latency: 100, code: 200, reason: "ok", diagnostic: "OK" },
    "lease",
    1060,
  );
  expect(
    await rows(env.DB, "SELECT * FROM results WHERE monitor_id=?", selected.id),
  ).toHaveLength(0);
});

it("deletes all history while preserving monitors, heartbeat tokens and configuration", async () => {
  const firstMonitor = await createMonitor({ failure_threshold: 1 });
  const heartbeat = await createMonitor({
    failure_threshold: 1,
    kind: "heartbeat",
    heartbeat_hash: "private-hash",
    last_heartbeat: 999,
  });
  await seedHistory(firstMonitor);
  await seedHistory(heartbeat);
  await statement(
    env.DB,
    "UPDATE monitors SET paused=1,status='paused' WHERE id=?",
    heartbeat.id,
  ).run();
  await saveGeneralSettings(env, { testMode: true });
  expect((await reset(null)).status).toBe(200);
  for (const table of [
    "results",
    "daily_stats",
    "hourly_stats",
    "short_stats",
    "incidents",
    "jobs",
    "notifications",
    "notification_deliveries",
  ]) {
    expect(await rows(env.DB, `SELECT * FROM ${table}`)).toHaveLength(0);
  }
  expect(await rows(env.DB, "SELECT * FROM monitors")).toHaveLength(2);
  expect(await rows(env.DB, "SELECT * FROM projects")).toHaveLength(1);
  expect(
    await first<Monitor>(
      env.DB,
      "SELECT * FROM monitors WHERE id=?",
      heartbeat.id,
    ),
  ).toMatchObject({
    heartbeat_hash: "private-hash",
    last_heartbeat: 999,
    paused: 1,
    status: "paused",
  });
});
