import { afterEach, expect, it, vi } from "vitest";
import { durableCall } from "../src/worker/durable-call";

afterEach(() => vi.useRealTimers());

it("retries transient calls with exponential delays", async () => {
  vi.useFakeTimers();
  const error = Object.assign(new Error("Connection closed"), { retryable: true });
  const call = vi.fn().mockRejectedValueOnce(error).mockRejectedValueOnce(error).mockResolvedValue("queued");
  const result = durableCall(call);
  expect(call).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(99);
  expect(call).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(call).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(200);
  await expect(result).resolves.toBe("queued");
  expect(call).toHaveBeenCalledTimes(3);
});

it("stops after three transient failures", async () => {
  vi.useFakeTimers();
  const error = Object.assign(new Error("Unavailable"), { retryable: true });
  const call = vi.fn().mockRejectedValue(error);
  const result = expect(durableCall(call)).rejects.toBe(error);
  await vi.advanceTimersByTimeAsync(300);
  await result;
  expect(call).toHaveBeenCalledTimes(3);
});

it.each([
  new Error("Application error"),
  Object.assign(new Error("Overloaded"), { retryable: true, overloaded: true })
])("does not retry application failures or overloaded instances", async (error) => {
  const call = vi.fn().mockRejectedValue(error);
  await expect(durableCall(call)).rejects.toBe(error);
  expect(call).toHaveBeenCalledTimes(1);
});
