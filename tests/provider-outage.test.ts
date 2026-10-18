import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { first, rows, statement } from "../src/worker/db";
import { changeProviderOutage, providerOutage } from "../src/worker/provider-outage";
import { deliverNotifications, suppressNotifications } from "../src/worker/mail";
import { record } from "../src/worker/engine";
import { saveNotifications } from "../src/worker/settings";
import { defaultNotifications } from "../src/shared/settings";
import type { ProviderOutageState } from "../src/shared/provider-outage";
import type { Job, Monitor } from "../src/shared/types";
import { createMonitor, createProject, projectId, setup } from "./setup";

beforeEach(async () => { await setup(); await createProject(); });
const production = () => ({ ...env, ENVIRONMENT: "production" as const });
const request = (path: string, method = "GET", body?: unknown) => new Request(`http://localhost/api/v1/${path}`, {
  method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body)
});
const control = (body?: unknown) => worker.fetch(request("admin/incidents/provider", body === undefined ? "GET" : "PUT", body), env);
const response = () => Response.json({ ErrorCode: 0, ok: true, status: 1, receipt: "emergency", id: "ntfy" });

async function configure() {
  const defaults = defaultNotifications();
  await saveNotifications(env, {
    ...defaults,
    email: { ...defaults.email, enabled: true, to: "owner@example.test", from: "monitor@example.test", token: "postmark" },
    telegram: { ...defaults.telegram, enabled: true, token: "123:fixture", chatId: "123" },
    pushover: { ...defaults.pushover, enabled: true, token: "a".repeat(30), userKey: "b".repeat(30) },
    ntfy: { ...defaults.ntfy, enabled: true, topic: "monitor" }
  });
}

async function sample(id: string, now: number, ok: boolean) {
  const monitor = (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", id))!;
  const jobId = crypto.randomUUID();
  await statement(env.DB, "INSERT INTO jobs(id,monitor_id,config_version,due_at,state,lease_token) VALUES(?,?,?,?,'running','lease')", jobId, id, monitor.config_version, now).run();
  const job = (await first<Job>(env.DB, "SELECT * FROM jobs WHERE id=?", jobId))!;
  await record(env, job, monitor, { ok, latency: 100, code: ok ? 200 : 503, reason: ok ? "ok" : "http_code", diagnostic: "fixture" }, "lease", now);
}

it("publishes one bilingual provider incident per project atomically and keeps monitor status independent", async () => {
  const now = Math.floor(Date.now() / 1000);
  const monitor = await createMonitor({ status: "up", last_checked: now, last_ok: 1 });
  const otherProject = crypto.randomUUID();
  await statement(env.DB, "INSERT INTO projects(id,name,created_at) VALUES(?,'Other',1000)", otherProject).run();
  const other = await createMonitor({ project_id: otherProject, kind: "heartbeat" });
  const values = await Promise.all([control({ enabled: true }), control({ enabled: true })]);
  expect(values.map((value) => value.status)).toEqual([200, 200]);
  const state = await (await control()).json() as ProviderOutageState;
  expect(state.outage?.incident_ids).toHaveLength(2);
  expect(await rows(env.DB, "SELECT published,stage,title_es,title_en FROM public_incidents")).toEqual(Array(2).fill({ published: 1, stage: "identified", title_es: "Interrupción del proveedor de infraestructura", title_en: "Infrastructure provider outage" }));
  expect(await rows(env.DB, "SELECT monitor_id FROM incident_monitors ORDER BY monitor_id")).toEqual([monitor.id, other.id].sort().map((monitor_id) => ({ monitor_id })));
  expect(await rows(env.DB, "SELECT * FROM maintenance")).toEqual([]);
  expect(await first(env.DB, "SELECT status,paused,last_checked FROM monitors WHERE id=?", monitor.id)).toEqual({ status: "up", paused: 0, last_checked: now });
  await statement(env.DB, "INSERT INTO pages(id,slug,title,project_id,published,language) VALUES(?,'provider','Status',?,1,'en')", crypto.randomUUID(), projectId).run();
  const page = await (await worker.fetch(request("public/provider"), env)).json() as { monitors: { status: string }[]; incidents: { title: string; updates: { message: string }[] }[] };
  expect(page.monitors[0].status).toBe("up");
  expect(page.incidents[0].title).toBe("Infrastructure provider outage");
  expect(page.incidents[0].updates[0].message).toContain("infrastructure provider");
  const incident = state.outage!.incident_ids[0];
  const blocked = await worker.fetch(request(`admin/incidents/${incident}/updates`, "POST", { stage: "resolved", impact: "down", message_es: "Resuelto", message_en: "Resolved" }), env);
  expect(blocked.status).toBe(409);
});

it("suppresses new downtime alerts at creation, preserves measured downtime and delivers recoveries on every channel", async () => {
  await configure();
  const monitor = await createMonitor({ failure_threshold: 1, recovery_threshold: 1 });
  await changeProviderOutage(env, { enabled: true }, 1000);
  await sample(monitor.id, 1060, false);
  expect(await rows(env.DB, "SELECT event,state FROM notifications")).toEqual([{ event: "opened", state: "cancelled" }]);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
  await deliverNotifications(production(), 1060, fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  await sample(monitor.id, 1120, true);
  expect(await first(env.DB, "SELECT observed_seconds,up_seconds FROM daily_stats WHERE monitor_id=?", monitor.id)).toEqual({ observed_seconds: 60, up_seconds: 0 });
  await deliverNotifications(production(), 1120, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(4);
  for (const [, options] of fetcher.mock.calls) expect(String(options?.body)).toContain("Servicio recuperado");
  expect(await rows(env.DB, "SELECT event,state FROM notifications ORDER BY created_at")).toEqual([{ event: "opened", state: "cancelled" }, { event: "recovered", state: "sent" }]);
  expect(await providerOutage(env)).not.toBeNull();
});

it("cancels existing queues and emergency repeats while retaining pending recovery alerts", async () => {
  await configure();
  const monitor = await createMonitor({ failure_threshold: 1 });
  await sample(monitor.id, 1000, false);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
  await deliverNotifications(production(), 1000, fetcher);
  await sample(monitor.id, 1060, true);
  await sample(monitor.id, 1120, false);
  await statement(env.DB, "INSERT INTO notification_deliveries(notification_id,channel,state,next_attempt) SELECT id,'email','failed',1120 FROM notifications WHERE created_at=1120").run();
  await changeProviderOutage(env, { enabled: true }, 1120);
  fetcher.mockClear();
  await suppressNotifications(production(), 1120, fetcher);
  expect(fetcher).toHaveBeenCalledOnce();
  expect(String(fetcher.mock.calls[0][0])).toContain("/receipts/emergency/cancel.json");
  expect(await first(env.DB, "SELECT state FROM notifications WHERE event='recovered'")).toEqual({ state: "pending" });
  expect(await rows(env.DB, "SELECT state FROM notifications WHERE event='opened'")).toEqual([{ state: "cancelled" }, { state: "cancelled" }]);
  expect(await first(env.DB, "SELECT state FROM notification_deliveries WHERE channel='email' AND notification_id IN (SELECT id FROM notifications WHERE created_at=1120)")).toEqual({ state: "cancelled" });
  fetcher.mockClear();
  await deliverNotifications(production(), 1180, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(4);
});

it("ends provider reports without replaying silenced alerts and enables notifications for future incidents", async () => {
  await configure();
  const monitor = await createMonitor({ failure_threshold: 1 });
  const outage = (await changeProviderOutage(env, { enabled: true }, 1000))!;
  await sample(monitor.id, 1060, false);
  expect((await control({ enabled: false, id: crypto.randomUUID() })).status).toBe(409);
  await changeProviderOutage(env, { enabled: false, id: outage.id }, 1120);
  expect(await providerOutage(env)).toBeNull();
  expect(await rows(env.DB, "SELECT stage,closed_at FROM public_incidents WHERE origin='manual'")).toEqual([{ stage: "resolved", closed_at: 1120 }]);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => response());
  await deliverNotifications(production(), 1120, fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  await sample(monitor.id, 1180, true);
  await deliverNotifications(production(), 1180, fetcher);
  fetcher.mockClear();
  await sample(monitor.id, 1240, false);
  await deliverNotifications(production(), 1240, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(4);
  expect(await first(env.DB, "SELECT state FROM notifications WHERE event='opened' AND created_at=1240")).toEqual({ state: "sent" });
});

it("validates activation and preserves Access protection for the global control", async () => {
  expect((await control({ enabled: true })).status).toBe(409);
  expect((await control({ enabled: false })).status).toBe(400);
  for (const method of ["GET", "PUT"]) {
    expect((await worker.fetch(request("admin/incidents/provider", method, method === "PUT" ? { enabled: true } : undefined), { ...production(), APP_ORIGIN: "http://localhost" })).status).toBe(401);
  }
  expect(await providerOutage(env)).toBeNull();
});

it("rolls back global suppression if publishing a provider report fails", async () => {
  await createMonitor();
  await env.DB.exec("CREATE TRIGGER reject_provider_update BEFORE INSERT ON incident_updates BEGIN SELECT RAISE(ABORT,'fixture'); END");
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect((await control({ enabled: true })).status).toBe(500);
    expect(await providerOutage(env)).toBeNull();
    expect(await rows(env.DB, "SELECT * FROM public_incidents")).toEqual([]);
  } finally {
    log.mockRestore();
    await env.DB.exec("DROP TRIGGER reject_provider_update");
  }
});

it("preserves the active global incident through a full backup and rejects malformed provider state", async () => {
  await createMonitor();
  const outage = (await changeProviderOutage(env, { enabled: true }, 1000))!;
  const backup = await (await worker.fetch(request("admin/settings/export?scope=full"), env)).json() as { data: { app_settings: { id: string; value: string }[] } };
  await changeProviderOutage(env, { enabled: false, id: outage.id }, 1060);
  const restore = () => worker.fetch(request("admin/settings/restore", "POST", { confirmation: "RESTORE_BACKUP", backup }), env);
  expect((await restore()).status).toBe(200);
  expect(await providerOutage(env)).toEqual(outage);
  const stored = backup.data.app_settings.find((row) => row.id === "provider-outage")!;
  stored.value = "{}";
  expect((await restore()).status).toBe(400);
  expect(await providerOutage(env)).toEqual(outage);
});
