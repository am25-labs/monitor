import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { createMonitor, createProject, setup } from "./setup";
import { first } from "../src/worker/db";

let scheduler: ReturnType<typeof env.SCHEDULER.getByName>;
beforeEach(async () => {
  await setup();
  await createProject();
  scheduler = env.SCHEDULER.getByName(crypto.randomUUID());
});
afterEach(async () => {
  await runInDurableObject(scheduler, async (_, state) => {
    await state.storage.deleteAlarm();
    await state.storage.deleteAll();
  });
  vi.restoreAllMocks();
});

it("bootstraps once without postponing the next alarm on repeated cron calls", async () => {
  await Promise.all([scheduler.ensure(), scheduler.ensure(), scheduler.ensure()]);
  const alarm = await runInDurableObject(scheduler, (_, state) => state.storage.getAlarm());
  expect(alarm).not.toBeNull();
  await scheduler.ensure();
  expect(await runInDurableObject(scheduler, (_, state) => state.storage.getAlarm())).toBe(alarm);
});

it("recovers an overdue alarm without replacing a healthy future alarm", async () => {
  await runInDurableObject(scheduler, async (_, state) => {
    await state.storage.setAlarm(Date.now() + 60000);
  });
  const healthy = await runInDurableObject(scheduler, (_, state) => state.storage.getAlarm());
  await scheduler.ensure();
  expect(await runInDurableObject(scheduler, (_, state) => state.storage.getAlarm())).toBe(healthy);
  await runInDurableObject(scheduler, async (instance, state) => {
    const now = healthy! + 180000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      await instance.ensure();
      expect(await state.storage.getAlarm()).toBe(now + 1000);
    } finally {
      clock.mockRestore();
    }
  });
});

it.each([25, 100])("schedules %i monitors and keeps running without additional cron invocations", async (count) => {
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < count; i++) await createMonitor({ next_due: now });
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await scheduler.ensure();
  await runInDurableObject(scheduler, async (instance, state) => {
    const bindings = (instance as unknown as { env: Env }).env;
    const publish = vi.spyOn(bindings.CHECK_RUNNERS, "getByName").mockReturnValue({ enqueue: vi.fn().mockResolvedValue(undefined) } as unknown as ReturnType<Env["CHECK_RUNNERS"]["getByName"]>);
    try {
      await instance.alarm();
      expect(publish).toHaveBeenCalledTimes(count);
      expect(await first(env.DB, "SELECT COUNT(*) AS count FROM jobs WHERE dispatched_at IS NOT NULL")).toEqual({ count });
      expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now());
      await instance.alarm();
      expect(await first(env.DB, "SELECT COUNT(*) AS count FROM jobs")).toEqual({ count });
      expect(publish).toHaveBeenCalledTimes(count);
      const clock = vi.spyOn(Date, "now").mockReturnValue((now + 60) * 1000);
      try {
        await instance.alarm();
        expect(await first(env.DB, "SELECT COUNT(*) AS count FROM jobs")).toEqual({ count: count * 2 });
        expect(publish).toHaveBeenCalledTimes(count * 2);
      } finally {
        clock.mockRestore();
      }
    } finally {
      publish.mockRestore();
    }
  });
  expect(log.mock.calls.map(([value]) => JSON.parse(value)).filter((entry) => entry.event === "engine_cycle").every((entry) => entry.scheduler === "alarm")).toBe(true);
});

it("keeps a retry alarm after a runner fails and dispatches the same job on recovery", async () => {
  await createMonitor({ next_due: Math.floor(Date.now() / 1000) });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  await scheduler.ensure();
  await runInDurableObject(scheduler, async (instance, state) => {
    const bindings = (instance as unknown as { env: Env }).env;
    const enqueue = vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockResolvedValue(undefined);
    const publish = vi.spyOn(bindings.CHECK_RUNNERS, "getByName").mockReturnValue({ enqueue } as unknown as ReturnType<Env["CHECK_RUNNERS"]["getByName"]>);
    try {
      await instance.alarm();
      const retry = await state.storage.getAlarm();
      expect(retry).toBeGreaterThan(Date.now());
      expect(retry).toBeLessThanOrEqual(Date.now() + 15000);
      expect(await first(env.DB, "SELECT COUNT(*) AS count FROM jobs WHERE dispatched_at IS NULL")).toEqual({ count: 1 });
      await instance.alarm();
      expect(await first(env.DB, "SELECT COUNT(*) AS count FROM jobs WHERE dispatched_at IS NOT NULL")).toEqual({ count: 1 });
      expect(await first(env.DB, "SELECT COUNT(*) AS count FROM jobs")).toEqual({ count: 1 });
      expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now());
    } finally {
      publish.mockRestore();
    }
  });
});


it("rearms after a platform alarm fires without a cron call", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  await scheduler.ensure();
  expect(await runDurableObjectAlarm(scheduler)).toBe(true);
  expect(await runInDurableObject(scheduler, (_, state) => state.storage.getAlarm())).toBeGreaterThan(Date.now());
  expect(await first(env.DB, "SELECT last_finished FROM engine WHERE id=1")).toEqual({ last_finished: expect.any(Number) });
});
