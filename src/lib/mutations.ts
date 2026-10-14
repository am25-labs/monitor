import { useMemo } from "react";
import { api } from "./api";
import { useRefreshGroup } from "./refresh-context";

export type MutationMethod = "POST" | "PUT" | "PATCH" | "DELETE";
export interface Mutation { path: string; method: MutationMethod; payload?: unknown }

export function createMutationClient(invalidate: () => Promise<void>) {
  async function update() {
    await invalidate().catch(() => undefined);
  }
  return {
    async mutate<T>(path: string, method: MutationMethod, payload?: unknown): Promise<T> {
      const result = await api<T>(path, method, payload);
      await update();
      return result;
    },
    async batch(operations: Mutation[]) {
      const results = await Promise.allSettled(operations.map((operation) => api(operation.path, operation.method, operation.payload)));
      if (results.some((result) => result.status === "fulfilled")) await update();
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      return results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    }
  };
}

export function useMutation() {
  const group = useRefreshGroup();
  return useMemo(() => createMutationClient(() => group.invalidate()), [group]);
}
