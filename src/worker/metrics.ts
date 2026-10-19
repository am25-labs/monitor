import { z } from "zod";
import { metricRange } from "../shared/analytics";
import { rangeBounds, scope as analyticsScope } from "./analytics";
import { nowSeconds, rows } from "./db";
import type { Stat } from "../shared/types";
import type { IncidentCount, IncidentDay, MetricsData } from "../shared/metrics";

export async function metricsData(request: Request, env: Env): Promise<MetricsData> {
  const params = new URL(request.url).searchParams;
  const days = Number(z.enum(["7", "30", "90"]).parse(params.get("days") ?? "30"));
  const project = params.has("project") ? z.uuid().parse(params.get("project")) : null;
  const group = params.has("group") ? z.uuid().parse(params.get("group")) : null;
  const monitor = params.has("monitor") ? z.uuid().parse(params.get("monitor")) : null;
  const now = nowSeconds();
  const endTime = Math.floor(now / 86400) * 86400;
  let startTime = endTime - (days - 1) * 86400;
  const range = rangeBounds(metricRange.parse({ start: params.get("start") ?? new Date(startTime * 1000).toISOString().slice(0, 10), end: params.get("end") ?? new Date(endTime * 1000).toISOString().slice(0, 10), project: project ?? undefined, group: group ?? undefined, monitor: monitor ?? undefined }));
  startTime = range.startTime;
  const { start, end } = range;
  const through = range.endTime;
  const { sql: scope, args } = analyticsScope(range);
  const [stats, incidents, events] = await Promise.all([
    rows<Stat>(env.DB, `SELECT * FROM daily_stats WHERE day>=? AND day<=? AND ${scope} ORDER BY day,monitor_id`, start, end, ...args),
    rows<IncidentCount>(env.DB, `SELECT monitor_id,SUM(CASE WHEN opened_at>=? THEN 1 ELSE 0 END) AS opened,COUNT(*) AS overlapping FROM incidents WHERE opened_at<? AND (closed_at IS NULL OR closed_at>?) AND ${scope} GROUP BY monitor_id`, startTime, through, startTime, ...args),
    rows<{ day: string; event: string; count: number }>(env.DB, `SELECT date(opened_at,'unixepoch') AS day,'opened' AS event,COUNT(*) AS count FROM incidents WHERE opened_at>=? AND opened_at<=? AND ${scope} GROUP BY day UNION ALL SELECT date(closed_at,'unixepoch') AS day,'closed' AS event,COUNT(*) AS count FROM incidents WHERE closed_at>=? AND closed_at<=? AND ${scope} GROUP BY day`, startTime, through - 1, ...args, startTime, through - 1, ...args)
  ]);
  const incidentDays: IncidentDay[] = [];
  for (let time = startTime; time <= Date.parse(end) / 1000; time += 86400) {
    const day = new Date(time * 1000).toISOString().slice(0, 10);
    incidentDays.push({ day, opened: events.find((event) => event.day === day && event.event === "opened")?.count ?? 0, closed: events.find((event) => event.day === day && event.event === "closed")?.count ?? 0 });
  }
  return { query: params.toString(), start, end, stats, incidents, incidentDays };
}
