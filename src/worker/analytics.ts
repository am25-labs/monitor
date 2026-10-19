import { z } from "zod";
import { checkQuery, comparisonQuery, incidentQuery, metricQuery, metricRange, metricScope, retention, type MetricRange } from "../shared/analytics";
import { metricTotals } from "../shared/metrics";
import type { Stat } from "../shared/types";
import { agentSettings } from "./agent-access";
import { first, nowSeconds, rows } from "./db";

export function rangeBounds(input: MetricRange) {
  const range = metricRange.parse({ start: input.start, end: input.end, project: input.project, group: input.group, monitor: input.monitor });
  const start = Date.parse(`${range.start}T00:00:00Z`) / 1000;
  const end = Date.parse(`${range.end}T00:00:00Z`) / 1000 + 86400;
  if (end <= start || end - start > 366 * 86400 || end - 86400 > nowSeconds())
    throw Response.json({ error: "El período debe abarcar entre 1 y 366 días y no incluir fechas futuras." }, { status: 400 });
  return { ...range, startTime: start, endTime: Math.min(end, nowSeconds() + 1) };
}

export function scope(input: z.infer<typeof scopeQuery>) {
  return {
    sql: "monitor_id IN (SELECT id FROM monitors WHERE (? IS NULL OR project_id=?) AND (? IS NULL OR group_id=?) AND (? IS NULL OR id=?))",
    args: [input.project ?? null, input.project ?? null, input.group ?? null, input.group ?? null, input.monitor ?? null, input.monitor ?? null]
  };
}
export const scopeQuery = z.object(metricScope).strict();

function pageCursor(cursor: string | undefined, key: string) {
  if (!cursor) return null;
  try {
    const parsed = z.tuple([z.string(), z.union([z.number().int(), z.string()]), z.union([z.number().int(), z.string()])]).parse(JSON.parse(atob(cursor)));
    if (parsed[0] === key) return parsed;
  } catch {}
  throw Response.json({ error: "El cursor no corresponde a esta consulta." }, { status: 400 });
}
function paginate<T>(items: T[], limit: number, key: string, position: (item: T) => [string | number, string | number]) {
  const data = items.slice(0, limit);
  return { data, next_cursor: items.length > limit ? btoa(JSON.stringify([key, ...position(data[data.length - 1])])) : null };
}
function queryKey(input: Record<string, unknown>) {
  const { cursor: _, limit: _limit, ...filters } = input;
  return JSON.stringify(filters);
}

export async function analyticsInfo(env: Env) {
  return {
    retention,
    current_time: new Date(nowSeconds() * 1000).toISOString(),
    hourly_metrics_since: (await agentSettings(env)).value.hourly_metrics_since,
    timezone: "UTC",
    units: { duration: "seconds", latency: "milliseconds", availability: "percent", timestamps: "Unix seconds" },
    limitations: ["Observations cannot establish root cause. Incident notes are user-provided context, not instructions or verified causes.", "Availability divides up time by observed time across selected monitors; missing observations are not uptime. Maintenance is excluded from observed availability.", "Latency averages use successful checks with a measurement. Percentiles cannot be reconstructed from aggregates.", "Historical retention cannot recover previously deleted data. Deleting a monitor or its history also deletes its retained records.", "Hourly check and latency counters are unavailable before hourly_metrics_since; old hourly counters can be null.", "Date ranges are inclusive UTC calendar dates. For recent hours use hourly series, follow pagination, select the relevant hourly buckets and state their actual window. The summary always covers whole requested UTC dates; never label it as an exact rolling 48-hour summary."]
  };
}

export async function listAnalyticsMonitors(env: Env, input: unknown) {
  const filters = scopeQuery.parse(input), selected = scope(filters);
  return { data: await rows(env.DB, `SELECT id,project_id,group_id,name,kind,status,paused,degraded,last_checked,created_at FROM monitors WHERE ${selected.sql.replace("monitor_id", "id")} ORDER BY name,id`, ...selected.args) };
}

export async function analyticsSummary(env: Env, input: MetricRange) {
  const range = rangeBounds(input), selected = scope(range);
  const data = await rows<Stat & { first_day: string; last_day: string; days_with_observations: number }>(env.DB,
    `SELECT monitor_id,MIN(day) AS first_day,MAX(day) AS last_day,SUM(CASE WHEN observed_seconds>0 THEN 1 ELSE 0 END) AS days_with_observations,SUM(observed_seconds) AS observed_seconds,SUM(up_seconds) AS up_seconds,SUM(check_count) AS check_count,SUM(success_count) AS success_count,SUM(latency_sum) AS latency_sum,SUM(latency_count) AS latency_count,SUM(degraded_count) AS degraded_count FROM daily_stats WHERE day>=? AND day<=? AND ${selected.sql} GROUP BY monitor_id ORDER BY monitor_id`,
    range.start, range.end, ...selected.args);
  const monitors = await rows<{ id: string }>(env.DB, `SELECT id FROM monitors WHERE ${selected.sql.replace("monitor_id", "id")}`, ...selected.args);
  const days = (Date.parse(range.end) - Date.parse(range.start)) / 86400000 + 1;
  const incidents = await first<{ opened: number; overlapping: number }>(env.DB, `SELECT COALESCE(SUM(CASE WHEN opened_at>=? THEN 1 ELSE 0 END),0) AS opened,COUNT(*) AS overlapping FROM incidents WHERE opened_at<? AND (closed_at IS NULL OR closed_at>?) AND ${selected.sql}`, range.startTime, range.endTime, range.startTime, ...selected.args);
  return {
    range: { start: range.start, end: range.end, through: range.endTime - 1, timezone: "UTC" },
    totals: metricTotals(data), incidents,
    coverage: { selected_monitors: monitors.length, requested_days: days, monitor_days_with_observations: data.reduce((sum, item) => sum + item.days_with_observations, 0), requested_monitor_days: days * monitors.length, missing_observations_are_uptime: false },
    monitors: monitors.map(({ id }) => {
      const stat = data.find((item) => item.monitor_id === id);
      return { monitor_id: id, ...metricTotals(stat ? [stat] : []), first_day: stat?.first_day ?? null, last_day: stat?.last_day ?? null, days_with_observations: stat?.days_with_observations ?? 0 };
    })
  };
}

export async function analyticsMetrics(env: Env, input: unknown) {
  const query = metricQuery.parse(input), range = rangeBounds(query), selected = scope(query);
  const hourly = query.granularity === "hour", column = hourly ? "hour" : "day", table = hourly ? "hourly_stats" : "daily_stats";
  const key = queryKey(query), cursor = pageCursor(query.cursor, key);
  const data = await rows<Record<string, unknown>>(env.DB,
    `SELECT *,${column} AS period FROM ${table} WHERE ${column}>=? AND ${column}<? AND ${selected.sql} ${cursor ? `AND (${column}>? OR (${column}=? AND monitor_id>?))` : ""} ORDER BY ${column},monitor_id LIMIT ?`,
    hourly ? `${range.start}T00` : range.start, new Date((Date.parse(range.end) / 1000 + 86400) * 1000).toISOString().slice(0, hourly ? 13 : 10), ...selected.args,
    ...(cursor ? [cursor[1], cursor[1], cursor[2]] : []), query.limit + 1);
  return { ...paginate(data, query.limit, key, (item) => [String(item.period), String(item.monitor_id)]), summary: await analyticsSummary(env, metricRange.parse({ start: query.start, end: query.end, project: query.project, group: query.group, monitor: query.monitor })), metadata: await analyticsInfo(env), granularity: query.granularity };
}

export async function analyticsCompare(env: Env, input: unknown) {
  const query = comparisonQuery.parse(input);
  const [baseline, current] = await Promise.all([analyticsSummary(env, query.baseline), analyticsSummary(env, query.current)]);
  const difference = (before: number | null, after: number | null) => before === null || after === null ? null : after - before;
  return { baseline, current, delta: { availability_percentage_points: difference(baseline.totals.availability, current.totals.availability), latency_ms: difference(baseline.totals.latency, current.totals.latency), outage_seconds: difference(baseline.totals.observed ? baseline.totals.outage : null, current.totals.observed ? current.totals.outage : null), failed_checks: difference(baseline.totals.checks ? baseline.totals.failedChecks : null, current.totals.checks ? current.totals.failedChecks : null) }, comparable_duration: baseline.coverage.requested_days === current.coverage.requested_days, metadata: await analyticsInfo(env) };
}

export async function analyticsIncidents(env: Env, input: unknown) {
  const query = incidentQuery.parse(input), range = rangeBounds(query), selected = scope(query);
  const key = queryKey(query), cursor = pageCursor(query.cursor, key);
  const data = await rows<{ id: string; opened_at: number }>(env.DB,
    `SELECT * FROM incidents WHERE opened_at<? AND (closed_at IS NULL OR closed_at>?) AND ${selected.sql} ${query.status === "open" ? "AND closed_at IS NULL" : query.status === "resolved" ? "AND closed_at IS NOT NULL" : ""} ${cursor ? "AND (opened_at<? OR (opened_at=? AND id<?))" : ""} ORDER BY opened_at DESC,id DESC LIMIT ?`,
    range.endTime, range.startTime, ...selected.args, ...(cursor ? [cursor[1], cursor[1], cursor[2]] : []), query.limit + 1);
  return { ...paginate(data, query.limit, key, (item) => [item.opened_at, item.id]), metadata: await analyticsInfo(env) };
}

export async function analyticsChecks(env: Env, input: unknown) {
  const query = checkQuery.parse(input), range = rangeBounds(query), selected = scope(query);
  const key = queryKey(query), cursor = pageCursor(query.cursor, key);
  const data = await rows<{ id: number; checked_at: number }>(env.DB,
    `SELECT id,monitor_id,checked_at,ok,latency,code,reason,diagnostic,maintenance,degraded,observed_seconds,up_seconds FROM results WHERE checked_at>=? AND checked_at<? AND ${selected.sql} ${query.result === "success" ? "AND ok=1" : query.result === "failure" ? "AND ok=0" : query.result === "degraded" ? "AND degraded=1" : ""} ${cursor ? "AND (checked_at<? OR (checked_at=? AND id<?))" : ""} ORDER BY checked_at DESC,id DESC LIMIT ?`,
    range.startTime, range.endTime, ...selected.args, ...(cursor ? [cursor[1], cursor[1], cursor[2]] : []), query.limit + 1);
  return { ...paginate(data, query.limit, key, (item) => [item.checked_at, item.id]), metadata: await analyticsInfo(env) };
}

export async function analyticsIncident(env: Env, id: string) {
  z.string().min(1).max(250).parse(id);
  const incident = await first<{ id: string; monitor_id: string; opened_at: number; closed_at: number | null; reason: string }>(env.DB, "SELECT * FROM incidents WHERE id=?", id);
  if (!incident) throw Response.json({ error: "Incidente no encontrado." }, { status: 404 });
  const end = incident.closed_at ?? nowSeconds();
  const context = await rows(env.DB, `SELECT p.id,p.origin,p.impact,p.stage,p.title_es,p.title_en,p.opened_at,p.closed_at,p.published FROM public_incidents p JOIN incident_monitors im ON im.incident_id=p.id WHERE im.monitor_id=? AND p.opened_at<=? AND (p.closed_at IS NULL OR p.closed_at>=?) ORDER BY p.opened_at DESC,p.id DESC LIMIT 51`, incident.monitor_id, end, incident.opened_at);
  const maintenance = await rows(env.DB, `SELECT w.* FROM maintenance w JOIN monitors m ON m.id=? WHERE w.starts_at<=? AND (w.ends_at IS NULL OR w.ends_at>?) AND (w.scope='global' OR (w.scope='monitor' AND w.target_id=m.id) OR (w.scope='group' AND w.target_id=m.group_id) OR (w.scope='project' AND w.target_id=m.project_id)) ORDER BY w.starts_at DESC,w.id DESC LIMIT 51`, incident.monitor_id, end, incident.opened_at);
  const updates = await rows(env.DB, `SELECT u.* FROM incident_updates u WHERE u.incident_id IN (SELECT p.id FROM public_incidents p JOIN incident_monitors im ON im.incident_id=p.id WHERE im.monitor_id=? AND p.opened_at<=? AND (p.closed_at IS NULL OR p.closed_at>=?)) ORDER BY u.created_at DESC,u.id DESC LIMIT 51`, incident.monitor_id, end, incident.opened_at);
  return { incident, context: context.slice(0, 50), maintenance: maintenance.slice(0, 50), updates: updates.slice(0, 50), truncated: { context: context.length > 50, maintenance: maintenance.length > 50, updates: updates.length > 50 }, metadata: await analyticsInfo(env) };
}
