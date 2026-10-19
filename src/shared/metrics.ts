import type { Stat } from "./types";
import { historyStatus } from "./incidents";

export interface IncidentCount {
  monitor_id: string;
  opened: number;
  overlapping: number;
}
export interface IncidentDay { day: string; opened: number; closed: number }
export interface MetricsData {
  query?: string;
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
  const days: (ReturnType<typeof metricTotals> & { day: string; state: ReturnType<typeof historyStatus> })[] = [];
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`); time += 86400000) {
    const day = new Date(time).toISOString().slice(0, 10);
    const bucket = buckets.get(day) ?? [];
    const total = metricTotals(bucket);
    const state = historyStatus({ observed_seconds: total.observed, up_seconds: total.up, degraded_count: bucket.reduce((sum, stat) => sum + (stat.degraded_count ?? 0), 0) }, true);
    days.push({ day, ...total, state });
  }
  return days;
}
