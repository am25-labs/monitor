import { beforeEach, it, expect } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { record, cleanup, tick } from "../src/worker/engine";
import { first, rows, statement } from "../src/worker/db";
import { displayStatus } from "../src/worker/state";
import {
  historyStatus,
  overallStatus,
  publicStatus,
  type IncidentDetail,
  type PublicIncident
} from "../src/shared/incidents";
import { monitorInput } from "../src/shared/schema";
import type { Job, Monitor, CheckResult } from "../src/shared/types";
import { incidentDetail } from "../src/worker/incidents";
import { createMonitor, createProject, projectId, setup } from "./setup";

const now = () => Math.floor(Date.now() / 1000);
const request = (path: string, method = "GET", value?: unknown) =>
  new Request(`http://localhost/api/v1/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: value === undefined ? undefined : JSON.stringify(value)
  });
async function call(path: string, method = "GET", value?: unknown) {
  return worker.fetch(request(path, method, value), env);
}
async function sample(id: string, time: number, latency = 100, ok = true) {
  const m = (await first<Monitor>(
    env.DB,
    "SELECT * FROM monitors WHERE id=?",
    id
  ))!;
  const jobId = crypto.randomUUID();
  await statement(
    env.DB,
    "INSERT INTO jobs(id,monitor_id,config_version,due_at,state,lease_token) VALUES(?,?,?,?,'running','lease')",
    jobId,
    id,
    m.config_version,
    time
  ).run();
  const job = (await first<Job>(
    env.DB,
    "SELECT * FROM jobs WHERE id=?",
    jobId
  ))!;
  const result: CheckResult = {
    ok,
    latency,
    code: ok ? 200 : 500,
    reason: ok ? "ok" : "http_code",
    diagnostic: "private diagnostic"
  };
  await record(env, job, m, result, "lease", time);
  return { job, m, result };
}
async function page(monitorIds: string[], language = "es", slug = "test") {
  const response = await call("admin/pages", "POST", {
    project_id: projectId,
    title: "Test",
    slug,
    language,
    included_ids: monitorIds,
    published: true
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string };
}
function manual(monitorIds: string[], overrides: Record<string, unknown> = {}) {
  return {
    project_id: projectId,
    monitor_ids: monitorIds,
    title_es: "Problema parcial",
    title_en: "Partial issue",
    message_es: "Estamos investigando.",
    message_en: "We are investigating.",
    impact: "degraded",
    ...overrides
  };
}
async function createManual(
  monitorIds: string[],
  overrides: Record<string, unknown> = {}
) {
  const response = await call(
    "admin/incidents",
    "POST",
    manual(monitorIds, overrides)
  );
  expect(response.status).toBe(201);
  return (await response.json()) as { id: string };
}
beforeEach(async () => {
  await setup();
  await createProject();
});

it("keeps shared incident updates when resetting only one affected monitor", async () => {
  const firstMonitor = await createMonitor();
  const secondMonitor = await createMonitor();
  const report = await createManual([firstMonitor.id, secondMonitor.id]);
  await call(`admin/incidents/${report.id}/publish`, "POST", {});
  await call("admin/settings/general", "PUT", { testMode: true });
  expect(
    (
      await call("admin/settings/history", "DELETE", {
        monitorId: firstMonitor.id,
        confirmation: "DELETE_HISTORY"
      })
    ).status
  ).toBe(200);
  const detail = await incidentDetail(env, report.id);
  expect(detail.monitors.map((m) => m.id)).toEqual([secondMonitor.id]);
  expect(detail.updates).toHaveLength(1);
  await call("admin/settings/history", "DELETE", {
    monitorId: null,
    confirmation: "DELETE_HISTORY"
  });
  expect(await rows(env.DB, "SELECT * FROM public_incidents")).toHaveLength(0);
  expect(await rows(env.DB, "SELECT * FROM incident_updates")).toHaveLength(0);
});

it("removes orphaned reports when deleting monitors while preserving shared reports", async () => {
  const firstMonitor = await createMonitor();
  const secondMonitor = await createMonitor();
  const report = await createManual([firstMonitor.id, secondMonitor.id]);
  expect(
    (await call(`admin/monitors/${firstMonitor.id}`, "DELETE")).status
  ).toBe(200);
  expect(
    (await incidentDetail(env, report.id)).monitors.map((m) => m.id)
  ).toEqual([secondMonitor.id]);
  expect(
    (await call(`admin/monitors/${secondMonitor.id}`, "DELETE")).status
  ).toBe(200);
  expect(await rows(env.DB, "SELECT * FROM public_incidents")).toHaveLength(0);
  expect(await rows(env.DB, "SELECT * FROM incident_updates")).toHaveLength(0);
  expect((await call(`admin/projects/${projectId}`, "DELETE")).status).toBe(
    200
  );
});

it("detects sustained latency, records yellow segments without reducing availability, and recovers", async () => {
  const m = await createMonitor({ latency_threshold: 500 });
  const start = now() - 300;
  await sample(m.id, start);
  await sample(m.id, start + 60, 800);
  await sample(m.id, start + 120, 800);
  expect(await rows(env.DB, "SELECT * FROM public_incidents")).toHaveLength(0);
  const confirmed = await sample(m.id, start + 180, 800);
  let updated = (await first<Monitor>(
    env.DB,
    "SELECT * FROM monitors WHERE id=?",
    m.id
  ))!;
  expect(displayStatus(updated, [], start + 180)).toBe("degraded");
  expect(await rows(env.DB, "SELECT * FROM notifications")).toHaveLength(0);
  await record(
    env,
    confirmed.job,
    confirmed.m,
    confirmed.result,
    "lease",
    start + 180
  );
  const incident = (
    await rows<PublicIncident>(env.DB, "SELECT * FROM public_incidents")
  )[0];
  expect((await incidentDetail(env, incident.id)).updates).toHaveLength(1);
  for (const table of ["daily_stats", "hourly_stats", "short_stats"]) {
    const stats = await rows<{
      observed_seconds: number;
      up_seconds: number;
      degraded_count: number;
    }>(env.DB, `SELECT * FROM ${table}`);
    expect(stats.some((s) => s.degraded_count > 0)).toBe(true);
    expect(
      stats.reduce((n, s) => n + s.observed_seconds - s.up_seconds, 0)
    ).toBe(0);
  }
  await sample(m.id, start + 240, 100);
  updated = (await first<Monitor>(
    env.DB,
    "SELECT * FROM monitors WHERE id=?",
    m.id
  ))!;
  expect(displayStatus(updated, [], start + 240)).toBe("degraded");
  await sample(m.id, start + 300, 100);
  updated = (await first<Monitor>(
    env.DB,
    "SELECT * FROM monitors WHERE id=?",
    m.id
  ))!;
  expect(displayStatus(updated, [], start + 300)).toBe("up");
  expect((await incidentDetail(env, incident.id)).stage).toBe("resolved");
  expect(await rows(env.DB, "SELECT * FROM public_incidents")).toHaveLength(1);
  expect(await rows(env.DB, "SELECT * FROM notifications")).toHaveLength(0);
});

it("escalates degradation to outage in one timeline, alerts only outages, and can recover into degradation", async () => {
  const m = await createMonitor({
    latency_threshold: 500,
    degradation_threshold: 1,
    failure_threshold: 1
  });
  const start = now() - 240;
  await sample(m.id, start, 800);
  const incident = (
    await rows<PublicIncident>(env.DB, "SELECT * FROM public_incidents")
  )[0];
  await sample(m.id, start + 60, 0, false);
  let detail = await incidentDetail(env, incident.id);
  expect(detail.impact).toBe("down");
  expect(detail.technical_id).not.toBeNull();
  expect(detail.updates).toHaveLength(2);
  expect(
    await rows(env.DB, "SELECT * FROM notifications WHERE event='opened'")
  ).toHaveLength(1);
  await sample(m.id, start + 120, 800);
  detail = await incidentDetail(env, incident.id);
  expect(detail.impact).toBe("degraded");
  expect(detail.closed_at).toBeNull();
  expect(
    await rows(env.DB, "SELECT * FROM notifications WHERE event='recovered'")
  ).toHaveLength(1);
  await sample(m.id, start + 180);
  await sample(m.id, start + 240);
  detail = await incidentDetail(env, incident.id);
  expect(detail.stage).toBe("resolved");
  expect(detail.updates).toHaveLength(4);
});

it("resets consecutive latency sequences on failures and maintenance and does not reinterpret stale data", async () => {
  const m = await createMonitor({
    latency_threshold: 500,
    degradation_threshold: 2
  });
  const start = now() - 360;
  await sample(m.id, start, 800);
  await sample(m.id, start + 60, 0, false);
  await sample(m.id, start + 120, 800);
  expect(
    (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
      ?.degraded
  ).toBe(0);
  await statement(
    env.DB,
    "INSERT INTO maintenance(id,scope,target_id,title,starts_at,ends_at) VALUES(?,'monitor',?,'Work',?,?)",
    crypto.randomUUID(),
    m.id,
    start + 150,
    start + 270
  ).run();
  await tick(env, start + 180);
  await sample(m.id, start + 180, 800);
  expect(await rows(env.DB, "SELECT * FROM public_incidents")).toHaveLength(0);
  await tick(env, start + 300);
  await sample(m.id, start + 300, 800);
  await sample(m.id, start + 360, 800);
  const updated = (await first<Monitor>(
    env.DB,
    "SELECT * FROM monitors WHERE id=?",
    m.id
  ))!;
  expect(displayStatus(updated, [], start + 361)).toBe("degraded");
  expect(displayStatus(updated, [], start + 600)).toBe("unknown");
});

it("validates opt-in settings and rejects heartbeat latency configuration", async () => {
  const base = {
    name: "Monitor",
    project_id: projectId,
    kind: "heartbeat",
    config: {}
  };
  expect(monitorInput.parse(base).latency_threshold).toBeNull();
  expect(() =>
    monitorInput.parse({ ...base, latency_threshold: 500 })
  ).toThrow();
  const http = {
    ...base,
    kind: "http",
    config: { url: "https://example.test" },
    latency_threshold: 500
  };
  const response = await call("admin/monitors", "POST", http);
  expect(response.status).toBe(201);
  const { id } = (await response.json()) as { id: string };
  const monitor = (await first<Monitor>(
    env.DB,
    "SELECT * FROM monitors WHERE id=?",
    id
  ))!;
  expect(monitor.latency_threshold).toBe(500);
  expect(monitor.degradation_threshold).toBe(3);
  expect(
    (
      await call(`admin/monitors/${id}`, "PUT", {
        ...http,
        latency_threshold: null
      })
    ).status
  ).toBe(200);
  expect(() =>
    monitorInput.parse({ ...http, degradation_threshold: 0 })
  ).toThrow();
  expect(() =>
    monitorInput.parse({ ...http, latency_recovery_threshold: 21 })
  ).toThrow();
  expect(
    monitorInput.parse({
      ...http,
      degradation_threshold: 20,
      latency_recovery_threshold: 1
    }).degradation_threshold
  ).toBe(20);
});

it("detects TCP latency and starts a fresh sequence after pausing", async () => {
  const m = await createMonitor({
    kind: "tcp",
    latency_threshold: 500,
    degradation_threshold: 2
  });
  const start = now() - 300;
  await sample(m.id, start, 500);
  await sample(m.id, start + 60, 800);
  expect(
    (await call(`admin/monitors/${m.id}/pause`, "POST", { paused: true }))
      .status
  ).toBe(200);
  expect(
    (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
      ?.slow_checks
  ).toBe(0);
  await call(`admin/monitors/${m.id}/pause`, "POST", { paused: false });
  await sample(m.id, start + 120, 800);
  expect(await rows(env.DB, "SELECT * FROM public_incidents")).toHaveLength(0);
  await sample(m.id, start + 180, 800);
  expect(
    (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
      ?.degraded
  ).toBe(1);
});

it("publishes manual incidents only after required translations and filters hidden monitors", async () => {
  const visible = await createMonitor({
    name: "Visible",
    status: "up",
    last_checked: now()
  });
  const hidden = await createMonitor({
    name: "PRIVATE service",
    status: "up",
    last_checked: now()
  });
  await page([visible.id], "en");
  const { id } = await createManual([visible.id, hidden.id], {
    title_en: "",
    message_en: ""
  });
  expect((await call(`admin/incidents/${id}/publish`, "POST", {})).status).toBe(
    400
  );
  expect(
    (
      await call(
        `admin/incidents/${id}`,
        "PUT",
        manual([visible.id, hidden.id])
      )
    ).status
  ).toBe(200);
  expect((await call(`admin/incidents/${id}/publish`, "POST", {})).status).toBe(
    200
  );
  const publicResponse = await call("public/test");
  const text = await publicResponse.text();
  expect(text).not.toContain("PRIVATE");
  expect(text).not.toContain(hidden.id);
  expect(text).not.toContain("private diagnostic");
  const data = JSON.parse(text);
  expect(data.monitors[0].status).toBe("degraded");
  expect(data.incidents[0].title).toBe("Partial issue");
  expect(data.incidents[0].updates[0].message).toBe("We are investigating.");
  expect(
    (
      await first<Monitor>(
        env.DB,
        "SELECT * FROM monitors WHERE id=?",
        visible.id
      )
    )?.status
  ).toBe("up");
  expect(await rows(env.DB, "SELECT * FROM notifications")).toHaveLength(0);
  expect(
    (await call(`admin/incidents/${id}`, "PUT", manual([visible.id]))).status
  ).toBe(409);
  expect(
    (
      await call(`admin/incidents/${id}/updates`, "POST", {
        stage: "identified",
        impact: "degraded",
        message_es: "Causa encontrada",
        message_en: ""
      })
    ).status
  ).toBe(400);
  await call(`admin/incidents/${id}/updates`, "POST", {
    stage: "resolved",
    impact: "degraded",
    message_es: "Resuelto",
    message_en: "Resolved"
  });
  expect((await incidentDetail(env, id)).closed_at).not.toBeNull();
  expect(
    (
      await call(`admin/incidents/${id}/updates`, "POST", {
        stage: "resolved",
        impact: "degraded",
        message_es: "Corrección",
        message_en: "Correction"
      })
    ).status
  ).toBe(200);
  expect((await incidentDetail(env, id)).updates).toHaveLength(3);
  expect(
    (
      await call(`admin/incidents/${id}/updates`, "POST", {
        stage: "identified",
        impact: "degraded",
        message_es: "Reabrir",
        message_en: "Reopen"
      })
    ).status
  ).toBe(409);
});

it("validates translations when publishing a page or changing its language and validates project scope", async () => {
  const m = await createMonitor({ status: "up", last_checked: now() });
  const { id } = await createManual([m.id], { title_en: "", message_en: "" });
  await call(`admin/incidents/${id}/publish`, "POST", {});
  const saved = await page([m.id]);
  const value = {
    project_id: projectId,
    title: "Test",
    slug: "test",
    language: "en",
    included_ids: [m.id],
    published: true
  };
  expect((await call(`admin/pages/${saved.id}`, "PUT", value)).status).toBe(
    400
  );
  expect(
    (await call("admin/pages", "POST", { ...value, slug: "english" })).status
  ).toBe(400);
  const otherProject = crypto.randomUUID();
  await statement(
    env.DB,
    "INSERT INTO projects(id,name,created_at) VALUES(?,'Other',1000)",
    otherProject
  ).run();
  const other = await createMonitor({ project_id: otherProject });
  expect(
    (await call("admin/incidents", "POST", manual([m.id, other.id]))).status
  ).toBe(400);
});

it("resolves automatic incidents despite human messages but leaves manual incidents active", async () => {
  const m = await createMonitor({ failure_threshold: 1 });
  await sample(m.id, now() - 60, 0, false);
  const automated = (
    await rows<PublicIncident>(env.DB, "SELECT * FROM public_incidents")
  )[0];
  const manualIncident = await createManual([m.id]);
  await call(`admin/incidents/${manualIncident.id}/publish`, "POST", {});
  expect(
    (
      await call(`admin/incidents/${automated.id}/updates`, "POST", {
        stage: "identified",
        impact: "down",
        message_es: "Trabajando",
        message_en: "Working"
      })
    ).status
  ).toBe(200);
  expect(
    (
      await call(`admin/incidents/${automated.id}/updates`, "POST", {
        stage: "resolved",
        impact: "down",
        message_es: "Cerrar",
        message_en: "Close"
      })
    ).status
  ).toBe(409);
  await sample(m.id, now());
  expect((await incidentDetail(env, automated.id)).closed_at).not.toBeNull();
  expect((await incidentDetail(env, manualIncident.id)).closed_at).toBeNull();
});

it("uses red over yellow, excludes non-evaluable monitors from total outages, and preserves unknown states", () => {
  expect(
    historyStatus({ observed_seconds: 60, up_seconds: 59, degraded_count: 1 })
  ).toBe("down");
  expect(
    historyStatus({ observed_seconds: 60, up_seconds: 60, degraded_count: 1 })
  ).toBe("degraded");
  expect(historyStatus({ observed_seconds: 60, up_seconds: 60 })).toBe("up");
  expect(
    historyStatus({ observed_seconds: 0, up_seconds: 0, degraded_count: 1 })
  ).toBe("none");
  expect(overallStatus(["up", "down"])).toBe("degraded");
  expect(overallStatus(["down", "maintenance", "paused"])).toBe("down");
  expect(overallStatus(["down", "unknown"])).toBe("degraded");
  expect(overallStatus(["unknown", "up"])).toBe("unknown");
  expect(overallStatus(["maintenance", "paused"])).toBe("maintenance");
  expect(overallStatus(["paused"])).toBe("paused");
  expect(publicStatus("down", ["degraded"])).toBe("down");
  expect(publicStatus("maintenance", ["down"])).toBe("maintenance");
  expect(publicStatus("unknown", ["degraded"])).toBe("unknown");
});

it("protects incident endpoints with Access and request origin", async () => {
  const production = {
    ...env,
    ENVIRONMENT: "production",
    APP_ORIGIN: "http://localhost"
  };
  expect(
    (await worker.fetch(request("admin/incidents"), production)).status
  ).toBe(401);
  expect(
    (
      await worker.fetch(
        request("admin/incidents", "POST", manual([crypto.randomUUID()])),
        production
      )
    ).status
  ).toBe(401);
});

it("paginates only visible resolved incidents over 90 days and keeps recent resolutions on the main page", async () => {
  const m = await createMonitor({ status: "up", last_checked: now() });
  const hidden = await createMonitor({
    name: "HIDDEN",
    status: "up",
    last_checked: now()
  });
  await page([m.id]);
  const batch = [];
  for (let i = 0; i < 25; i++) {
    const id = `archive-${String(i).padStart(2, "0")}`;
    batch.push(
      statement(
        env.DB,
        "INSERT INTO public_incidents(id,project_id,origin,impact,stage,title_es,title_en,published,opened_at,updated_at,closed_at) VALUES(?,?,'manual','down','resolved','Resuelto','Resolved',1,?,?,?)",
        id,
        projectId,
        now() - 100000 - i * 60,
        now() - 90000,
        now() - 90000
      )
    );
    batch.push(
      statement(env.DB, "INSERT INTO incident_monitors VALUES(?,?)", id, m.id)
    );
  }
  batch.push(
    statement(
      env.DB,
      "INSERT INTO public_incidents(id,project_id,origin,impact,stage,title_es,title_en,published,opened_at,updated_at,closed_at) VALUES('private',?,'manual','down','resolved','HIDDEN','HIDDEN',1,?,?,?)",
      projectId,
      now() - 100,
      now() - 60,
      now() - 60
    )
  );
  batch.push(
    statement(
      env.DB,
      "INSERT INTO incident_monitors VALUES('private',?)",
      hidden.id
    )
  );
  await env.DB.batch(batch);
  const main = (await (await call("public/test")).json()) as {
    incidents: unknown[];
  };
  expect(main.incidents).toHaveLength(0);
  const firstPage = (await (await call("public/test?archive=1")).json()) as {
    incidents: { id: string }[];
    nextCursor: { time: number; id: string };
  };
  expect(firstPage.incidents).toHaveLength(20);
  expect(firstPage.nextCursor).not.toBeNull();
  const secondPage = (await (
    await call(
      `public/test?archive=1&before=${firstPage.nextCursor.time}&id=${firstPage.nextCursor.id}`
    )
  ).json()) as { incidents: { id: string }[]; nextCursor: null };
  expect(secondPage.incidents).toHaveLength(5);
  expect(secondPage.nextCursor).toBeNull();
  expect(
    new Set([...firstPage.incidents, ...secondPage.incidents].map((i) => i.id))
      .size
  ).toBe(25);
  expect((await call("public/test?archive=1&before=bad&id=test")).status).toBe(
    400
  );
  expect((await call("public/test?archive=1&before=1")).status).toBe(400);
});

it("purges expired public incidents and resets their linked history in test mode", async () => {
  const m = await createMonitor({ failure_threshold: 1 });
  await sample(m.id, now() - 400 * 86400, 0, false);
  await sample(m.id, now() - 400 * 86400 + 60);
  const old = (
    await rows<PublicIncident>(env.DB, "SELECT * FROM public_incidents")
  )[0];
  await cleanup(env, now());
  expect(await rows(env.DB, "SELECT * FROM public_incidents")).toHaveLength(0);
  expect(
    await rows(
      env.DB,
      "SELECT * FROM incident_updates WHERE incident_id=?",
      old.id
    )
  ).toHaveLength(0);
  await sample(m.id, now() - 60, 0, false);
  expect(await rows(env.DB, "SELECT * FROM public_incidents")).toHaveLength(1);
  await call("admin/settings/general", "PUT", { testMode: true });
  expect(
    (
      await call("admin/settings/history", "DELETE", {
        monitorId: m.id,
        confirmation: "DELETE_HISTORY"
      })
    ).status
  ).toBe(200);
  expect(await rows(env.DB, "SELECT * FROM public_incidents")).toHaveLength(0);
  expect(await rows(env.DB, "SELECT * FROM incident_updates")).toHaveLength(0);
  expect(
    (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
      ?.degraded
  ).toBe(0);
});
