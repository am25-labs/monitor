import { historyStatus } from "./incidents";
import type { MonitorHistory } from "./types";

export type HistoryRange = "1h" | "24h" | "7d" | "90d";

function maintenanceSeconds(history: MonitorHistory, start: number, end: number) {
  const spans = (history.maintenance ?? [])
    .map((window) => [Math.max(start, window.starts_at), Math.min(end, window.ends_at ?? end)])
    .filter(([from, to]) => to > from)
    .sort(([a], [b]) => a - b);
  let seconds = 0;
  let until = start;
  for (const [from, to] of spans) {
    seconds += Math.max(0, to - Math.max(from, until));
    until = Math.max(until, to);
  }
  return seconds;
}

export function historySegments(history: MonitorHistory, range: HistoryRange) {
  const count = range === "1h" ? 12 : range === "24h" ? 288 : range === "7d" ? 168 : 90;
  const stride = range === "1h" || range === "24h" ? 300 : range === "7d" ? 3600 : 86400;
  const length = stride === 300 ? 16 : stride === 3600 ? 13 : 10;
  const last = Math.floor(history.updatedAt / stride) * stride;
  const source = stride === 300
    ? history.short.map((stat) => ({ ...stat, key: stat.slot }))
    : stride === 3600
      ? history.hourly.map((stat) => ({ ...stat, key: stat.hour }))
      : history.stats.map((stat) => ({ ...stat, key: stat.day }));
  const byTime = new Map(source.map((stat) => [stat.key, stat]));
  return Array.from({ length: count }, (_, index) => {
    const start = last - (count - 1 - index) * stride;
    const key = new Date(start * 1000).toISOString().slice(0, length);
    const stat = byTime.get(key);
    const expected = Math.min(stride, Math.max(0, history.updatedAt - start));
    const maintenance = maintenanceSeconds(history, start, start + expected);
    const evaluable = expected - maintenance;
    const observed = stat?.observed_seconds ?? 0;
    const coverage = evaluable > 0 ? Math.min(100, observed / evaluable * 100) : 0;
    const partial = start < last && observed > 0 && observed < evaluable;
    const status = historyStatus(stat, range === "7d" || range === "90d");
    const state = maintenance > 0 && (status === "none" || status === "up") ? "maintenance" : status;
    return { start, stat, state, expected, coverage, partial, maintenance };
  });
}

