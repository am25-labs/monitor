import { beforeEach, describe, it, expect, vi } from "vitest";
import { env } from "cloudflare:test";
import { setup, createProject, createMonitor } from "./setup";
import { first, rows, statement } from "../src/worker/db";
import { cleanup, heartbeat, record, runJob, tick } from "../src/worker/engine";
import { displayStatus, observation, sixMonthsAgo } from "../src/worker/state";
import { deliverNotifications } from "../src/worker/mail";
import type { CheckResult, Job, Monitor, Window } from "../src/shared/types";

const failure: CheckResult = {
  ok: false,
  latency: 10000,
  code: null,
  reason: "timeout",
  diagnostic: "El servicio no respondió a tiempo"
};
const success: CheckResult = {
  ok: true,
  latency: 100,
  code: 200,
  reason: "ok",
  diagnostic: "Comprobación exitosa"
};
beforeEach(async () => {
  await setup();
  await createProject();
});
async function sample(id: string, now: number, result: CheckResult) {
  const m = (await first<Monitor>(
    env.DB,
    "SELECT * FROM monitors WHERE id=?",
    id
  ))!;
  const jobId = crypto.randomUUID();
  await statement(
    env.DB,
    "INSERT INTO jobs(id,monitor_id,config_version,due_at,state,lease_token,lease_until) VALUES(?,?,?,?,'running','lease',?)",
    jobId,
    id,
    m.config_version,
    now,
    now + 90
  ).run();
  const job = (await first<Job>(
    env.DB,
    "SELECT * FROM jobs WHERE id=?",
    jobId
  ))!;
  await record(env, job, m, result, "lease", now);
  return job;
}
describe("engine and persistence", () => {
  it("keeps the check cadence when cron delivery times fluctuate", async () => {
    const m = await createMonitor({ next_due: 1020 });
    const executions = [1028, 1083, 1149, 1201, 1266, 1322];
    for (const [index, now] of executions.entries()) {
      await tick(env, now);
      const jobs = await rows<Job>(
        env.DB,
        "SELECT * FROM jobs WHERE monitor_id=? AND state='pending' ORDER BY due_at",
        m.id
      );
      expect(jobs).toHaveLength(index + 1);
      expect(jobs.at(-1)?.due_at).toBe(now);
      await sample(m.id, now, success);
    }
    const updated = (await first<Monitor>(
      env.DB,
      "SELECT * FROM monitors WHERE id=?",
      m.id
    ))!;
    expect(updated.next_due).toBe(1380);
    const totals = await first<{ seconds: number }>(
      env.DB,
      "SELECT SUM(observed_seconds) AS seconds FROM short_stats WHERE monitor_id=?",
      m.id
    );
    expect(totals?.seconds).toBe(1322 - 1028);
  });
  it("skips missed periods without drifting or creating catch-up checks", async () => {
    const m = await createMonitor({ next_due: 1020 });
    await tick(env, 1234);
    expect(
      (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
        ?.next_due
    ).toBe(1260);
    await tick(env, 1261);
    const jobs = await rows<Job>(
      env.DB,
      "SELECT * FROM jobs WHERE monitor_id=? ORDER BY due_at",
      m.id
    );
    expect(jobs.map((job) => job.due_at)).toEqual([1234, 1261]);
    expect(jobs.map((job) => job.id)).toEqual([
      `${m.id}:1:1020`,
      `${m.id}:1:1260`
    ]);
  });
  it("runs a fresh HTTP check after cron misses several intervals", async () => {
    const now = Math.floor(Date.now() / 1000);
    const m = await createMonitor({ next_due: now - 240 });
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("ok"));
    try {
      await tick(env, now);
      await tick(env, now);
      const jobs = await rows<Job>(
        env.DB,
        "SELECT * FROM jobs WHERE monitor_id=?",
        m.id
      );
      expect(jobs).toHaveLength(1);
      expect(jobs[0].due_at).toBe(now);
      await runJob(env, jobs[0].id);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(
        (await first<Job>(env.DB, "SELECT * FROM jobs WHERE id=?", jobs[0].id))
          ?.state
      ).toBe("completed");
      const updated = (await first<Monitor>(
        env.DB,
        "SELECT * FROM monitors WHERE id=?",
        m.id
      ))!;
      expect(updated.last_checked).toBeGreaterThanOrEqual(now);
      expect(displayStatus(updated, [], now)).toBe("up");
      expect(updated.next_due).toBe(now + 60);
    } finally {
      fetch.mockRestore();
    }
  });
  it("detects an overdue heartbeat after a delayed cron cycle", async () => {
    const now = Math.floor(Date.now() / 1000);
    const m = await createMonitor({
      kind: "heartbeat",
      created_at: now - 600,
      next_due: now - 240
    });
    await tick(env, now);
    const job = (await first<Job>(
      env.DB,
      "SELECT * FROM jobs WHERE monitor_id=?",
      m.id
    ))!;
    await runJob(env, job.id);
    expect(
      (await first<Job>(env.DB, "SELECT * FROM jobs WHERE id=?", job.id))?.state
    ).toBe("completed");
    expect(
      (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
        ?.failures
    ).toBe(1);
  });
  it("ignores a missing heartbeat job when a fresh report arrives before execution", async () => {
    const now = Math.floor(Date.now() / 1000);
    const m = await createMonitor({
      kind: "heartbeat",
      created_at: now - 600,
      next_due: now - 240
    });
    await tick(env, now);
    const job = (await first<Job>(
      env.DB,
      "SELECT * FROM jobs WHERE monitor_id=?",
      m.id
    ))!;
    await heartbeat(env, m, true);
    await runJob(env, job.id);
    expect(
      (await first<Job>(env.DB, "SELECT * FROM jobs WHERE id=?", job.id))?.state
    ).toBe("cancelled");
    expect(
      (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
        ?.failures
    ).toBe(0);
  });
  it("opens after two failures, recovers after one success and deduplicates results", async () => {
    const m = await createMonitor();
    await sample(m.id, 1000, failure);
    expect(
      (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
        ?.status
    ).toBe("pending");
    const job = await sample(m.id, 1060, failure);
    expect((await rows(env.DB, "SELECT * FROM incidents")).length).toBe(1);
    await record(env, job, m, failure, "lease", 1060);
    expect((await rows(env.DB, "SELECT * FROM results")).length).toBe(2);
    expect(
      (
        await first<{ n: number }>(
          env.DB,
          "SELECT SUM(check_count) AS n FROM daily_stats"
        )
      )?.n
    ).toBe(2);
    expect(
      (
        await first<{ seconds: number }>(
          env.DB,
          "SELECT SUM(observed_seconds) AS seconds FROM hourly_stats"
        )
      )?.seconds
    ).toBe(60);
    await sample(m.id, 1120, success);
    expect(
      (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
        ?.status
    ).toBe("up");
    expect(
      (await rows<{ closed_at: number }>(env.DB, "SELECT * FROM incidents"))[0]
        .closed_at
    ).toBe(1120);
    expect((await rows(env.DB, "SELECT * FROM notifications")).length).toBe(2);
  });
  it("does not apply stale configuration results", async () => {
    const m = await createMonitor();
    await statement(
      env.DB,
      "INSERT INTO jobs(id,monitor_id,config_version,due_at,state,lease_token) VALUES('stale',?,1,1000,'running','lease')",
      m.id
    ).run();
    await statement(
      env.DB,
      "UPDATE monitors SET config_version=2 WHERE id=?",
      m.id
    ).run();
    const job = (await first<Job>(
      env.DB,
      "SELECT * FROM jobs WHERE id='stale'"
    ))!;
    await record(env, job, m, failure, "lease", 1000);
    expect((await rows(env.DB, "SELECT * FROM results")).length).toBe(0);
  });
  it("does not count queue retries as additional failures", async () => {
    const m = await createMonitor();
    const job = await sample(m.id, 1000, failure);
    await runJob(env, job.id);
    expect(
      (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
        ?.failures
    ).toBe(1);
  });
  it("honors heartbeat tolerance and counts missed periods once", async () => {
    const now = Math.floor(Date.now() / 1000);
    const m = await createMonitor({
      kind: "heartbeat",
      next_due: now + 120,
      created_at: now
    });
    await tick(env, now + 60);
    expect((await rows(env.DB, "SELECT * FROM jobs")).length).toBe(0);
    await tick(env, now + 120);
    await tick(env, now + 120);
    expect((await rows(env.DB, "SELECT * FROM jobs")).length).toBe(1);
    const fresh = await first<Monitor>(
      env.DB,
      "SELECT * FROM monitors WHERE id=?",
      m.id
    );
    expect(fresh?.next_due).toBe(now + 180);
  });
  it("records heartbeat success and deduplicates frequent reports", async () => {
    const m = await createMonitor({ kind: "heartbeat" });
    await heartbeat(env, m, true);
    await heartbeat(
      env,
      (await first<Monitor>(
        env.DB,
        "SELECT * FROM monitors WHERE id=?",
        m.id
      ))!,
      true
    );
    expect((await rows(env.DB, "SELECT * FROM results")).length).toBe(1);
    expect(
      (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
        ?.last_heartbeat
    ).not.toBeNull();
  });
  it("suppresses incidents during maintenance and resets counters on completion", async () => {
    const m = await createMonitor();
    await statement(
      env.DB,
      "INSERT INTO maintenance VALUES('window','project',?,'Deploy',900,1100)",
      m.project_id
    ).run();
    await sample(m.id, 1000, failure);
    await sample(m.id, 1060, failure);
    expect((await rows(env.DB, "SELECT * FROM incidents")).length).toBe(0);
    await tick(env, 1100);
    expect(
      (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
        ?.failures
    ).toBe(0);
  });
  it("suppresses failures globally until manual maintenance ends and then resumes incident detection", async () => {
    const m = await createMonitor();
    await statement(
      env.DB,
      "INSERT INTO maintenance VALUES('global','global',NULL,'Deploy',900,NULL)"
    ).run();
    await sample(m.id, 1000, failure);
    await sample(m.id, 1060, failure);
    expect(await rows(env.DB, "SELECT * FROM incidents")).toHaveLength(0);
    expect(await rows(env.DB, "SELECT * FROM notifications")).toHaveLength(0);
    expect(
      await rows(env.DB, "SELECT * FROM daily_stats WHERE observed_seconds > 0")
    ).toHaveLength(0);
    expect(
      await rows(env.DB, "SELECT * FROM results WHERE maintenance=1")
    ).toHaveLength(2);
    await statement(
      env.DB,
      "UPDATE maintenance SET ends_at=1100 WHERE id='global'"
    ).run();
    await tick(env, 1100);
    await sample(m.id, 1120, failure);
    expect(await rows(env.DB, "SELECT * FROM incidents")).toHaveLength(0);
    await sample(m.id, 1180, failure);
    expect(await rows(env.DB, "SELECT * FROM incidents")).toHaveLength(1);
  });
  it("marks outdated data unknown and splits observed uptime across UTC dates", async () => {
    const m = await createMonitor({
      status: "up",
      last_checked: 86370,
      last_ok: 1
    });
    expect(displayStatus(m, [], 86600)).toBe("unknown");
    expect(observation(m, [], 86430, false)).toEqual([
      { day: "1970-01-01", seconds: 30, up: 30 },
      { day: "1970-01-02", seconds: 30, up: 30 }
    ]);
    const w: Window = {
      id: "w",
      scope: "monitor",
      target_id: m.id,
      title: "X",
      starts_at: 86380,
      ends_at: 86410
    };
    expect(
      observation(m, [w], 86430, false).reduce((n, s) => n + s.seconds, 0)
    ).toBe(30);
    expect(observation(m, [], 87000, false)).toEqual([]);
  });
  it("retains six calendar months including month-end boundaries", async () => {
    const now = Date.UTC(2026, 7, 31, 12) / 1000,
      cutoff = Date.UTC(2026, 1, 28, 12) / 1000;
    expect(sixMonthsAgo(now)).toBe(cutoff);
    const m = await createMonitor();
    await sample(m.id, cutoff - 1, success);
    await sample(m.id, cutoff, success);
    await cleanup(env, now);
    expect(
      (await rows<{ checked_at: number }>(env.DB, "SELECT * FROM results")).map(
        (r) => r.checked_at
      )
    ).toEqual([cutoff]);
  });
  it("schedules 100 monitors without duplicate jobs during overlapping ticks", async () => {
    const now = Math.floor(Date.now() / 1000);
    for (let i = 0; i < 100; i++) await createMonitor({ next_due: now });
    await Promise.all([tick(env, now), tick(env, now)]);
    expect(
      (await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM jobs"))?.n
    ).toBe(100);
    await expect(createMonitor()).rejects.toThrow();
    const monitors = await rows<Monitor>(env.DB, "SELECT * FROM monitors");
    for (const m of monitors) {
      await sample(m.id, now + 1, failure);
      await sample(m.id, now + 61, failure);
    }
    expect(
      (
        await first<{ n: number }>(
          env.DB,
          "SELECT COUNT(*) AS n FROM monitors WHERE status='down'"
        )
      )?.n
    ).toBe(100);
  }, 30000);
  it("intercepts local mail and persists retry failures", async () => {
    const m = await createMonitor();
    await sample(m.id, 1000, failure);
    await sample(m.id, 1060, failure);
    await deliverNotifications(env, 1060);
    expect(
      (
        await first<{ state: string }>(
          env.DB,
          "SELECT state FROM notifications"
        )
      )?.state
    ).toBe("sent");
  });
});

it("recovers expired reservations and blocks overlapping jobs for the same monitor", async () => {
  const now = Math.floor(Date.now() / 1000),
    m = await createMonitor({ kind: "heartbeat", created_at: now - 300 });
  await statement(
    env.DB,
    "INSERT INTO jobs(id,monitor_id,config_version,due_at,state,lease_token,lease_until) VALUES('expired',?,1,?,'running','old',?)",
    m.id,
    now,
    now - 1
  ).run();
  await runJob(env, "expired");
  expect(
    (await first<Job>(env.DB, "SELECT * FROM jobs WHERE id='expired'"))?.state
  ).toBe("completed");
  expect(
    (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
      ?.failures
  ).toBe(1);
  await statement(
    env.DB,
    "INSERT INTO jobs(id,monitor_id,config_version,due_at,state,lease_token,lease_until) VALUES('busy',?,1,?,'running','active',?)",
    m.id,
    now,
    now + 90
  ).run();
  await statement(
    env.DB,
    "INSERT INTO jobs(id,monitor_id,config_version,due_at) VALUES('waiting',?,1,?)",
    m.id,
    now
  ).run();
  await expect(runJob(env, "waiting")).rejects.toThrow("Job busy");
  expect(
    (await first<Job>(env.DB, "SELECT * FROM jobs WHERE id='waiting'"))?.state
  ).toBe("pending");
});
it("ignores results from a replaced lease and cancels overdue jobs without service failures", async () => {
  const now = Math.floor(Date.now() / 1000),
    m = await createMonitor({ kind: "heartbeat" });
  await statement(
    env.DB,
    "INSERT INTO jobs(id,monitor_id,config_version,due_at,state,lease_token) VALUES('replaced',?,1,?,'running','new')",
    m.id,
    now
  ).run();
  const job = (await first<Job>(
    env.DB,
    "SELECT * FROM jobs WHERE id='replaced'"
  ))!;
  await record(env, job, m, failure, "old", now);
  expect((await rows(env.DB, "SELECT * FROM results")).length).toBe(0);
  await statement(
    env.DB,
    "UPDATE jobs SET state='pending',due_at=? WHERE id='replaced'",
    now - 121
  ).run();
  await runJob(env, "replaced");
  expect(
    (await first<Job>(env.DB, "SELECT * FROM jobs WHERE id='replaced'"))?.state
  ).toBe("cancelled");
  expect(
    (await first<Monitor>(env.DB, "SELECT * FROM monitors WHERE id=?", m.id))
      ?.failures
  ).toBe(0);
});

it("drains 100 slow checks with five batches of five concurrent jobs and no duplicate results", async () => {
  const now = Math.floor(Date.now() / 1000);
  for (let i = 0; i < 100; i++) await createMonitor({ next_due: now });
  await tick(env, now);
  const jobs = await rows<Job>(env.DB, "SELECT * FROM jobs");
  let active = 0,
    peak = 0;
  const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 100));
    active--;
    return new Response("healthy");
  });
  try {
    const consumers = Array.from({ length: 5 }, async (_, consumer) => {
      for (let offset = consumer * 5; offset < jobs.length; offset += 25)
        await Promise.all(
          jobs.slice(offset, offset + 5).map((job) => runJob(env, job.id))
        );
    });
    await Promise.all(consumers);
    expect(peak).toBeLessThanOrEqual(25);
    expect(
      (await first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM results"))
        ?.n
    ).toBe(100);
    expect(
      (
        await first<{ n: number }>(
          env.DB,
          "SELECT COUNT(*) AS n FROM jobs WHERE state IN ('pending','running')"
        )
      )?.n
    ).toBe(0);
    await Promise.all(jobs.map((job) => runJob(env, job.id)));
    expect(
      (
        await first<{ n: number }>(
          env.DB,
          "SELECT SUM(check_count) AS n FROM daily_stats"
        )
      )?.n
    ).toBe(100);
  } finally {
    mock.mockRestore();
  }
}, 30000);

it("splits hourly observations and excludes overlapping maintenance and stale data", async () => {
  const m = await createMonitor({ last_checked: 3570, last_ok: 1 });
  const window: Window = {
    id: "hour-window",
    scope: "monitor",
    target_id: m.id,
    title: "Maintenance",
    starts_at: 3580,
    ends_at: 3610
  };
  expect(
    observation(
      m,
      [window, { ...window, id: "overlap", starts_at: 3590 }],
      3630,
      false,
      3600
    )
  ).toEqual([
    { day: "1970-01-01T00", seconds: 10, up: 10 },
    { day: "1970-01-01T01", seconds: 20, up: 20 }
  ]);
  expect(observation(m, [], 4000, false, 3600)).toEqual([]);
  await statement(
    env.DB,
    "INSERT INTO maintenance VALUES(?,?,?,?,?,?)",
    window.id,
    window.scope,
    window.target_id,
    window.title,
    window.starts_at,
    window.ends_at
  ).run();
  await sample(m.id, 3630, success);
  expect(
    (
      await first<{ seconds: number }>(
        env.DB,
        "SELECT SUM(observed_seconds) AS seconds FROM hourly_stats"
      )
    )?.seconds
  ).toBe(30);
  await statement(
    env.DB,
    "INSERT INTO hourly_stats(monitor_id,hour,observed_seconds,up_seconds) VALUES(?,?,?,?)",
    m.id,
    "1969-12-20T00",
    60,
    60
  ).run();
  await cleanup(env, 3630);
  expect((await rows(env.DB, "SELECT * FROM hourly_stats")).length).toBe(2);
});

it("records five-minute slots across boundaries without expanding a brief outage", async () => {
  const m = await createMonitor({ last_checked: 1170, last_ok: 0 });
  expect(observation(m, [], 1230, false, 300)).toEqual([
    { day: "1970-01-01T00:15", seconds: 30, up: 0 },
    { day: "1970-01-01T00:20", seconds: 30, up: 0 }
  ]);
  const job = await sample(m.id, 1230, success);
  await record(env, job, m, success, "lease", 1230);
  await sample(m.id, 1290, success);
  expect(
    await rows(
      env.DB,
      "SELECT slot,observed_seconds,up_seconds FROM short_stats ORDER BY slot"
    )
  ).toEqual([
    { slot: "1970-01-01T00:15", observed_seconds: 30, up_seconds: 0 },
    { slot: "1970-01-01T00:20", observed_seconds: 90, up_seconds: 60 }
  ]);
  await statement(
    env.DB,
    "INSERT INTO short_stats(monitor_id,slot,observed_seconds,up_seconds) VALUES(?,?,?,?)",
    m.id,
    "1969-12-29T00:00",
    60,
    60
  ).run();
  await cleanup(env, 1290);
  expect((await rows(env.DB, "SELECT * FROM short_stats")).length).toBe(2);
});
