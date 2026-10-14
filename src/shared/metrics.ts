import type { Stat } from "./types";

export interface IncidentCount {
  monitor_id: string;
  opened: number;
  overlapping: number;
}
export interface IncidentDay { day: string; opened: number; closed: number }
export interface MetricsData {
  start: string;
  end: string;
  stats: Stat[];
  incidents: IncidentCount[];
  incidentDays: IncidentDay[];
}

export function metricTotals(stats: Stat[]) {
  const total = stats.reduce((sum, stat) => ({
    observed: sum.observed + stat.observed_seconds,
    up: sum.up + stat.up_seconds,
    checks: sum.checks + stat.check_count,
    successes: sum.successes + stat.success_count,
    latencySum: sum.latencySum + stat.latency_sum,
    latencyCount: sum.latencyCount + stat.latency_count
  }), { observed: 0, up: 0, checks: 0, successes: 0, latencySum: 0, latencyCount: 0 });
  return {
    ...total,
    availability: total.observed ? total.up / total.observed * 100 : null,
    latency: total.latencyCount ? total.latencySum / total.latencyCount : null,
    outage: total.observed - total.up,
    failedChecks: total.checks - total.successes
  };
}

export function metricDays(stats: Stat[], start: string, end: string) {
  const buckets = new Map<string, Stat[]>();
  for (const stat of stats) {
    const bucket = buckets.get(stat.day) ?? [];
    bucket.push(stat);
    buckets.set(stat.day, bucket);
  }
  const days = [];
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += 86400000) {
    const day = new Date(time).toISOString().slice(0, 10);
    days.push({ day, ...metricTotals(buckets.get(day) ?? []) });
  }
  return days;
}
