import { expect, it, vi } from "vitest";
import { createRefreshGroup } from "../src/lib/refresh-group";

it("refreshes every registered query and waits for the slowest one", async () => {
  const group = createRefreshGroup();
  let completeHistory!: () => void;
  const snapshot = vi.fn(async () => undefined);
  const history = vi.fn(() => new Promise<void>((resolve) => { completeHistory = resolve; }));
  group.register(snapshot);
  group.register(history);
  let finished = false;
  const refreshing = group.refresh().then(() => { finished = true; });
  await Promise.resolve();
  expect(snapshot).toHaveBeenCalledOnce();
  expect(history).toHaveBeenCalledOnce();
  expect(finished).toBe(false);
  completeHistory();
  await refreshing;
  expect(finished).toBe(true);
});

it("removes queries from views that have unmounted and registers their replacement", async () => {
  const group = createRefreshGroup();
  const oldMonitor = vi.fn(async () => undefined);
  const newMonitor = vi.fn(async () => undefined);
  const unregister = group.register(oldMonitor);
  unregister();
  group.register(newMonitor);
  await group.refresh();
  expect(oldMonitor).not.toHaveBeenCalled();
  expect(newMonitor).toHaveBeenCalledOnce();
});

it("coalesces simultaneous clicks and allows a fresh refresh after completion", async () => {
  const group = createRefreshGroup();
  let complete!: () => void;
  const callback = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
  group.register(callback);
  const first = group.refresh();
  expect(group.refresh()).toBe(first);
  await Promise.resolve();
  expect(callback).toHaveBeenCalledOnce();
  complete();
  await first;
  const next = group.refresh();
  expect(next).not.toBe(first);
  await Promise.resolve();
  complete();
  await next;
  expect(callback).toHaveBeenCalledTimes(2);
});

it("clears the active refresh after a failed query so another attempt can run", async () => {
  const group = createRefreshGroup();
  const callback = vi.fn().mockRejectedValueOnce(new Error("Offline")).mockResolvedValue(undefined);
  group.register(callback);
  await expect(group.refresh()).rejects.toThrow("Offline");
  await group.refresh();
  expect(callback).toHaveBeenCalledTimes(2);
});

it("waits for other queries before reporting a failure", async () => {
  const group = createRefreshGroup();
  let complete!: () => void;
  group.register(async () => { throw new Error("Offline"); });
  group.register(() => new Promise<void>((resolve) => { complete = resolve; }));
  let finished = false;
  const result = group.refresh().catch((error) => { finished = true; return error; });
  await Promise.resolve();
  await Promise.resolve();
  expect(finished).toBe(false);
  complete();
  expect(await result).toMatchObject({ message: "Offline" });
});

it("starts another query after mutation even when an earlier refresh was still running", async () => {
  const group = createRefreshGroup();
  let complete!: () => void;
  const callback = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
  group.register(callback);
  const beforeWrite = group.refresh();
  await Promise.resolve();
  const afterWrite = group.invalidate();
  expect(callback).toHaveBeenCalledOnce();
  complete();
  await beforeWrite;
  await vi.waitFor(() => expect(callback).toHaveBeenCalledTimes(2));
  complete();
  await afterWrite;
});
