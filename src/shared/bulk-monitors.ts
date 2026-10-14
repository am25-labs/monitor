import { z } from "zod";

const ids = z.array(z.string().uuid()).min(1).max(100).transform((values) => [...new Set(values)]);
export const bulkMonitorInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("project"), ids, project_id: z.string().uuid() }),
  z.object({ action: z.literal("group"), ids, group_id: z.string().uuid().nullable() }),
  z.object({ action: z.literal("pause"), ids, paused: z.boolean() }),
  z.object({ action: z.literal("maintenance"), ids, enabled: z.boolean() })
]);
export type BulkMonitorInput = z.infer<typeof bulkMonitorInput>;

export function visibleSelection(selected: string[], visible: { id: string }[]) {
  const available = new Set(visible.map((monitor) => monitor.id));
  return selected.filter((id) => available.has(id));
}
