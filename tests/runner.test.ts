import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { env, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { createMonitor, createProject, setup } from "./setup";
import { first, statement } from "../src/worker/db";
import { seal, unseal } from "../src/worker/crypto";
import type { HttpConfig, Monitor } from "../src/shared/types";

const runners: ReturnType<Env["CHECK_RUNNERS"]["getByName"]>[] = [];
beforeEach(async () => {
  await setup();
  await createProject();
});
afterEach(async () => {
  for (const runner of runners.splice(0)) {
    await runInDurableObject(runner, async (_, state) => {
      await state.storage.deleteAlarm();
      await state.storage.deleteAll();
    });
  }
  vi.restoreAllMocks();
});
async function queue(monitor: Monitor, now = Math.floor(Date.now() / 1000)) {
  const id = `${monitor.id}:${monitor.config_version}:${now}`;
  await statement(env.DB, "INSERT OR IGNORE INTO jobs(id,monitor_id,config_version,due_at) VALUES(?,?,?,?)", id, monitor.id, monitor.config_version, now).run();
  const runner = env.CHECK_RUNNERS.getByName(monitor.id);
  runners.push(runner);
  await runInDurableObject(runner, async (instance) => {
    const clock = vi.spyOn(Date, "now").mockReturnValue((now + 600) * 1000);
    try { await instance.enqueue(id); } finally { clock.mockRestore(); }
  });
  return { id, runner };
}

it.each([25, 100])("checks %i monitors through independent alarms without publishing to Queues", async (count) => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  const publish = vi.spyOn(env.CHECKS, "sendBatch");
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ok"));
  const jobs = [];
  for (let i = 0; i < count; i++) jobs.push(await queue(await createMonitor()));
  await Promise.all(jobs.map(({ runner }) => runDurableObjectAlarm(runner)));
  expect(await first(env.DB, "SELECT COUNT(*) AS count FROM results")).toEqual({ count });
  expect(await first(env.DB, "SELECT COUNT(*) AS count FROM jobs WHERE state='completed'")).toEqual({ count });
  expect(publish).not.toHaveBeenCalled();
  for (const { runner } of jobs) {
    expect(await runInDurableObject(runner, (_, state) => state.storage.getAlarm())).toBeNull();
  }
}, 60000);

it("recovers a failed execution and ignores a duplicate dispatch after completion", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ok"));
  const monitor = await createMonitor();
  const now = Math.floor(Date.now() / 1000);
  const { runner } = await queue(monitor, now);
  await runInDurableObject(runner, async (instance) => {
    const bindings = (instance as unknown as { env: Env }).env;
    const prepare = vi.spyOn(bindings.DB, "prepare").mockImplementationOnce(() => { throw new Error("unavailable"); });
    try { await instance.alarm(); } finally { prepare.mockRestore(); }
  });
  expect(await runInDurableObject(runner, (_, state) => state.storage.getAlarm())).not.toBeNull();
  await runDurableObjectAlarm(runner);
  expect(await first(env.DB, "SELECT COUNT(*) AS count FROM results")).toEqual({ count: 1 });
  await queue(monitor, now);
  await runDurableObjectAlarm(runner);
  expect(await first(env.DB, "SELECT COUNT(*) AS count FROM results")).toEqual({ count: 1 });
});

it("discards deleted, paused, and outdated monitors without creating observations", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  const monitors = [await createMonitor(), await createMonitor(), await createMonitor()];
  const jobs = [];
  for (const monitor of monitors) jobs.push(await queue(monitor));
  await statement(env.DB, "UPDATE monitors SET paused=1 WHERE id=?", monitors[0].id).run();
  await statement(env.DB, "UPDATE monitors SET config_version=config_version+1 WHERE id=?", monitors[1].id).run();
  await statement(env.DB, "DELETE FROM monitors WHERE id=?", monitors[2].id).run();
  await Promise.all(jobs.map(({ runner }) => runDurableObjectAlarm(runner)));
  expect(await first(env.DB, "SELECT COUNT(*) AS count FROM results")).toEqual({ count: 0 });
  for (const { runner } of jobs) expect(await runInDurableObject(runner, (_, state) => state.storage.getAlarm())).toBeNull();
});


it("finishes a healthy monitor while another runner is still waiting for its response", async () => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    if (String(input).includes("slow.test"))
      await new Promise((resolve) => setTimeout(resolve, 3000));
    return new Response("ok");
  });
  const monitor = await createMonitor();
  const config = await unseal<HttpConfig>(monitor.config, env.CONFIG_KEY, monitor.id);
  await statement(env.DB, "UPDATE monitors SET config=? WHERE id=?",
    await seal({ ...config, url: "https://slow.test/health" }, env.CONFIG_KEY, monitor.id), monitor.id).run();
  const slow = await queue(monitor);
  const healthy = await queue(await createMonitor());
  const running = runDurableObjectAlarm(slow.runner);
  try {
    await vi.waitFor(async () => {
      expect(await first(env.DB, "SELECT state FROM jobs WHERE id=?", slow.id)).toEqual({ state: "running" });
    });
    await runDurableObjectAlarm(healthy.runner);
    expect(await first(env.DB, "SELECT state FROM jobs WHERE id=?", healthy.id)).toEqual({ state: "completed" });
    expect(await first(env.DB, "SELECT state FROM jobs WHERE id=?", slow.id)).toEqual({ state: "running" });
  } finally {
    await running;
  }
}, 10000);
