import { createContext, useContext, useState, type ReactNode } from "react";
import { createRefreshGroup } from "./refresh-group";

export const RefreshContext = createContext<ReturnType<typeof createRefreshGroup> | null>(null);

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [group] = useState(createRefreshGroup);
  return <RefreshContext.Provider value={group}>{children}</RefreshContext.Provider>;
}

export function useRefreshGroup() {
  const group = useContext(RefreshContext);
  if (!group) throw new Error("RefreshProvider is required");
  return group;
}
