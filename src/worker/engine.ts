import type {
  CheckConfig,
  CheckResult,
  Job,
  JobMessage,
  Monitor,
  Window
} from "../shared/types";
import { check, reasons } from "./checks";
import { first, rows, statement, nowSeconds } from "./db";
import { unseal } from "./crypto";
import {
  applies,
  isMaintenance,
  observation,
  sixMonthsAgo,
  transition,
  latencyState
} from "./state";
import { automaticStatements } from "./incidents";
import { deliverNotifications } from "./mail";
import { providerOutageActive } from "./provider-outage";
import { durableCall } from "./durable-call";

class JobBusyError extends Error {}

class JobExecutionError extends Error {
  constructor(readonly stage: string, cause: unknown) {
    super("Check execution failed", { cause });
  }
}

export async function windows(env: Env) {
  return rows<Window>(env.DB, "SELECT * FROM maintenance");
}

export async function record(
  env: Env,
  job: Job,
  m: Monitor,
  result: CheckResult,
  lease: string,
  now: number,
  heartbeat = false
) {
  const activeWindows = await windows(env),
    maintenance = isMaintenance(m, activeWindows, now);
  const ended = Boolean(
    m.last_checked &&
      activeWindows.some(
        (w) =>
          applies(m, w) &&
          w.ends_at !== null &&
          w.ends_at > m.last_checked! &&
          w.ends_at <= now
      )
  );
  const baseline =
    ended || (!maintenance && m.maintenance_active)
      ? { ...m, failures: 0, successes: 0, slow_checks: 0, fast_checks: 0, degraded: 0 }
      : m;
  const next = transition(baseline, result.ok, maintenance);
  const latency = latencyState(baseline, result, maintenance);
  const segments = observation(m, activeWindows, now, maintenance);
  const observed = segments.reduce((sum, s) => sum + s.seconds, 0),
    up = segments.reduce((sum, s) => sum + s.up, 0);
  const guarded = `EXISTS(SELECT 1 FROM results r JOIN jobs j ON j.id=r.job_id WHERE r.job_id=? AND r.checked_at=? AND j.state='running' AND j.lease_token=?)`;
  const batch = [
    statement(
      env.DB,
      `INSERT OR IGNORE INTO results(job_id,monitor_id,checked_at,ok,latency,code,reason,diagnostic,maintenance,observed_seconds,up_seconds)
      SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM jobs j JOIN monitors m ON m.id=j.monitor_id WHERE j.id=? AND j.state='running' AND j.lease_token=? AND m.config_version=j.config_version AND m.paused=0 AND (m.last_checked IS NULL OR m.last_checked<?))`,
      job.id,
      m.id,
      now,
      +result.ok,
      result.latency,
      result.code,
      result.reason,
      result.diagnostic,
      +maintenance,
      observed,
      up,
      job.id,
      lease,
      now
    ),
    statement(
      env.DB,
      `UPDATE monitors SET status=?,failures=?,successes=?,last_checked=?,last_ok=?,last_success=CASE WHEN ? THEN ? ELSE last_success END,last_latency=?,maintenance_active=?,last_heartbeat=CASE WHEN ? THEN ? ELSE last_heartbeat END,next_due=CASE WHEN ? THEN ? ELSE next_due END WHERE id=? AND config_version=? AND ${guarded}`,
      next.status,
      next.failures,
      next.successes,
      now,
      +result.ok,
      +result.ok,
      now,
      result.latency,
      +maintenance,
      +heartbeat,
      now,
      +heartbeat,
      now + m.interval_seconds + m.grace_seconds,
      m.id,
      job.config_version,
      job.id,
      now,
      lease
    )
  ];
  for (const segment of segments)
    batch.push(
      statement(
        env.DB,
        `INSERT INTO daily_stats(monitor_id,day,observed_seconds,up_seconds) SELECT ?,?,?,? WHERE ${guarded} ON CONFLICT(monitor_id,day) DO UPDATE SET observed_seconds=observed_seconds+excluded.observed_seconds,up_seconds=up_seconds+excluded.up_seconds`,
        m.id,
        segment.day,
        segment.seconds,
        segment.up,
        job.id,
        now,
        lease
      )
    );
  for (const segment of observation(m, activeWindows, now, maintenance, 3600))
    batch.push(
      statement(
        env.DB,
        `INSERT INTO hourly_stats(monitor_id,hour,observed_seconds,up_seconds) SELECT ?,?,?,? WHERE ${guarded} ON CONFLICT(monitor_id,hour) DO UPDATE SET observed_seconds=observed_seconds+excluded.observed_seconds,up_seconds=up_seconds+excluded.up_seconds`,
        m.id,
        segment.day,
        segment.seconds,
        segment.up,
        job.id,
        now,
        lease
      )
    );
  for (const segment of observation(m, activeWindows, now, maintenance, 300))
    batch.push(
      statement(
        env.DB,
        `INSERT INTO short_stats(monitor_id,slot,observed_seconds,up_seconds) SELECT ?,?,?,? WHERE ${guarded} ON CONFLICT(monitor_id,slot) DO UPDATE SET observed_seconds=observed_seconds+excluded.observed_seconds,up_seconds=up_seconds+excluded.up_seconds`,
        m.id,
        segment.day,
        segment.seconds,
        segment.up,
        job.id,
        now,
        lease
      )
    );
  const day = new Date(now * 1000).toISOString().slice(0, 10);
  batch.push(statement(env.DB,
    `INSERT INTO hourly_stats(monitor_id,hour,check_count,success_count,latency_sum,latency_count) SELECT ?,?,1,?,?,? WHERE ${guarded} ON CONFLICT(monitor_id,hour) DO UPDATE SET check_count=COALESCE(check_count,0)+1,success_count=COALESCE(success_count,0)+excluded.success_count,latency_sum=COALESCE(latency_sum,0)+excluded.latency_sum,latency_count=COALESCE(latency_count,0)+excluded.latency_count`,
    m.id, new Date(now * 1000).toISOString().slice(0, 13), +result.ok, result.ok ? (result.latency ?? 0) : 0, +(result.ok && result.latency !== null), job.id, now, lease
  ));
  batch.push(
    statement(
      env.DB,
      `INSERT INTO daily_stats(monitor_id,day,check_count,success_count,latency_sum,latency_count) SELECT ?,?,1,?,?,? WHERE ${guarded} ON CONFLICT(monitor_id,day) DO UPDATE SET check_count=check_count+1,success_count=success_count+excluded.success_count,latency_sum=latency_sum+excluded.latency_sum,latency_count=latency_count+excluded.latency_count`,
      m.id,
      day,
      +result.ok,
      result.ok ? (result.latency ?? 0) : 0,
      +(result.ok && result.latency !== null),
      job.id,
      now,
      lease
    )
  );
  batch.push(
    statement(env.DB, `UPDATE monitors SET slow_checks=?,fast_checks=?,degraded=? WHERE id=? AND ${guarded}`,
      latency.slow, latency.fast, latency.degraded, m.id, job.id, now, lease),
    statement(env.DB, `UPDATE results SET degraded=? WHERE job_id=? AND ${guarded}`,
      +(result.ok && next.status === "up" && Boolean(latency.degraded)), job.id, job.id, now, lease)
  );
  for (const [table, column, stride] of [["daily_stats", "day", 86400], ["hourly_stats", "hour", 3600], ["short_stats", "slot", 300]] as const) {
    if (m.degraded && m.last_ok && !maintenance)
      for (const segment of observation(m, activeWindows, now, maintenance, stride))
        batch.push(statement(env.DB, `INSERT INTO ${table}(monitor_id,${column},degraded_count) SELECT ?,?,1 WHERE ${guarded} ON CONFLICT(monitor_id,${column}) DO UPDATE SET degraded_count=degraded_count+1`, m.id, segment.day, job.id, now, lease));
    if (result.ok && latency.degraded && next.status === "up" && !maintenance) {
      const bucket = new Date(Math.floor(now / stride) * stride * 1000).toISOString().slice(0, stride === 86400 ? 10 : stride === 3600 ? 13 : 16);
      batch.push(statement(env.DB, `INSERT INTO ${table}(monitor_id,${column},degraded_count) SELECT ?,?,1 WHERE ${guarded} ON CONFLICT(monitor_id,${column}) DO UPDATE SET degraded_count=degraded_count+1`, m.id, bucket, job.id, now, lease));
    }
  }
  const incidentId = crypto.randomUUID();
  if (!maintenance && !m.paused) {
    batch.push(
      statement(
        env.DB,
        `INSERT OR IGNORE INTO incidents(id,monitor_id,opened_at,reason) SELECT ?,?,?,? WHERE ${guarded} AND EXISTS(SELECT 1 FROM monitors WHERE id=? AND status='down') AND NOT EXISTS(SELECT 1 FROM incidents WHERE monitor_id=? AND closed_at IS NULL)`,
        incidentId,
        m.id,
        now,
        result.reason,
        job.id,
        now,
        lease,
        m.id,
        m.id
      )
    );
    batch.push(
      statement(
        env.DB,
        `INSERT OR IGNORE INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt,state) SELECT ?,id,'opened',?,?,?,CASE WHEN ${providerOutageActive} THEN 'cancelled' ELSE 'pending' END FROM incidents WHERE id=?`,
        crypto.randomUUID(),
        m.name,
        now,
        now,
        incidentId
      )
    );
    batch.push(
      statement(
        env.DB,
        `INSERT OR IGNORE INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) SELECT ?,id,'recovered',?,?,? FROM incidents WHERE monitor_id=? AND closed_at IS NULL AND ${guarded} AND EXISTS(SELECT 1 FROM monitors WHERE id=? AND status='up')`,
        crypto.randomUUID(),
        m.name,
        now,
        now,
        m.id,
        job.id,
        now,
        lease,
        m.id
      )
    );
    batch.push(
      statement(
        env.DB,
        `UPDATE incidents SET closed_at=? WHERE monitor_id=? AND closed_at IS NULL AND ${guarded} AND EXISTS(SELECT 1 FROM monitors WHERE id=? AND status='up')`,
        now,
        m.id,
        job.id,
        now,
        lease,
        m.id
      )
    );
  }
  if (!maintenance && !m.paused)
    batch.push(...await automaticStatements(env, m, next.status, latency.degraded, now, job.id, lease));
  batch.push(
    statement(
      env.DB,
      `UPDATE jobs SET state='completed',completed_at=?,lease_until=NULL WHERE id=? AND lease_token=?`,
      now,
      job.id,
      lease
    )
  );
  const saved = await env.DB.batch(batch);
  return saved[0].meta.changes > 0;
}

export async function runJob(env: Env, id: string) {
  if (id.startsWith("heartbeat:")) return;
  const started = Date.now();
  const now = nowSeconds(),
    lease = crypto.randomUUID();
  const job = await first<Job>(
    env.DB,
    `UPDATE jobs SET state='running',lease_token=?,lease_until=?,attempts=attempts+1 WHERE id=? AND (state='pending' OR (state='running' AND lease_until<?))
    AND NOT EXISTS(SELECT 1 FROM jobs other WHERE other.monitor_id=jobs.monitor_id AND other.id<>jobs.id AND other.state='running' AND other.lease_until>=?) RETURNING *`,
    lease,
    now + 90,
    id,
    now,
    now
  );
  if (!job) {
    const existing = await first<Job>(
      env.DB,
      "SELECT * FROM jobs WHERE id=?",
      id
    );
    if (existing && ["pending", "running"].includes(existing.state))
      throw new JobBusyError("Job busy");
    return;
  }
  let stage = "monitor_lookup";
  try {
    const m = await first<Monitor>(
      env.DB,
      "SELECT * FROM monitors WHERE id=?",
      job.monitor_id
    );
    if (
      !m ||
      m.paused ||
      m.config_version !== job.config_version ||
      now - job.due_at > m.interval_seconds * 2
    ) {
      await statement(
        env.DB,
        "UPDATE jobs SET state='cancelled',completed_at=?,lease_until=NULL WHERE id=? AND lease_token=?",
        now,
        id,
        lease
      ).run();
      console.warn(JSON.stringify({
        event: "check_cancelled", jobId: id,
        reason: !m ? "missing_monitor" : m.paused ? "paused"
          : m.config_version !== job.config_version ? "configuration_changed" : "expired",
        jobAgeSeconds: now - job.due_at
      }));
      return;
    }
    let result: CheckResult;
    const checkStarted = Date.now();
    if (m.kind === "heartbeat") {
      if (
        (m.last_heartbeat ?? m.created_at) +
          m.interval_seconds +
          m.grace_seconds >
        job.due_at
      ) {
        await statement(
          env.DB,
          "UPDATE jobs SET state='cancelled',completed_at=? WHERE id=? AND lease_token=?",
          now,
          id,
          lease
        ).run();
        return;
      }
      result = {
        ok: false,
        latency: null,
        code: null,
        reason: "heartbeat_missing",
        diagnostic: reasons.heartbeat_missing
      };
    } else {
      stage = "configuration";
      const config = await unseal<CheckConfig>(m.config, env.CONFIG_KEY, m.id);
      stage = "check";
      result = await check(m.kind, config);
    }
    const checked = nowSeconds(), checkMs = Date.now() - checkStarted;
    const persistenceStarted = Date.now();
    stage = "persistence";
    const saved = await record(env, job, m, result, lease, checked);
    console.log(JSON.stringify({
      event: saved ? "check_completed" : "check_superseded", monitorId: m.id, jobId: id,
      jobAgeSeconds: now - job.due_at,
      checkGapSeconds: m.last_checked === null ? null : checked - m.last_checked,
      checkMs, persistenceMs: Date.now() - persistenceStarted,
      totalMs: Date.now() - started, ok: result.ok
    }));
  } catch (error) {
    await statement(
      env.DB,
      "UPDATE jobs SET state='pending',lease_until=NULL WHERE id=? AND lease_token=?",
      id,
      lease
    ).run();
    throw new JobExecutionError(stage, error);
  }
}

export async function heartbeat(env: Env, m: Monitor, ok: boolean) {
  const now = nowSeconds(),
    id = `heartbeat:${m.id}:${m.config_version}:${Math.floor(now / m.interval_seconds)}`;
  await statement(
    env.DB,
    "INSERT OR IGNORE INTO jobs(id,monitor_id,config_version,due_at) VALUES(?,?,?,?)",
    id,
    m.id,
    m.config_version,
    now
  ).run();
  const lease = crypto.randomUUID();
  const job = await first<Job>(
    env.DB,
    `UPDATE jobs SET state='running',lease_token=?,lease_until=? WHERE id=? AND (state='pending' OR (state='running' AND lease_until<?)) AND NOT EXISTS(SELECT 1 FROM jobs other WHERE other.monitor_id=jobs.monitor_id AND other.id<>jobs.id AND other.state='running' AND other.lease_until>=?) RETURNING *`,
    lease,
    now + 90,
    id,
    now,
    now
  );
  if (!job) {
    const existing = await first<Job>(
      env.DB,
      "SELECT * FROM jobs WHERE id=?",
      id
    );
    if (existing?.state === "completed") return;
    throw new Response("Comprobación en curso; reintenta el reporte.", {
      status: 409
    });
  }
  try {
    await record(
      env,
      job,
      m,
      {
        ok,
        latency: null,
        code: null,
        reason: ok ? "ok" : "heartbeat_failed",
        diagnostic: reasons[ok ? "ok" : "heartbeat_failed"]
      },
      lease,
      now,
      true
    );
  } catch (error) {
    await statement(
      env.DB,
      "UPDATE jobs SET state='pending',lease_until=NULL WHERE id=? AND lease_token=?",
      id,
      lease
    ).run();
    throw error;
  }
}

export async function cleanup(env: Env, now: number) {
  const detailed = sixMonthsAgo(now);
  await env.DB.batch([
    statement(
      env.DB,
      "DELETE FROM results WHERE id IN (SELECT id FROM results WHERE checked_at<? LIMIT 1000)",
      detailed
    ),
    statement(
      env.DB,
      "DELETE FROM jobs WHERE id IN (SELECT id FROM jobs WHERE state IN ('completed','cancelled') AND completed_at<? LIMIT 1000)",
      now - 86400
    ),
    statement(
      env.DB,
      "DELETE FROM short_stats WHERE rowid IN (SELECT rowid FROM short_stats WHERE slot<? LIMIT 1000)",
      new Date((now - 48 * 3600) * 1000).toISOString().slice(0, 16)
    ),
    statement(
      env.DB,
      "DELETE FROM hourly_stats WHERE rowid IN (SELECT rowid FROM hourly_stats WHERE hour<? LIMIT 1000)",
      new Date((now - 90 * 86400) * 1000).toISOString().slice(0, 13)
    )
  ]);
}

async function dispatchJobs(env: Env, now: number, direct: boolean) {
  const [cancelled, claimed] = await env.DB.batch<Job>([
    statement(env.DB,
      `UPDATE jobs SET state='cancelled',completed_at=?,lease_until=NULL
      WHERE (state='pending' OR (state='running' AND lease_until<?))
      AND NOT EXISTS(SELECT 1 FROM monitors m WHERE m.id=jobs.monitor_id
        AND m.config_version=jobs.config_version AND m.paused=0
        AND jobs.due_at>=?-m.interval_seconds*2)`, now, now, now),
    statement(env.DB,
      `UPDATE jobs SET dispatched_at=? WHERE id IN (
        SELECT id FROM jobs WHERE id NOT LIKE 'heartbeat:%' AND (
        (state='pending' AND (dispatched_at IS NULL OR dispatched_at<?))
        OR (state='running' AND lease_until<? AND (dispatched_at IS NULL OR dispatched_at<?)))
        ORDER BY due_at,id LIMIT 100
      ) RETURNING *`, now, now - 120, now, now - 120)
  ]);
  const jobs = claimed.results;
  if (!jobs.length) return { dispatched: 0, cancelled: cancelled.meta.changes };
  try {
    if (direct) {
      for (let offset = 0; offset < jobs.length; offset += 10) {
        const dispatched = await Promise.allSettled(
          jobs.slice(offset, offset + 10).map((job) => durableCall(() =>
            env.CHECK_RUNNERS.getByName(job.monitor_id).enqueue(job.id)
          ))
        );
        const failed = dispatched.find((result) => result.status === "rejected");
        if (failed?.status === "rejected") throw failed.reason;
      }
    } else {
      await env.CHECKS.sendBatch(jobs.map((job) => ({ body: { id: job.id } })), { delaySeconds: 0 });
    }
  } catch (error) {
    await env.DB.batch(jobs.map((job) => statement(env.DB,
      "UPDATE jobs SET dispatched_at=NULL WHERE id=? AND dispatched_at=?",
      job.id, now)));
    throw error;
  }
  return { dispatched: jobs.length, cancelled: cancelled.meta.changes };
}

export async function tick(env: Env, now = nowSeconds(), scheduledAt = now, scheduler: "cron" | "alarm" = "cron") {
  const started = Date.now();
  await statement(
    env.DB,
    "UPDATE engine SET last_started=?,last_error=NULL WHERE id=1",
    now
  ).run();
  try {
    const activeWindows = await windows(env),
      all = await rows<Monitor>(env.DB, "SELECT * FROM monitors");
    const changes = [];
    for (const m of all) {
      const active = +isMaintenance(m, activeWindows, now);
      if (active !== m.maintenance_active)
        changes.push(
          statement(
            env.DB,
            "UPDATE monitors SET maintenance_active=?,failures=0,successes=0,slow_checks=0,fast_checks=0,degraded=0,last_checked=NULL,last_ok=NULL WHERE id=?",
            active,
            m.id
          )
        );
    }
    if (changes.length) await env.DB.batch(changes);
    const due = await rows<Monitor>(
      env.DB,
      "SELECT * FROM monitors WHERE paused=0 AND next_due<=? ORDER BY next_due LIMIT 100",
      now
    );
    const schedule = due.flatMap((m) => {
      const id = `${m.id}:${m.config_version}:${m.next_due}`;
      const scheduled =
        m.kind !== "heartbeat" && m.interval_seconds % 60 === 0
          ? Math.floor(m.next_due / 60) * 60
          : m.next_due;
      return [
        statement(
          env.DB,
          "INSERT OR IGNORE INTO jobs(id,monitor_id,config_version,due_at) SELECT ?,id,config_version,? FROM monitors WHERE id=? AND config_version=? AND next_due=? AND paused=0",
          id,
          now,
          m.id,
          m.config_version,
          m.next_due
        ),
        statement(
          env.DB,
          "UPDATE monitors SET next_due=? WHERE id=? AND config_version=? AND next_due=?",
          scheduled +
            (Math.floor((now - scheduled) / m.interval_seconds) + 1) *
              m.interval_seconds,
          m.id,
          m.config_version,
          m.next_due
        )
      ];
    });
    if (schedule.length) await env.DB.batch(schedule);
    const schedulingMs = Date.now() - started;
    const dispatchStarted = Date.now();
    const notificationsStarted = Date.now();
    let dispatchMs = 0, notificationsMs = 0;
    const [dispatchResult, notificationsResult] = await Promise.allSettled([
      dispatchJobs(env, now, scheduler === "alarm").finally(() => {
        dispatchMs = Date.now() - dispatchStarted;
      }),
      deliverNotifications(env, now).finally(() => {
        notificationsMs = Date.now() - notificationsStarted;
      })
    ]);
    if (dispatchResult.status === "rejected") throw dispatchResult.reason;
    if (notificationsResult.status === "rejected") throw notificationsResult.reason;
    const dispatch = dispatchResult.value;
    const cleanupStarted = Date.now();
    await cleanup(env, now);
    const cleanupMs = Date.now() - cleanupStarted;
    await statement(
      env.DB,
      "UPDATE engine SET last_finished=? WHERE id=1",
      nowSeconds()
    ).run();
    console.log(JSON.stringify({
      event: "engine_cycle", scheduler, dispatch: scheduler === "alarm" ? "durable" : "queue", schedulerDelaySeconds: Math.max(0, now - scheduledAt),
      cronDelaySeconds: scheduler === "cron" ? Math.max(0, now - scheduledAt) : undefined,
      due: due.length, ...dispatch, schedulingMs, dispatchMs,
      notificationsMs, cleanupMs, totalMs: Date.now() - started
    }));
  } catch (error) {
    await statement(
      env.DB,
      "UPDATE engine SET last_error='Falló una operación del motor; revisar los logs de Cloudflare.' WHERE id=1"
    ).run();
    console.error(JSON.stringify({ event: "engine_failure" }));
    throw error;
  }
}

export async function consume(batch: MessageBatch<JobMessage>, env: Env) {
  await Promise.all(
    batch.messages.map(async (message) => {
      try {
        await runJob(env, message.body.id);
        message.ack();
      } catch (error) {
        const cause = error instanceof JobExecutionError ? error.cause : error;
        if (!(error instanceof JobBusyError))
          console.error(
            JSON.stringify({
              event: "check_execution_failure",
              jobId: message.body.id,
              stage:
                error instanceof JobExecutionError
                  ? error.stage
                  : "lease_acquisition",
              errorType: cause instanceof Error ? cause.name : "UnknownError",
              errorCode:
                cause instanceof Error
                  ? cause.message.match(/\b(?:D1|SQLITE)_[A-Z_]+\b/)?.[0]
                  : undefined
            })
          );
        message.retry({ delaySeconds: 30 });
      }
    })
  );
}
