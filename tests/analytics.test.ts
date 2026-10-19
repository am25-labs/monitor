import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import worker from "../src/worker/index";
import { changeAgentToken } from "../src/worker/agent-access";
import { first, statement } from "../src/worker/db";
import { cleanup } from "../src/worker/engine";
import { createMonitor, createProject, projectId, setup } from "./setup";

beforeEach(async () => { await setup(); await createProject(); });
async function credential() { return (await changeAgentToken(env, { name: "Analysis", expiresInDays: 1 })).token!; }
function request(path: string, token?: string, options: RequestInit = {}) {
  return worker.fetch(new Request(`http://localhost/api/v1/analytics/${path}`, { ...options, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...options.headers } }), env);
}
async function addStat(monitor: string, day: string, observed: number, up: number, latency: number, count: number) {
  await statement(env.DB, "INSERT INTO daily_stats(monitor_id,day,observed_seconds,up_seconds,check_count,success_count,latency_sum,latency_count) VALUES(?,?,?,?,?,?,?,?)", monitor, day, observed, up, count, count, latency, count).run();
}

it("requires dedicated expiring tokens even locally and exposes no hashes", async () => {
  expect((await request("info")).status).toBe(401);
  const created = await worker.fetch(new Request("http://localhost/api/v1/admin/agent-tokens", { method: "POST", headers: { "Content-Type": "application/json", Origin: env.APP_ORIGIN }, body: JSON.stringify({ name: "Agent", expiresInDays: 1 }) }), env);
  expect(created.status).toBe(201);
  const result = await created.json() as { token: string; tokens: { id: string }[] };
  expect(JSON.stringify(result)).not.toContain('"hash"');
  expect((await request("info", result.token)).status).toBe(200);
  expect((await request("info", `${result.token.slice(0, -1)}${result.token.endsWith("a") ? "b" : "a"}`)).status).toBe(401);
  expect((await request("info", result.token, { headers: { Origin: "https://evil.test" } })).status).toBe(403);
  expect((await request("metrics", result.token, { method: "DELETE" })).status).toBe(405);
  const admin = await worker.fetch(new Request("http://localhost/api/v1/admin/snapshot", { headers: { Authorization: `Bearer ${result.token}` } }), { ...env, ENVIRONMENT: "production", APP_ORIGIN: "http://localhost" });
  expect(admin.status).toBe(401);
  const listing = await worker.fetch(new Request("http://localhost/api/v1/admin/agent-tokens"), env);
  expect(await listing.text()).not.toContain(result.token);
  await changeAgentToken(env, undefined, result.tokens[0].id);
  expect((await request("info", result.token)).status).toBe(401);
  const fresh = await credential();
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 86401000);
  try { expect((await request("info", fresh)).status).toBe(401); }
  finally { vi.restoreAllMocks(); }
});

it("shares weighted daily calculations with the dashboard and paginates tied periods", async () => {
  const token = await credential(), a = await createMonitor(), b = await createMonitor();
  await addStat(a.id, "2026-10-01", 60, 30, 100, 1);
  await addStat(b.id, "2026-10-01", 540, 540, 2700, 9);
  const query = "metrics?start=2026-10-01&end=2026-10-02&limit=1";
  const firstPage = await (await request(query, token)).json() as any;
  expect(firstPage.data).toHaveLength(1);
  expect(firstPage.summary.totals).toMatchObject({ availability: 95, latency: 280, outage: 30, checks: 10 });
  expect(firstPage.summary.coverage).toMatchObject({ requested_monitor_days: 4, monitor_days_with_observations: 2, missing_observations_are_uptime: false });
  expect(firstPage.next_cursor).toBeTruthy();
  const secondPage = await (await request(`${query}&cursor=${encodeURIComponent(firstPage.next_cursor)}`, token)).json() as any;
  expect(secondPage.data).toHaveLength(1);
  expect(secondPage.data[0].monitor_id).not.toBe(firstPage.data[0].monitor_id);
  expect(secondPage.next_cursor).toBeNull();
  expect(secondPage.summary).toEqual(firstPage.summary);
  expect((await request(`${query}&monitor=${a.id}&cursor=${encodeURIComponent(firstPage.next_cursor)}`, token)).status).toBe(400);
  const dashboard = await worker.fetch(new Request("http://localhost/api/v1/admin/metrics?start=2026-10-01&end=2026-10-02"), env);
  const body = await dashboard.json() as any;
  expect(body.stats).toHaveLength(2);
  expect(body.incidentDays).toHaveLength(2);
  const { metricTotals } = await import("../src/shared/metrics");
  expect(metricTotals(body.stats)).toEqual(firstPage.summary.totals);
});

it("filters groups consistently and preserves unknown hourly counters", async () => {
  const token = await credential(), group = crypto.randomUUID();
  await statement(env.DB, "INSERT INTO groups(id,project_id,name) VALUES(?,?,'API')", group, projectId).run();
  const chosen = await createMonitor({ group_id: group }), other = await createMonitor();
  await addStat(chosen.id, "2026-10-01", 60, 60, 200, 1);
  await addStat(other.id, "2026-10-01", 60, 0, 0, 0);
  const discovery = await (await request(`monitors?group=${group}`, token)).json() as any;
  expect(discovery.data.map((item: any) => item.id)).toEqual([chosen.id]);
  expect(JSON.stringify(discovery)).not.toMatch(/config|secret-value|heartbeat_hash|example.test/);
  await statement(env.DB, "INSERT INTO hourly_stats(monitor_id,hour,observed_seconds,up_seconds) VALUES(?,'2026-10-01T00',60,60)", chosen.id).run();
  const metrics = await (await request(`metrics?start=2026-10-01&end=2026-10-01&granularity=hour&group=${group}`, token)).json() as any;
  expect(metrics.data[0]).toMatchObject({ check_count: null, latency_sum: null, latency_count: null });
  expect(metrics.summary.totals.availability).toBe(100);
  const dashboard = await worker.fetch(new Request(`http://localhost/api/v1/admin/metrics?start=2026-10-01&end=2026-10-01&group=${group}`), env);
  expect((await dashboard.json() as any).stats.map((item: any) => item.monitor_id)).toEqual([chosen.id]);
});

it("rejects oversized windows, unknown filters and malformed cursors", async () => {
  const token = await credential();
  for (const query of ["start=2026-10-02&end=2026-10-01", "start=2020-01-01&end=2026-10-01", "start=2026-10-01&end=2026-10-01&cursor=nope", "start=2026-10-01&end=2026-10-01&limit=201", "start=2026-10-01&end=2026-10-01&raw_sql=select", "start=2026-10-01&start=2026-10-02&end=2026-10-01"])
    expect((await request(`metrics?${query}`, token)).status).toBe(400);
  expect((await request("checks?start=2026-10-01&end=2026-10-01", token)).status).toBe(400);
});

it("compares periods without inventing baseline metrics", async () => {
  const token = await credential(), monitor = await createMonitor();
  await addStat(monitor.id, "2026-10-01", 600, 540, 300, 1);
  const result = await (await request("compare?baseline_start=2026-09-01&baseline_end=2026-09-01&start=2026-10-01&end=2026-10-01", token)).json() as any;
  expect(result.baseline.totals.availability).toBeNull();
  expect(result.delta.availability_percentage_points).toBeNull();
  expect(result.delta.latency_ms).toBeNull();
  expect(result.delta.outage_seconds).toBeNull();
  expect(result.delta.failed_checks).toBeNull();
  expect(result.comparable_duration).toBe(true);
});

it("returns overlapping incidents and distinguishes recorded notes from telemetry", async () => {
  const token = await credential(), monitor = await createMonitor();
  const open = Date.parse("2026-09-30T23:59:00Z") / 1000;
  await statement(env.DB, "INSERT INTO incidents(id,monitor_id,opened_at,closed_at,reason) VALUES('outage',?,?,?,'timeout')", monitor.id, open, open + 300).run();
  await statement(env.DB, "INSERT INTO public_incidents(id,project_id,origin,impact,stage,title_es,published,opened_at,updated_at) VALUES('provider',?,'manual','down','investigating','Proveedor con inconvenientes',1,?,?)", projectId, open, open).run();
  await statement(env.DB, "INSERT INTO incident_monitors(incident_id,monitor_id) VALUES('provider',?)", monitor.id).run();
  await statement(env.DB, "INSERT INTO maintenance(id,scope,title,starts_at) VALUES('ongoing','global','Maintenance',?)", open).run();
  const result = await (await request("incidents?start=2026-10-01&end=2026-10-01&status=resolved", token)).json() as any;
  expect(result.data.map((item: any) => item.id)).toEqual(["outage"]);
  const detail = await (await request("incidents/outage", token)).json() as any;
  expect(detail.incident.reason).toBe("timeout");
  expect(detail.context[0]).toMatchObject({ origin: "manual", title_es: "Proveedor con inconvenientes" });
  expect(detail.maintenance[0]).toMatchObject({ id: "ongoing", ends_at: null });
  expect(detail.truncated).toEqual({ context: false, maintenance: false, updates: false });
  expect((await request("incidents/missing", token)).status).toBe(404);
});

it("keeps long-term aggregates and incidents while expiring hourly data after 90 days", async () => {
  const monitor = await createMonitor();
  await addStat(monitor.id, "2020-01-01", 60, 60, 100, 1);
  const now = Date.parse("2026-10-18T12:00:00Z") / 1000;
  for (const days of [89, 91]) await statement(env.DB, "INSERT INTO hourly_stats(monitor_id,hour) VALUES(?,?)", monitor.id, new Date((now - days * 86400) * 1000).toISOString().slice(0, 13)).run();
  await statement(env.DB, "INSERT INTO incidents(id,monitor_id,opened_at,closed_at,reason) VALUES('old',?,1,100,'timeout')", monitor.id).run();
  await cleanup(env, now);
  expect(await first(env.DB, "SELECT day FROM daily_stats")).toEqual({ day: "2020-01-01" });
  expect(await first(env.DB, "SELECT id FROM incidents")).toEqual({ id: "old" });
  expect(await first(env.DB, "SELECT COUNT(*) AS count FROM hourly_stats")).toEqual({ count: 1 });
});

it("serves a usable OpenAPI contract and actual stateless MCP tools", async () => {
  const token = await credential();
  const schema = await (await request("openapi.json", token)).json() as any;
  expect(schema.openapi).toBe("3.1.0");
  expect(schema.paths["/api/v1/analytics/metrics"].get.parameters.find((item: any) => item.name === "start").required).toBe(true);
  expect(schema.components.securitySchemes.readOnlyToken.scheme).toBe("bearer");
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: async (input, init) => worker.fetch(new Request(input, init), env)
  });
  await client.connect(transport);
  try {
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(7);
    expect(tools.tools.every((item) => item.annotations?.readOnlyHint === true && item.annotations?.destructiveHint === false)).toBe(true);
    const policy = await client.callTool({ name: "get_data_policy", arguments: {} });
    expect(policy.structuredContent).toMatchObject({ retention: { hourlyDays: 90 }, timezone: "UTC" });
    const metrics = await client.callTool({ name: "get_metrics", arguments: { start: "2026-10-01", end: "2026-10-01" } });
    expect(metrics.isError).not.toBe(true);
    expect(metrics.structuredContent).toMatchObject({ data: [], summary: { totals: { availability: null } } });
    const invalid = await client.callTool({ name: "get_metrics", arguments: { start: "2026-10-02", end: "2026-10-01" } });
    expect(invalid.isError).toBe(true);
  } finally { await client.close(); }
  const unauthorized = await worker.fetch(new Request("http://localhost/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), env);
  expect(unauthorized.status).toBe(401);
});

it("paginates individual observations and incident ties without leaking other monitors", async () => {
  const token = await credential(), monitor = await createMonitor(), other = await createMonitor();
  const checked = Date.parse("2026-10-01T10:00:00Z") / 1000;
  for (let index = 0; index < 3; index++) {
    await statement(env.DB, "INSERT INTO results(job_id,monitor_id,checked_at,ok,reason,diagnostic) VALUES(?,?,?,0,'timeout','Timed out')", `job-${index}`, monitor.id, checked).run();
    await statement(env.DB, "INSERT INTO incidents(id,monitor_id,opened_at,closed_at,reason) VALUES(?,?,?,?,'timeout')", `incident-${index}`, monitor.id, checked, checked + 60).run();
  }
  await statement(env.DB, "INSERT INTO results(job_id,monitor_id,checked_at,ok,reason,diagnostic) VALUES('other',?,?,0,'timeout','Private')", other.id, checked).run();
  for (const resource of ["checks", "incidents"]) {
    const query = `${resource}?start=2026-10-01&end=2026-10-01&monitor=${monitor.id}&limit=2`;
    const page = await (await request(query, token)).json() as any;
    expect(page.data).toHaveLength(2);
    const next = await (await request(`${query}&cursor=${encodeURIComponent(page.next_cursor)}`, token)).json() as any;
    expect(next.data).toHaveLength(1);
    expect(next.next_cursor).toBeNull();
    expect(new Set([...page.data, ...next.data].map((item: any) => item.id)).size).toBe(3);
    expect([...page.data, ...next.data].every((item: any) => item.monitor_id === monitor.id)).toBe(true);
  }
  const successful = await (await request(`checks?start=2026-10-01&end=2026-10-01&monitor=${monitor.id}&result=success`, token)).json() as any;
  expect(successful.data).toEqual([]);
});

it("discovers monitors and queries 48 hourly buckets when a strict client sends null optional fields", async () => {
  const now = Date.parse("2026-10-03T00:00:00Z");
  vi.spyOn(Date, "now").mockReturnValue(now);
  const client = new Client({ name: "strict-agent", version: "1.0.0" });
  try {
    const token = await credential(), monitor = await createMonitor();
    await addStat(monitor.id, "2026-10-01", 86400, 86400, 2400, 24);
    await addStat(monitor.id, "2026-10-02", 86400, 86400, 2400, 24);
    await env.DB.batch(Array.from({ length: 48 }, (_, index) => statement(env.DB,
      "INSERT INTO hourly_stats(monitor_id,hour,observed_seconds,up_seconds,check_count,success_count,latency_sum,latency_count) VALUES(?,?,3600,3600,1,1,100,1)",
      monitor.id, new Date(now - (48 - index) * 3600000).toISOString().slice(0, 13))));
    await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost/mcp"), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
      fetch: async (input, init) => worker.fetch(new Request(input, init), env)
    }));
    const tools = await client.listTools();
    const discover = tools.tools.find((tool) => tool.name === "list_monitors")!;
    expect(discover.inputSchema.required ?? []).toEqual([]);
    const { z } = await import("zod");
    const discoverySchema = z.fromJSONSchema(discover.inputSchema as Parameters<typeof z.fromJSONSchema>[0]);
    expect(discoverySchema.safeParse({}).success).toBe(true);
    const noFilters = { project: null, group: null, monitor: null };
    expect(discoverySchema.safeParse(noFilters).success).toBe(true);
    const strictSchema = z.fromJSONSchema({ ...discover.inputSchema, required: Object.keys(discover.inputSchema.properties ?? {}) } as Parameters<typeof z.fromJSONSchema>[0]);
    expect(strictSchema.safeParse({}).success).toBe(false);
    expect(strictSchema.safeParse(noFilters).success).toBe(true);
    const monitors = await client.callTool({ name: "list_monitors", arguments: noFilters });
    expect(monitors.isError).not.toBe(true);
    expect(monitors.structuredContent).toMatchObject({ data: [{ id: monitor.id }] });
    const policy = await client.callTool({ name: "get_data_policy", arguments: {} });
    expect(policy.structuredContent).toMatchObject({ current_time: "2026-10-03T00:00:00.000Z" });
    const metrics = await client.callTool({ name: "get_metrics", arguments: { start: "2026-10-01", end: "2026-10-02", ...noFilters, granularity: "hour", limit: null, cursor: null } });
    expect(metrics.isError).not.toBe(true);
    const result = metrics.structuredContent as { data: { hour: string }[]; summary: { totals: { observed: number; availability: number; latency: number } } };
    expect(result.data).toHaveLength(48);
    expect(result.data[0].hour).toBe("2026-10-01T00");
    expect(result.data[47].hour).toBe("2026-10-02T23");
    expect(result.summary.totals).toMatchObject({ observed: 172800, availability: 100, latency: 100 });
    const defaults = await client.callTool({ name: "get_metrics", arguments: { start: "2026-10-01", end: "2026-10-02", ...noFilters, granularity: null, limit: null, cursor: null } });
    expect(defaults.isError).not.toBe(true);
    expect(defaults.structuredContent).toMatchObject({ granularity: "day" });
    const compared = await client.callTool({ name: "compare_periods", arguments: { baseline: { start: "2026-10-01", end: "2026-10-01", ...noFilters }, current: { start: "2026-10-02", end: "2026-10-02", ...noFilters } } });
    expect(compared.isError).not.toBe(true);
    expect(compared.structuredContent).toMatchObject({ delta: { availability_percentage_points: 0, latency_ms: 0 } });
    const invalid = await client.callTool({ name: "list_monitors", arguments: { project: "all", group: null, monitor: null } });
    expect(invalid.isError).toBe(true);
  } finally { await client.close(); vi.restoreAllMocks(); }
});
