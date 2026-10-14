import { afterEach, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("recovers from a transient network failure while reading public status", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn()
    .mockRejectedValueOnce(new TypeError("Failed to fetch"))
    .mockResolvedValueOnce(Response.json({ updatedAt: 123 }));
  vi.stubGlobal("fetch", fetcher);
  const result = api("public/am25");
  await vi.advanceTimersByTimeAsync(500);
  expect(await result).toEqual({ updatedAt: 123 });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("reports persistent network failures with a useful message", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetcher);
  const result = expect(api("public/am25")).rejects.toThrow("No se pudo conectar con Monitor.");
  await vi.advanceTimersByTimeAsync(500);
  await result;
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("never repeats a mutation after a network failure", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetcher);
  await expect(api("admin/monitors", "POST", { name: "Monitor" })).rejects.toThrow("No se pudo conectar con Monitor.");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("cancels a pending retry when the page changes", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetcher = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
  vi.stubGlobal("fetch", fetcher);
  const result = expect(api("public/am25", "GET", undefined, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await vi.advanceTimersByTimeAsync(400);
  await result;
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("preserves errors returned by the server", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "Servicio no disponible" }, { status: 503 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(api("public/am25")).rejects.toThrow("Servicio no disponible");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("bypasses browser caching when reading refreshed data", async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ updatedAt: 456 }));
  vi.stubGlobal("fetch", fetcher);
  await api("admin/snapshot");
  expect(fetcher).toHaveBeenCalledWith("/api/v1/admin/snapshot", expect.objectContaining({ method: "GET", cache: "no-store" }));
  await api("admin/monitors", "POST", { name: "Monitor" });
  expect(fetcher.mock.calls[1][1].cache).toBeUndefined();
});
