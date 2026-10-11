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
  transition
} from "./state";
import { deliverNotifications } from "./mail";

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
      ? { ...m, failures: 0, successes: 0 }
      : m;
  const next = transition(baseline, result.ok, maintenance);
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
        `INSERT OR IGNORE INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) SELECT ?,id,'opened',?,?,? FROM incidents WHERE id=?`,
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
  batch.push(
    statement(
      env.DB,
      `UPDATE jobs SET state='completed',completed_at=?,lease_until=NULL WHERE id=? AND lease_token=?`,
      now,
      job.id,
      lease
    )
  );
  await env.DB.batch(batch);
}

export async function runJob(env: Env, id: string) {
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
      throw new Error("Job busy");
    return;
  }
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
    return;
  }
  try {
    let result: CheckResult;
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
    } else
      result = await check(
        m.kind,
        await unseal<CheckConfig>(m.config, env.CONFIG_KEY, m.id)
      );
    await record(env, job, m, result, lease, nowSeconds());
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
  const detailed = sixMonthsAgo(now),
    annual = now - 365 * 86400;
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
      "DELETE FROM daily_stats WHERE rowid IN (SELECT rowid FROM daily_stats WHERE day<? LIMIT 1000)",
      new Date(annual * 1000).toISOString().slice(0, 10)
    ),
    statement(
      env.DB,
      "DELETE FROM short_stats WHERE rowid IN (SELECT rowid FROM short_stats WHERE slot<? LIMIT 1000)",
      new Date((now - 48 * 3600) * 1000).toISOString().slice(0, 16)
    ),
    statement(
      env.DB,
      "DELETE FROM hourly_stats WHERE rowid IN (SELECT rowid FROM hourly_stats WHERE hour<? LIMIT 1000)",
      new Date((now - 8 * 86400) * 1000).toISOString().slice(0, 13)
    ),
    statement(
      env.DB,
      "DELETE FROM incidents WHERE id IN (SELECT id FROM incidents WHERE closed_at<? LIMIT 1000)",
      annual
    )
  ]);
}

export async function tick(env: Env, now = nowSeconds()) {
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
            "UPDATE monitors SET maintenance_active=?,failures=0,successes=0,last_checked=NULL,last_ok=NULL WHERE id=?",
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
    for (const m of due) {
      const id = `${m.id}:${m.config_version}:${m.next_due}`;
      await env.DB.batch([
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
          m.next_due +
            (Math.floor((now - m.next_due) / m.interval_seconds) + 1) *
              m.interval_seconds,
          m.id,
          m.config_version,
          m.next_due
        )
      ]);
    }
    const pending = await rows<Job>(
      env.DB,
      "SELECT * FROM jobs WHERE (state='pending' AND (dispatched_at IS NULL OR dispatched_at<?)) OR (state='running' AND lease_until<?) LIMIT 100",
      now - 120,
      now
    );
    for (const job of pending) {
      const dispatched = await first<{ id: string }>(
        env.DB,
        "UPDATE jobs SET dispatched_at=? WHERE id=? AND (dispatched_at IS NULL OR dispatched_at<?) RETURNING id",
        now,
        job.id,
        now - 120
      );
      if (!dispatched) continue;
      try {
        await env.CHECKS.send({ id: job.id });
      } catch (error) {
        await statement(
          env.DB,
          "UPDATE jobs SET dispatched_at=NULL WHERE id=? AND dispatched_at=?",
          job.id,
          now
        ).run();
        throw error;
      }
    }
    await deliverNotifications(env, now);
    await cleanup(env, now);
    await statement(
      env.DB,
      "UPDATE engine SET last_finished=? WHERE id=1",
      nowSeconds()
    ).run();
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
      } catch {
        console.error(
          JSON.stringify({
            event: "check_execution_failure",
            jobId: message.body.id
          })
        );
        message.retry({ delaySeconds: 30 });
      }
    })
  );
}
