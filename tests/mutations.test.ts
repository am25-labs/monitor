import { afterEach, expect, it, vi } from "vitest";
import { createMutationClient } from "../src/lib/mutations";

afterEach(() => vi.unstubAllGlobals());

it("refreshes active queries after a successful write and returns its result", async () => {
  const invalidate = vi.fn(async () => undefined);
  const fetcher = vi.fn(async () => Response.json({ token: "new-token" }));
  vi.stubGlobal("fetch", fetcher);
  const client = createMutationClient(invalidate);
  expect(await client.mutate("admin/monitors/id/token", "POST", {})).toEqual({ token: "new-token" });
  expect(invalidate).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledOnce();
});

it("does not refresh or retry a failed write", async () => {
  const invalidate = vi.fn(async () => undefined);
  const fetcher = vi.fn(async () => Response.json({ error: "Invalid" }, { status: 400 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(createMutationClient(invalidate).mutate("admin/monitors", "POST", {})).rejects.toThrow("Invalid");
  expect(invalidate).not.toHaveBeenCalled();
  expect(fetcher).toHaveBeenCalledOnce();
});

it("never reports a committed write as failed merely because refreshing failed", async () => {
  const invalidate = vi.fn().mockRejectedValue(new Error("Read failed"));
  const fetcher = vi.fn(async () => Response.json({ id: "created" }));
  vi.stubGlobal("fetch", fetcher);
  expect(await createMutationClient(invalidate).mutate("admin/projects", "POST", {})).toEqual({ id: "created" });
  expect(fetcher).toHaveBeenCalledOnce();
});

it("refreshes once after an entire batch and preserves partial successful writes", async () => {
  const invalidate = vi.fn(async () => undefined);
  const fetcher = vi.fn()
    .mockImplementationOnce(async () => Response.json({ ok: true }))
    .mockImplementationOnce(async () => Response.json({ error: "Conflict" }, { status: 409 }));
  vi.stubGlobal("fetch", fetcher);
  await expect(createMutationClient(invalidate).batch([
    { path: "admin/maintenance/one", method: "PUT", payload: {} },
    { path: "admin/maintenance/two", method: "PUT", payload: {} }
  ])).rejects.toThrow("Conflict");
  expect(invalidate).toHaveBeenCalledOnce();
  expect(fetcher).toHaveBeenCalledTimes(2);
});
