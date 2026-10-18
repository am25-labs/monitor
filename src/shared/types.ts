import type { Language } from "./settings";

export type Status =
  "pending" | "up" | "degraded" | "down" | "unknown" | "paused" | "maintenance";
export interface HttpConfig {
  url: string;
  method: "GET" | "HEAD";
  headers: Record<string, string>;
  codes: string;
  followRedirects: boolean;
  timeoutSeconds: number;
  assertion: "none" | "text" | "json";
  text?: string;
  pointer?: string;
  expected?: unknown;
}
export interface TcpConfig {
  host: string;
  port: number;
  timeoutSeconds: number;
}
export type CheckConfig = HttpConfig | TcpConfig | Record<string, never>;
export interface Monitor {
  id: string;
  project_id: string;
  group_id: string | null;
  name: string;
  kind: "http" | "tcp" | "heartbeat";
  config: string;
  config_version: number;
  interval_seconds: number;
  grace_seconds: number;
  latency_threshold: number | null;
  degradation_threshold: number;
  latency_recovery_threshold: number;
  slow_checks: number;
  fast_checks: number;
  degraded: number;
  failure_threshold: number;
  recovery_threshold: number;
  failures: number;
  successes: number;
  status: Status;
  paused: number;
  next_due: number;
  last_checked: number | null;
  last_success: number | null;
  last_latency: number | null;
  last_ok: number | null;
  last_heartbeat: number | null;
  heartbeat_hash: string | null;
  maintenance_active: number;
  created_at: number;
}
export type SafeMonitor = Omit<Monitor, "heartbeat_hash" | "config"> & {
  config: CheckConfig;
  hasCredentials: boolean;
  display_status: Status;
};
export interface Project {
  id: string;
  name: string;
  description: string;
}
export interface Group {
  id: string;
  project_id: string;
  name: string;
}
export interface Incident {
  id: string;
  monitor_id: string;
  opened_at: number;
  closed_at: number | null;
  reason: string;
  monitor_name?: string;
}
export interface IncidentHistory {
  incidents: Incident[];
  nextCursor: Pick<Incident, "opened_at" | "id"> | null;
}
export interface Window {
  id: string;
  scope: "global" | "project" | "group" | "monitor";
  target_id: string | null;
  title: string;
  starts_at: number;
  ends_at: number | null;
}
export interface StatusPage {
  language: Language;
  id: string;
  slug: string;
  title: string;
  description: string;
  project_id: string;
  group_ids: string[];
  excluded_ids: string[];
  included_ids: string[];
  published: boolean;
}
export interface Result {
  degraded: number;
  id: number;
  checked_at: number;
  ok: number;
  latency: number | null;
  code: number | null;
  reason: string;
  diagnostic: string;
  maintenance: number;
}
export interface Stat {
  degraded_count?: number;
  monitor_id: string;
  day: string;
  observed_seconds: number;
  up_seconds: number;
  check_count: number;
  success_count: number;
  latency_sum: number;
  latency_count: number;
}
export interface CheckResult {
  ok: boolean;
  latency: number | null;
  code: number | null;
  reason: string;
  diagnostic: string;
}
export interface Job {
  id: string;
  monitor_id: string;
  config_version: number;
  due_at: number;
  state: string;
  lease_token: string | null;
  lease_until: number | null;
  dispatched_at: number | null;
  attempts: number;
  completed_at: number | null;
}
export interface JobMessage {
  id: string;
}

export interface HistoryStat {
  observed_seconds: number;
  up_seconds: number;
  degraded_count?: number;
}
export interface MonitorHistory {
  updatedAt: number;
  maintenance?: Pick<Window, "starts_at" | "ends_at">[];
  stats: (HistoryStat & { day: string })[];
  hourly: (HistoryStat & { hour: string })[];
  short: (HistoryStat & { slot: string })[];
}
