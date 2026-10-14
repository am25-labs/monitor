export function createRefreshGroup() {
  const callbacks = new Set<() => Promise<void>>();
  let active: Promise<void> | null = null;
  const group = {
    register(callback: () => Promise<void>) {
      callbacks.add(callback);
      return () => { callbacks.delete(callback); };
    },
    refresh(): Promise<void> {
      if (active) return active;
      active = Promise.allSettled([...callbacks].map((callback) => Promise.resolve().then(callback)))
        .then((results) => {
          const failure = results.find((result) => result.status === "rejected");
          if (failure?.status === "rejected") throw failure.reason;
        })
        .finally(() => { active = null; });
      return active;
    },
    async invalidate(): Promise<void> {
      if (active) await active.catch(() => undefined);
      await group.refresh();
    }
  };
  return group;
}
