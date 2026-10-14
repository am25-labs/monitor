import { z } from "zod";
import { nowSeconds, rows } from "./db";
import type { Stat } from "../shared/types";
import type { IncidentCount, IncidentDay, MetricsData } from "../shared/metrics";

export async function metricsData(request: Request, env: Env): Promise<MetricsData> {
  const params = new URL(request.url).searchParams;
  const days = Number(z.enum(["7", "30", "90"]).parse(params.get("days") ?? "30"));
  const project = params.has("project") ? z.uuid().parse(params.get("project")) : null;
  const monitor = params.has("monitor") ? z.uuid().parse(params.get("monitor")) : null;
  const now = nowSeconds();
  const endTime = Math.floor(now / 86400) * 86400;
  const startTime = endTime - (days - 1) * 86400;
  const start = new Date(startTime * 1000).toISOString().slice(0, 10);
  const end = new Date(endTime * 1000).toISOString().slice(0, 10);
  const scope = "monitor_id IN (SELECT id FROM monitors WHERE (? IS NULL OR project_id=?) AND (? IS NULL OR id=?))";
  const args = [project, project, monitor, monitor];
  const [stats, incidents, events] = await Promise.all([
    rows<Stat>(env.DB, `SELECT * FROM daily_stats WHERE day>=? AND day<=? AND ${scope} ORDER BY day,monitor_id`, start, end, ...args),
    rows<IncidentCount>(env.DB, `SELECT monitor_id,SUM(CASE WHEN opened_at>=? THEN 1 ELSE 0 END) AS opened,COUNT(*) AS overlapping FROM incidents WHERE opened_at<? AND (closed_at IS NULL OR closed_at>?) AND ${scope} GROUP BY monitor_id`, startTime, now + 1, startTime, ...args),
    rows<{ day: string; event: string; count: number }>(env.DB, `SELECT date(opened_at,'unixepoch') AS day,'opened' AS event,COUNT(*) AS count FROM incidents WHERE opened_at>=? AND opened_at<=? AND ${scope} GROUP BY day UNION ALL SELECT date(closed_at,'unixepoch') AS day,'closed' AS event,COUNT(*) AS count FROM incidents WHERE closed_at>=? AND closed_at<=? AND ${scope} GROUP BY day`, startTime, now, ...args, startTime, now, ...args)
  ]);
  const incidentDays: IncidentDay[] = [];
  for (let time = startTime; time <= endTime; time += 86400) {
    const day = new Date(time * 1000).toISOString().slice(0, 10);
    incidentDays.push({ day, opened: events.find((event) => event.day === day && event.event === "opened")?.count ?? 0, closed: events.find((event) => event.day === day && event.event === "closed")?.count ?? 0 });
  }
  return { start, end, stats, incidents, incidentDays };
}
