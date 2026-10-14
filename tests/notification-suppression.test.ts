import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { first, rows, statement } from "../src/worker/db";
import { deliverNotifications, suppressNotifications } from "../src/worker/mail";
import { saveNotifications } from "../src/worker/settings";
import { defaultNotifications } from "../src/shared/settings";
import { createMonitor, createProject, projectId, setup } from "./setup";

const production = () => ({ ...env, ENVIRONMENT: "production" as const });
const push = {
  ...defaultNotifications(),
  pushover: { enabled: true, token: "a".repeat(30), userKey: "b".repeat(30), emergency: true, retrySeconds: 60, expireSeconds: 1800 }
};

beforeEach(async () => {
  await setup();
  await createProject();
  await saveNotifications(env, push);
});

async function alert(monitorId: string, state = "pending") {
  const id = crypto.randomUUID();
  await statement(env.DB, "UPDATE incidents SET closed_at=1000 WHERE monitor_id=? AND closed_at IS NULL", monitorId).run();
  await statement(env.DB, "INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES(?,?,1000,'timeout')", id, monitorId).run();
  await statement(env.DB, "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt,state) VALUES(?,?,'opened','API',1000,1000,?)", id, id, state).run();
  return id;
}

async function pause(id: string, paused = true) {
  return worker.fetch(new Request(`http://localhost/api/v1/admin/monitors/${id}/pause`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paused })
  }), env);
}

async function maintenance(scope: string, target: string | null, starts = 1000, ends: number | null = null) {
  await statement(env.DB, "INSERT INTO maintenance(id,scope,target_id,title,starts_at,ends_at) VALUES(?,?,?,'Deploy',?,?)", crypto.randomUUID(), scope, target, starts, ends).run();
}

it("cancels queued and failed deliveries immediately on pause without reviving them on resume", async () => {
  const m = await createMonitor();
  for (const state of ["pending", "sending", "failed"]) {
    const id = await alert(m.id, state);
    for (const channel of ["email", "telegram", "pushover", "ntfy"])
      await statement(env.DB, "INSERT INTO notification_deliveries(notification_id,channel,state,next_attempt) VALUES(?,?,?,1000)", id, channel, state === "sending" ? "pending" : state).run();
  }
  expect((await pause(m.id)).status).toBe(200);
  expect(await rows(env.DB, "SELECT state FROM notifications")).toEqual(Array(3).fill({ state: "cancelled" }));
  expect(await rows(env.DB, "SELECT state FROM notification_deliveries")).toEqual(Array(12).fill({ state: "cancelled" }));
  expect((await pause(m.id, false)).status).toBe(200);
  const fetcher = vi.fn<typeof fetch>();
  await deliverNotifications(production(), 1100, fetcher);
  expect(fetcher).not.toHaveBeenCalled();
  const snapshot = await worker.fetch(new Request("http://localhost/api/v1/admin/snapshot"), env);
  expect((await snapshot.json() as { notifications: unknown[] }).notifications).toEqual([]);
});

it.each(["monitor", "project", "group", "global"])("suppresses alerts during %s maintenance and retains unrelated alerts", async (scope) => {
  const group = crypto.randomUUID();
  await statement(env.DB, "INSERT INTO groups(id,project_id,name) VALUES(?,?,'APIs')", group, projectId).run();
  const m = await createMonitor({ group_id: group });
  const selected = await alert(m.id);
  const otherProject = crypto.randomUUID();
  await statement(env.DB, "INSERT INTO projects(id,name,created_at) VALUES(?,'Other',1000)", otherProject).run();
  const other = await createMonitor({ project_id: otherProject });
  const unrelated = await alert(other.id);
  const target = scope === "global" ? null : scope === "monitor" ? m.id : scope === "group" ? group : projectId;
  await maintenance(scope, target);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ status: 1, receipt: "active" }));
  await deliverNotifications(production(), 1000, fetcher);
  expect(await first(env.DB, "SELECT state FROM notifications WHERE id=?", selected)).toEqual({ state: "cancelled" });
  expect(await first(env.DB, "SELECT state FROM notifications WHERE id=?", unrelated)).toEqual({ state: scope === "global" ? "cancelled" : "sent" });
  expect(fetcher).toHaveBeenCalledTimes(scope === "global" ? 0 : 1);
});

it("cancels queued alerts immediately when manual maintenance is activated", async () => {
  const m = await createMonitor();
  await alert(m.id);
  const response = await worker.fetch(new Request("http://localhost/api/v1/admin/maintenance", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scope: "monitor", target_id: m.id, title: "Deploy", starts_at: 1000, ends_at: null })
  }), env);
  expect(response.status).toBe(200);
  expect(await first(env.DB, "SELECT state FROM notifications")).toEqual({ state: "cancelled" });
});

it("does not silence alerts for future or completed maintenance", async () => {
  const m = await createMonitor();
  await alert(m.id);
  await maintenance("monitor", m.id, 1100);
  await maintenance("monitor", m.id, 900, 1000);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ status: 1, receipt: "active" }));
  await deliverNotifications(production(), 1000, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each(["paused", "maintenance"])("cancels existing emergency repeats when %s even after changing credentials", async (mode) => {
  const m = await createMonitor();
  await alert(m.id);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ status: 1, receipt: "emergency" }));
  await deliverNotifications(production(), 1000, fetcher);
  await saveNotifications(env, { ...push, pushover: { ...push.pushover, enabled: false, token: "c".repeat(30) } });
  if (mode === "paused") await statement(env.DB, "UPDATE monitors SET paused=1 WHERE id=?", m.id).run();
  else await maintenance("monitor", m.id, 1060);
  fetcher.mockClear().mockImplementation(async () => Response.json({ status: 1 }));
  await suppressNotifications(production(), 1060, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toContain("/receipts/emergency/cancel.json");
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).token).toBe(push.pushover.token);
  expect(await first(env.DB, "SELECT cancelled_at FROM notification_deliveries")).toEqual({ cancelled_at: 1060 });
});

it("retries failed emergency cancellation even after the monitor resumes", async () => {
  const m = await createMonitor();
  await alert(m.id);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ status: 1, receipt: "emergency" }));
  await deliverNotifications(production(), 1000, fetcher);
  await statement(env.DB, "UPDATE monitors SET paused=1 WHERE id=?", m.id).run();
  fetcher.mockImplementation(async () => new Response(null, { status: 503 }));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try { await suppressNotifications(production(), 1060, fetcher); }
  finally { log.mockRestore(); }
  await statement(env.DB, "UPDATE monitors SET paused=0 WHERE id=?", m.id).run();
  fetcher.mockClear().mockImplementation(async () => Response.json({ status: 1 }));
  await deliverNotifications(production(), 1120, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toContain("cancel.json");
  expect(await first(env.DB, "SELECT cancelled_at FROM notification_deliveries")).toEqual({ cancelled_at: 1120 });
});

it("cancels a receipt that arrives after pause without reviving the notification", async () => {
  const m = await createMonitor();
  await alert(m.id);
  let release!: (response: Response) => void;
  let entered!: () => void;
  const sending = new Promise<void>((resolve) => { entered = resolve; });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).includes("cancel.json")) return Response.json({ status: 1 });
    entered();
    return new Promise<Response>((resolve) => { release = resolve; });
  });
  const delivery = deliverNotifications(production(), 1000, fetcher);
  await sending;
  try { expect((await pause(m.id)).status).toBe(200); }
  finally { release(Response.json({ status: 1, receipt: "late-receipt" })); }
  await delivery;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(String(fetcher.mock.calls[1][0])).toContain("/receipts/late-receipt/cancel.json");
  expect(await first(env.DB, "SELECT state FROM notifications")).toEqual({ state: "cancelled" });
  expect(await first(env.DB, "SELECT state,cancelled_at FROM notification_deliveries")).toEqual({ state: "cancelled", cancelled_at: 1000 });
});

it("does not schedule a retry if an in-flight delivery fails after pause", async () => {
  const m = await createMonitor();
  await alert(m.id);
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => {
    expect((await pause(m.id)).status).toBe(200);
    return new Response(null, { status: 503 });
  });
  await deliverNotifications(production(), 1000, fetcher);
  expect(await first(env.DB, "SELECT state,attempts FROM notification_deliveries")).toEqual({ state: "cancelled", attempts: 0 });
  await pause(m.id, false);
  await deliverNotifications(production(), 1300, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
