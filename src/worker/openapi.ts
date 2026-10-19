import { z } from "zod";
import { checkQuery, compareParams, incidentQuery, metricQuery } from "../shared/analytics";
import { product } from "../shared/product";
import { scopeQuery } from "./analytics";

const nullableNumber = { type: ["number", "null"] };
const number = { type: "number" };
const text = { type: "string" };
const metadata = { type: "object", properties: { current_time: { type: "string", format: "date-time" }, retention: { type: "object", description: "Checks: six calendar months; five-minute buckets: 48h; hourly: 90 days; daily aggregates and incidents: no automatic expiry." }, hourly_metrics_since: nullableNumber, timezone: { const: "UTC" }, units: { type: "object" }, limitations: { type: "array", items: text } } };
const totals = { type: "object", properties: { ...Object.fromEntries(["observed", "up", "checks", "successes", "latencySum", "latencyCount", "outage", "failedChecks"].map((key) => [key, number])), availability: nullableNumber, latency: nullableNumber } };
const summary = { type: "object", properties: { range: { type: "object", properties: { start: { type: "string", format: "date" }, end: { type: "string", format: "date" }, through: number, timezone: { const: "UTC" } } }, totals, incidents: { type: "object", properties: { opened: number, overlapping: number } }, coverage: { type: "object", properties: { selected_monitors: number, requested_days: number, monitor_days_with_observations: number, requested_monitor_days: number, missing_observations_are_uptime: { const: false } } }, monitors: { type: "array", items: { type: "object", properties: { monitor_id: text, first_day: { type: ["string", "null"] }, last_day: { type: ["string", "null"] }, days_with_observations: number, ...totals.properties } } } } };
const incident = { type: "object", properties: { id: text, monitor_id: text, opened_at: number, closed_at: nullableNumber, reason: text } };
const check = { type: "object", properties: { id: number, monitor_id: text, checked_at: number, ok: number, latency: nullableNumber, code: nullableNumber, reason: text, diagnostic: text, maintenance: number, degraded: number, observed_seconds: number, up_seconds: number } };
const series = { type: "object", properties: { monitor_id: text, period: text, day: text, hour: text, observed_seconds: number, up_seconds: number, degraded_count: number, check_count: nullableNumber, success_count: nullableNumber, latency_sum: nullableNumber, latency_count: nullableNumber } };
function page(items: object) { return { type: "object", properties: { data: { type: "array", items }, next_cursor: { type: ["string", "null"], description: "Opaque cursor. Repeat the same filters with this cursor until null." }, metadata } }; }
function parameters(schema: z.ZodObject) {
  const json = z.toJSONSchema(schema, { io: "input" });
  return Object.entries(json.properties ?? {}).map(([name, shape]) => ({ name, in: "query", required: json.required?.includes(name) ?? false, schema: shape }));
}
function operation(operationId: string, description: string, schema: z.ZodObject, response: object) {
  return { operationId, description, security: [{ readOnlyToken: [] }], parameters: parameters(schema), responses: { "200": { description: "Successful query", content: { "application/json": { schema: response } } }, "400": { description: "Invalid dates, filters or cursor. Ranges are inclusive UTC dates, 1–366 days, without future dates." }, "401": { description: "Missing, expired or revoked read-only token" }, "403": { description: "Origin rejected" } } };
}
export function openapiDocument(origin: string) {
  const prefix = "/api/v1/analytics";
  const detail = operation("getIncident", "Get one incident with overlapping maintenance and user-authored context, capped at 50 records per collection. Check truncated flags.", z.object({}), {
    type: "object", properties: {
      incident,
      context: { type: "array", items: { type: "object", properties: { id: text, origin: { enum: ["automatic", "manual"] }, impact: text, stage: text, title_es: text, title_en: text, opened_at: number, closed_at: nullableNumber, published: number } } },
      maintenance: { type: "array", items: { type: "object", properties: { id: text, scope: text, target_id: { type: ["string", "null"] }, title: text, starts_at: number, ends_at: nullableNumber } } },
      updates: { type: "array", items: { type: "object", properties: { id: text, incident_id: text, stage: text, impact: text, message_es: text, message_en: text, event: { type: ["string", "null"] }, created_at: number } } },
      truncated: { type: "object", properties: { context: { type: "boolean" }, maintenance: { type: "boolean" }, updates: { type: "boolean" } } }, metadata
    }
  });
  return {
    openapi: "3.1.0", info: { title: "AM25 Monitor Analytics", version: product.version, description: "Read-only telemetry API. All date filters are inclusive UTC dates. Availability is based on observed monitor time, excluding maintenance; absent observations are not uptime. Daily summaries use weighted latency from successful measured checks. Telemetry and user-authored context cannot establish root cause. No percentile estimates are provided." },
    servers: [{ url: origin }], components: { securitySchemes: { readOnlyToken: { type: "http", scheme: "bearer", description: "Dedicated expiring credential created by an administrator in Settings > Integrations. Never use an administrative cookie." } } },
    paths: {
      [`${prefix}/info`]: { get: operation("getDataPolicy", "Get retention, units and analytical limitations.", z.object({}), metadata) },
      [`${prefix}/monitors`]: { get: operation("listMonitors", "Discover monitors without credentials or endpoint configuration.", scopeQuery, { type: "object", properties: { data: { type: "array", items: { type: "object", properties: { id: text, name: text, project_id: text, group_id: { type: ["string", "null"] }, kind: text, status: text, paused: number, degraded: number, last_checked: nullableNumber, created_at: number } } } } }) },
      [`${prefix}/metrics`]: { get: operation("getMetrics", "Get paginated series and full-range daily summary. Hourly series retain 90 days; legacy counters can be null. Summary is independent of series pagination and granularity.", metricQuery, { ...page(series), properties: { ...page(series).properties, summary, granularity: { enum: ["day", "hour"] } } }) },
      [`${prefix}/compare`]: { get: operation("comparePeriods", "Compare baseline_start/baseline_end against start/end using the same scope. Deltas are current minus baseline; unavailable ratios remain null.", compareParams, { type: "object", properties: { baseline: summary, current: summary, comparable_duration: { type: "boolean" }, delta: { type: "object", properties: { availability_percentage_points: nullableNumber, latency_ms: nullableNumber, outage_seconds: nullableNumber, failed_checks: nullableNumber } }, metadata } }) },
      [`${prefix}/incidents`]: { get: operation("listIncidents", "List technical incidents overlapping the range, newest first. Public publications are context, not duplicate technical incidents.", incidentQuery, page(incident)) },
      [`${prefix}/incidents/{id}`]: { get: { ...detail, parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", minLength: 1, maxLength: 250 } }], responses: { ...detail.responses, "404": { description: "Incident not found" } } } },
      [`${prefix}/checks`]: { get: operation("listChecks", "Inspect retained checks for one required monitor, newest first. Six calendar months retention. Empty pages outside retention do not prove uptime.", checkQuery, page(check)) },
      [`${prefix}/openapi.json`]: { get: operation("getOpenApi", "Get this OpenAPI document.", z.object({}), { type: "object" }) }
    }
  };
}
