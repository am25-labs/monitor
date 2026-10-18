import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { statement } from "../src/worker/db";
import { metricDays, metricTotals, type MetricsData } from "../src/shared/metrics";
import type { Stat } from "../src/shared/types";
import { createMonitor, createProject, projectId, setup } from "./setup";

beforeEach(async () => { await setup(); await createProject(); });

const stat = (values: Partial<Stat>): Stat => ({ monitor_id: projectId, day: "2026-10-01", observed_seconds: 0, up_seconds: 0, check_count: 0, success_count: 0, latency_sum: 0, latency_count: 0, ...values });

function request(params = "", overrides: Partial<Env> = {}) {
  return worker.fetch(new Request(`${overrides.APP_ORIGIN ?? "http://localhost"}/api/v1/admin/metrics?${params}`), { ...env, ...overrides });
}

it("weights availability and latency by observed time and successful measurements", () => {
  const totals = metricTotals([
    stat({ observed_seconds: 60, up_seconds: 30, check_count: 2, success_count: 1, latency_sum: 100, latency_count: 1 }),
    stat({ observed_seconds: 540, up_seconds: 540, check_count: 10, success_count: 9, latency_sum: 2700, latency_count: 9 })
  ]);
  expect(totals.availability).toBe(95);
  expect(totals.latency).toBe(280);
  expect(totals.outage).toBe(30);
  expect(totals.failedChecks).toBe(2);
  expect(metricTotals([]).availability).toBeNull();
  expect(metricTotals([stat({ observed_seconds: 60, up_seconds: 60 })]).latency).toBeNull();
});

it("fills missing UTC days with null metrics and never treats them as 100% availability", () => {
  const days = metricDays([stat({ day: "2026-10-02", observed_seconds: 60, up_seconds: 60 })], "2026-10-01", "2026-10-03");
  expect(days.map((day) => day.availability)).toEqual([null, 100, null]);
  expect(days.map((day) => day.day)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  expect(days.map((day) => day.state)).toEqual(["none", "up", "none"]);
});

it("uses history thresholds on weighted daily availability and preserves latency degradation", () => {
  const state = (stats: Stat[]) => metricDays(stats, "2026-10-01", "2026-10-01")[0].state;
  for (const [observed_seconds, up_seconds, expected] of [
    [86400, 86340, "up"], [3600, 3540, "degraded"],
    [1000, 999, "up"], [1000000, 998999, "degraded"],
    [1000, 950, "degraded"], [1000000, 949999, "down"],
    [60, 0, "down"]
  ] as const) expect(state([stat({ observed_seconds, up_seconds })])).toBe(expected);
  expect(state([
    stat({ observed_seconds: 60, up_seconds: 0 }),
    stat({ observed_seconds: 86340, up_seconds: 86340 })
  ])).toBe("up");
  expect(state([stat({ observed_seconds: 60, up_seconds: 60, degraded_count: 1 })])).toBe("degraded");
});

it("returns exactly the requested UTC window and isolates project and monitor filters", async () => {
  const chosen = await createMonitor();
  const otherProject = crypto.randomUUID();
  await statement(env.DB, "INSERT INTO projects(id,name,created_at) VALUES(?,'Other',1000)", otherProject).run();
  const other = await createMonitor({ project_id: otherProject });
  const now = Math.floor(Date.now() / 1000), today = Math.floor(now / 86400) * 86400;
  const day = (time: number) => new Date(time * 1000).toISOString().slice(0, 10);
  for (const [monitor, date] of [[chosen.id, day(today)], [other.id, day(today)], [chosen.id, day(today - 7 * 86400)], [chosen.id, day(today + 86400)]])
    await statement(env.DB, "INSERT INTO daily_stats(monitor_id,day,observed_seconds,up_seconds) VALUES(?,?,60,60)", monitor, date).run();
  const filtered = await (await request(`days=7&project=${projectId}&monitor=${chosen.id}`)).json() as MetricsData;
  expect(filtered.stats).toHaveLength(1);
  expect(filtered.stats[0].monitor_id).toBe(chosen.id);
  expect(filtered.start).toBe(day(today - 6 * 86400));
  expect(filtered.end).toBe(day(today));
  expect(filtered.incidentDays).toHaveLength(7);
  const all = await (await request("days=7")).json() as MetricsData;
  expect(all.stats).toHaveLength(2);
  expect((await (await request(`project=${projectId}&monitor=${other.id}`)).json() as MetricsData).stats).toEqual([]);
});

it("counts incidents crossing the window and excludes their duplicated public reports", async () => {
  const monitor = await createMonitor();
  const now = Math.floor(Date.now() / 1000), today = Math.floor(now / 86400) * 86400;
  const boundary = today - 6 * 86400;
  const incident = crypto.randomUUID();
  await env.DB.batch([
    statement(env.DB, "INSERT INTO incidents(id,monitor_id,opened_at,closed_at,reason) VALUES(?,?,?,?, 'http_code')", incident, monitor.id, today, now),
    statement(env.DB, "INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES(?,?,?,'http_code')", crypto.randomUUID(), monitor.id, boundary - 60),
    statement(env.DB, "INSERT INTO incidents(id,monitor_id,opened_at,closed_at,reason) VALUES(?,?,?,?, 'http_code')", crypto.randomUUID(), monitor.id, boundary - 100, boundary - 1),
    statement(env.DB, "INSERT INTO public_incidents(id,project_id,origin,monitor_id,technical_id,impact,stage,opened_at,updated_at) VALUES(?,?,'automatic',?,?,'down','investigating',?,?)", crypto.randomUUID(), projectId, monitor.id, incident, today, today)
  ]);
  const result = await (await request("days=7")).json() as MetricsData;
  expect(result.incidents).toEqual([{ monitor_id: monitor.id, opened: 1, overlapping: 2 }]);
  expect(result.incidentDays.at(-1)).toMatchObject({ opened: 1, closed: 1 });
});

it("validates filter values and protects the metrics endpoint with Access", async () => {
  for (const params of ["days=365", "project=invalid", "monitor=invalid"])
    expect((await request(params)).status).toBe(400);
  expect((await request("", { ENVIRONMENT: "production", APP_ORIGIN: "http://localhost" })).status).toBe(401);
});
