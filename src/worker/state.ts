import type { Monitor, Status, Window } from "../shared/types";

export function isMaintenance(m: Monitor, windows: Window[], now: number) {
  return windows.some(
    (w) => w.starts_at <= now && w.ends_at > now && applies(m, w)
  );
}
export function applies(m: Monitor, w: Window) {
  return w.scope === "monitor"
    ? w.target_id === m.id
    : w.scope === "group"
      ? w.target_id === m.group_id
      : w.target_id === m.project_id;
}
export function displayStatus(
  m: Monitor,
  windows: Window[],
  now: number
): Status {
  if (m.paused) return "paused";
  if (isMaintenance(m, windows, now)) return "maintenance";
  if (
    m.last_checked &&
    now - m.last_checked >
      m.interval_seconds * 2 + (m.kind === "heartbeat" ? m.grace_seconds : 0)
  )
    return "unknown";
  return m.status;
}
export function transition(m: Monitor, ok: boolean, maintenance: boolean) {
  if (maintenance || m.paused)
    return { status: m.status, failures: 0, successes: 0 };
  const failures = ok ? 0 : m.failures + 1,
    successes = ok ? m.successes + 1 : 0;
  const status =
    ok && successes >= m.recovery_threshold
      ? "up"
      : !ok && failures >= m.failure_threshold
        ? "down"
        : m.status;
  return { status, failures, successes };
}
export function sixMonthsAgo(now: number) {
  const date = new Date(now * 1000);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() - 6);
  const last = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return Math.floor(date.getTime() / 1000);
}
export function observation(
  m: Monitor,
  windows: Window[],
  now: number,
  maintenance: boolean,
  bucketSeconds = 86400
) {
  if (
    !m.last_checked ||
    m.last_ok === null ||
    maintenance ||
    m.maintenance_active ||
    m.paused
  )
    return [];
  const elapsed = now - m.last_checked;
  if (
    elapsed <= 0 ||
    elapsed >
      m.interval_seconds * 1.5 + (m.kind === "heartbeat" ? m.grace_seconds : 0)
  )
    return [];
  const segments: { day: string; seconds: number; up: number }[] = [];
  let start = m.last_checked;
  while (start < now) {
    const midnight = (Math.floor(start / bucketSeconds) + 1) * bucketSeconds,
      end = Math.min(now, midnight);
    const spans = windows
      .filter((w) => applies(m, w) && w.starts_at < end && w.ends_at > start)
      .map((w) => [Math.max(start, w.starts_at), Math.min(end, w.ends_at)])
      .sort((a, b) => a[0] - b[0]);
    let excluded = 0,
      until = start;
    for (const [a, b] of spans) {
      if (b > until) {
        excluded += b - Math.max(a, until);
        until = b;
      }
    }
    const seconds = end - start - excluded;
    segments.push({
      day: new Date(start * 1000)
        .toISOString()
        .slice(0, bucketSeconds === 3600 ? 13 : 10),
      seconds,
      up: m.last_ok ? seconds : 0
    });
    start = end;
  }
  return segments;
}
