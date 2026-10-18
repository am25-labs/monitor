import { z } from "zod";

export const providerOutageInput = z.object({
  id: z.uuid(),
  started_at: z.number().int().nonnegative(),
  incident_ids: z.array(z.uuid()).min(1)
});
export type ProviderOutage = z.infer<typeof providerOutageInput>;
export interface ProviderOutageState {
  outage: ProviderOutage | null;
}
export const providerOutageChange = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(true) }).strict(),
  z.object({ enabled: z.literal(false), id: z.uuid() }).strict()
]);
