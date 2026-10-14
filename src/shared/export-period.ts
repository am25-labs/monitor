import { z } from "zod";

export const exportPeriod = z.object({
  type: z.enum(["month", "year"]),
  year: z.number().int().min(1970).max(9998),
  month: z.number().int().min(1).max(12).optional(),
  timeZone: z.literal("UTC"),
  start: z.iso.datetime(),
  end: z.iso.datetime()
}).strict();

export type ExportPeriod = z.infer<typeof exportPeriod>;

export function readExportPeriod(params: URLSearchParams): ExportPeriod | undefined {
  if (!params.has("period") && !params.has("year") && !params.has("month")) return;
  const type = z.enum(["month", "year"]).parse(params.get("period"));
  const year = z.coerce.number().int().min(1970).max(9998).parse(params.get("year"));
  const month = type === "month" ? z.coerce.number().int().min(1).max(12).parse(params.get("month")) : undefined;
  const start = new Date(Date.UTC(year, month === undefined ? 0 : month - 1, 1));
  const end = new Date(Date.UTC(month === undefined ? year + 1 : year, month ?? 0, 1));
  return { type, year, ...(month === undefined ? {} : { month }), timeZone: "UTC", start: start.toISOString(), end: end.toISOString() };
}
