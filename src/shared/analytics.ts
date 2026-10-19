import { z } from "zod";

export const retention = { checks: "6 calendar months", fiveMinuteHours: 48, hourlyDays: 90, daily: "no automatic expiry", incidents: "no automatic expiry" } as const;
const day = z.iso.date();
export const metricScope = {
  project: z.uuid().optional(),
  group: z.uuid().optional(),
  monitor: z.uuid().optional()
};
export const metricRange = z.object({ start: day, end: day, ...metricScope }).strict();
export type MetricRange = z.infer<typeof metricRange>;
export const metricQuery = metricRange.extend({
  granularity: z.enum(["day", "hour"]).default("day"),
  limit: z.number().int().min(1).max(200).default(100),
  cursor: z.string().max(500).optional()
});
export const incidentQuery = metricRange.extend({
  status: z.enum(["all", "open", "resolved"]).default("all"),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().max(500).optional()
});
export const checkQuery = metricRange.extend({
  monitor: z.uuid(),
  result: z.enum(["all", "success", "failure", "degraded"]).default("all"),
  limit: z.number().int().min(1).max(200).default(100),
  cursor: z.string().max(500).optional()
});
export const comparisonQuery = z.object({ baseline: metricRange, current: metricRange }).strict();
export const tokenInput = z.object({ name: z.string().trim().min(1).max(80), expiresInDays: z.number().int().min(1).max(365).default(90) }).strict();
export const storedToken = z.object({ id: z.uuid(), name: z.string().min(1).max(80), hash: z.string().regex(/^[a-f\d]{64}$/), created_at: z.number().int(), expires_at: z.number().int() }).strict();
export const analyticsSettings = z.object({ hourly_metrics_since: z.number().int().nullable(), tokens: z.array(storedToken).max(20) }).strict();
export type AgentToken = Omit<z.infer<typeof storedToken>, "hash">;

export const compareParams = z.object({ baseline_start: day, baseline_end: day, start: day, end: day, ...metricScope }).strict();
