import { z } from "zod";

export const retention = { checks: "6 calendar months", fiveMinuteHours: 48, hourlyDays: 90, daily: "no automatic expiry", incidents: "no automatic expiry" } as const;
const day = z.iso.date();
const optionalId = z.uuid().nullish().transform((value) => value ?? undefined);
const cursor = z.string().max(500).nullish().transform((value) => value ?? undefined).describe("Opaque next_cursor from the previous page. Omit or use null for the first page.");
export const metricScope = {
  project: optionalId.describe("Project UUID. Omit or use null for all projects; never invent IDs."),
  group: optionalId.describe("Group UUID. Omit or use null for all groups; never invent IDs."),
  monitor: optionalId.describe("Monitor UUID from list_monitors. Omit or use null for all monitors; never invent IDs.")
};
export const metricRange = z.object({ start: day, end: day, ...metricScope }).strict();
export type MetricRange = z.infer<typeof metricRange>;
export const metricQuery = metricRange.extend({
  granularity: z.enum(["day", "hour"]).nullable().default("day").transform((value) => value ?? "day").describe("Use hour for recent-hour analysis; omit or use null for day. Summary always uses the full requested UTC dates."),
  limit: z.number().int().min(1).max(200).nullable().default(100).transform((value) => value ?? 100),
  cursor
});
export const incidentQuery = metricRange.extend({
  status: z.enum(["all", "open", "resolved"]).nullable().default("all").transform((value) => value ?? "all"),
  limit: z.number().int().min(1).max(100).nullable().default(50).transform((value) => value ?? 50),
  cursor
});
export const checkQuery = metricRange.extend({
  monitor: z.uuid(),
  result: z.enum(["all", "success", "failure", "degraded"]).nullable().default("all").transform((value) => value ?? "all"),
  limit: z.number().int().min(1).max(200).nullable().default(100).transform((value) => value ?? 100),
  cursor
});
export const comparisonQuery = z.object({ baseline: metricRange, current: metricRange }).strict();
export const tokenInput = z.object({ name: z.string().trim().min(1).max(80), expiresInDays: z.number().int().min(1).max(365).default(90) }).strict();
export const storedToken = z.object({ id: z.uuid(), name: z.string().min(1).max(80), hash: z.string().regex(/^[a-f\d]{64}$/), created_at: z.number().int(), expires_at: z.number().int() }).strict();
export const analyticsSettings = z.object({ hourly_metrics_since: z.number().int().nullable(), tokens: z.array(storedToken).max(20) }).strict();
export type AgentToken = Omit<z.infer<typeof storedToken>, "hash">;

export const compareParams = z.object({ baseline_start: day, baseline_end: day, start: day, end: day, ...metricScope }).strict();
