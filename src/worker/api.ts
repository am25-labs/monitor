import { z } from "zod";
import {
  groupInput,
  maintenanceInput,
  monitorInput,
  pageInput,
  projectInput
} from "../shared/schema";
import type {
  CheckConfig,
  Group,
  HttpConfig,
  Incident,
  Monitor,
  Project,
  SafeMonitor,
  Stat,
  StatusPage
} from "../shared/types";
import { check } from "./checks";
import { digest, seal, token, unseal } from "./crypto";
import { first, rows, statement, nowSeconds } from "./db";
import { heartbeat, windows } from "./engine";
import { displayStatus } from "./state";
import { verifyHeartbeat } from "./auth";

export function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}
export async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("Content-Type")?.startsWith("application/json"))
    throw new Response("Usá JSON.", { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) throw new Response("Falta el contenido.", { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 65536)
        throw new Response("Solicitud demasiado grande.", { status: 413 });
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    data.set(c, offset);
    offset += c.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new Response("JSON inválido.", { status: 400 });
  }
}
function missing(): never {
  throw new Response("No encontrado.", { status: 404 });
}
export async function safeMonitor(
  m: Monitor,
  env: Env,
  activeWindows: Awaited<ReturnType<typeof windows>>,
  now: number
): Promise<SafeMonitor> {
  const config = await unseal<CheckConfig>(m.config, env.CONFIG_KEY, m.id);
  const { heartbeat_hash: _, config: _config, ...rest } = m;
  const hasCredentials =
    m.kind === "http" && Object.keys((config as HttpConfig).headers).length > 0;
  return {
    ...rest,
    config:
      m.kind === "http" ? { ...(config as HttpConfig), headers: {} } : config,
    hasCredentials,
    display_status: displayStatus(m, activeWindows, now)
  };
}
async function requireProject(env: Env, id: string) {
  if (!(await first(env.DB, "SELECT id FROM projects WHERE id=?", id)))
    missing();
}
async function requireGroup(env: Env, id: string | null, project: string) {
  if (
    id &&
    !(await first(
      env.DB,
      "SELECT id FROM groups WHERE id=? AND project_id=?",
      id,
      project
    ))
  )
    throw new Response("El grupo no pertenece al proyecto.", { status: 400 });
}
async function monitor(env: Env, id: string) {
  const m = await first<Monitor>(
    env.DB,
    "SELECT * FROM monitors WHERE id=?",
    id
  );
  if (!m) missing();
  return m;
}

export async function admin(
  request: Request,
  env: Env,
  path: string
): Promise<Response> {
  const [resource, id, action] = path.split("/").filter(Boolean),
    method = request.method,
    now = nowSeconds();
  if (resource === "snapshot" && method === "GET") {
    const [
      projects,
      groups,
      monitors,
      activeWindows,
      pages,
      incidents,
      engine,
      notifications,
      backlog,
      stats
    ] = await Promise.all([
      rows<Project>(env.DB, "SELECT * FROM projects ORDER BY name"),
      rows<Group>(env.DB, "SELECT * FROM groups ORDER BY name"),
      rows<Monitor>(env.DB, "SELECT * FROM monitors ORDER BY name"),
      windows(env),
      rows<StatusPage & { group_ids: string; excluded_ids: string }>(
        env.DB,
        "SELECT * FROM pages ORDER BY title"
      ),
      rows<Incident>(
        env.DB,
        "SELECT i.*,m.name AS monitor_name FROM incidents i JOIN monitors m ON m.id=i.monitor_id ORDER BY i.opened_at DESC LIMIT 100"
      ),
      first(env.DB, "SELECT * FROM engine WHERE id=1"),
      rows(
        env.DB,
        "SELECT id,event,monitor_name,created_at,state,attempts,error FROM notifications WHERE state<>'sent' ORDER BY created_at DESC LIMIT 50"
      ),
      first(
        env.DB,
        "SELECT COUNT(*) AS total,MIN(due_at) AS oldest FROM jobs WHERE state IN ('pending','running')"
      ),
      rows<Stat>(
        env.DB,
        "SELECT * FROM daily_stats WHERE day>=?",
        new Date((now - 30 * 86400) * 1000).toISOString().slice(0, 10)
      )
    ]);
    return json({
      projects,
      groups,
      monitors: await Promise.all(
        monitors.map((m) => safeMonitor(m, env, activeWindows, now))
      ),
      maintenance: activeWindows,
      pages: pages.map((p) => ({
        ...p,
        group_ids: JSON.parse(p.group_ids),
        excluded_ids: JSON.parse(p.excluded_ids),
        published: Boolean(p.published)
      })),
      incidents,
      engine,
      notifications,
      backlog,
      stats,
      settings: {
        ownerEmail: env.OWNER_EMAIL,
        from: env.POSTMARK_FROM,
        environment: env.ENVIRONMENT
      }
    });
  }
  if (resource === "projects") {
    if (method === "POST" && !id) {
      const v = projectInput.parse(await body(request));
      const key = crypto.randomUUID();
      await statement(
        env.DB,
        "INSERT INTO projects(id,name,description,created_at) VALUES(?,?,?,?)",
        key,
        v.name,
        v.description,
        now
      ).run();
      return json({ id: key }, 201);
    }
    if (method === "PUT" && id) {
      await requireProject(env, id);
      const v = projectInput.parse(await body(request));
      await statement(
        env.DB,
        "UPDATE projects SET name=?,description=? WHERE id=?",
        v.name,
        v.description,
        id
      ).run();
      return json({ ok: true });
    }
    if (method === "DELETE" && id) {
      await statement(env.DB, "DELETE FROM projects WHERE id=?", id).run();
      return json({ ok: true });
    }
  }
  if (resource === "groups") {
    if (["POST", "PUT"].includes(method)) {
      const v = groupInput.parse(await body(request));
      await requireProject(env, v.project_id);
      if (id) {
        const g = await first<Group>(
          env.DB,
          "SELECT * FROM groups WHERE id=?",
          id
        );
        if (!g) missing();
        if (g.project_id !== v.project_id)
          throw new Response("No se puede mover un grupo entre proyectos.", {
            status: 400
          });
      }
      const key = id ?? crypto.randomUUID();
      await statement(
        env.DB,
        "INSERT INTO groups(id,project_id,name) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name",
        key,
        v.project_id,
        v.name
      ).run();
      return json({ id: key });
    }
    if (method === "DELETE" && id) {
      const used = await rows<{ group_ids: string }>(
        env.DB,
        "SELECT group_ids FROM pages"
      );
      if (used.some((p) => JSON.parse(p.group_ids).includes(id)))
        throw new Response("El grupo se usa en una página pública.", {
          status: 409
        });
      await statement(env.DB, "DELETE FROM groups WHERE id=?", id).run();
      return json({ ok: true });
    }
  }
  if (resource === "monitors") {
    if (action === "results" && method === "GET") {
      await monitor(env, id);
      const params = new URL(request.url).searchParams,
        limit = 50;
      const cursor = Number(params.get("cursor") ?? Number.MAX_SAFE_INTEGER),
        from = Number(params.get("from") ?? 0),
        to = Number(params.get("to") ?? now);
      if (![cursor, from, to].every(Number.isSafeInteger) || from > to)
        throw new Response("Rango inválido.", { status: 400 });
      const results = await rows<{ id: number }>(
        env.DB,
        "SELECT * FROM results WHERE monitor_id=? AND id<? AND checked_at>=? AND checked_at<=? ORDER BY id DESC LIMIT ?",
        id,
        cursor,
        from,
        to,
        limit + 1
      );
      return json({
        results: results.slice(0, limit),
        nextCursor: results.length > limit ? results[limit - 1].id : null,
        stats: await rows<Stat>(
          env.DB,
          "SELECT * FROM daily_stats WHERE monitor_id=? AND day>=? AND day<=? ORDER BY day",
          id,
          new Date(from * 1000).toISOString().slice(0, 10),
          new Date(to * 1000).toISOString().slice(0, 10)
        )
      });
    }
    if (action === "token" && method === "POST") {
      const m = await monitor(env, id);
      if (m.kind !== "heartbeat")
        throw new Response("Solo para heartbeats.", { status: 400 });
      const secret = token();
      await statement(
        env.DB,
        "UPDATE monitors SET heartbeat_hash=?,config_version=config_version+1 WHERE id=?",
        await digest(secret),
        id
      ).run();
      return json({ token: secret });
    }
    if (action === "pause" && method === "POST") {
      const v = z.object({ paused: z.boolean() }).parse(await body(request));
      const m = await monitor(env, id);
      await statement(
        env.DB,
        "UPDATE monitors SET paused=?,config_version=config_version+1,failures=0,successes=0,last_checked=NULL,last_ok=NULL,next_due=? WHERE id=?",
        +v.paused,
        now +
          (m.kind === "heartbeat" ? m.interval_seconds + m.grace_seconds : 0),
        id
      ).run();
      return json({ ok: true });
    }
    if (action === "test" && method === "POST") {
      const m = await monitor(env, id);
      if (m.kind === "heartbeat")
        throw new Response("Los heartbeats reciben reportes.", { status: 400 });
      return json(
        await check(
          m.kind,
          await unseal<CheckConfig>(m.config, env.CONFIG_KEY, m.id)
        )
      );
    }
    if (["POST", "PUT"].includes(method) && !action) {
      const v = monitorInput.parse(await body(request));
      await requireProject(env, v.project_id);
      await requireGroup(env, v.group_id, v.project_id);
      const old = id ? await monitor(env, id) : null;
      if (
        old &&
        (old.project_id !== v.project_id || old.group_id !== v.group_id)
      ) {
        const allPages = await rows<{
          project_id: string;
          excluded_ids: string;
        }>(env.DB, "SELECT project_id,excluded_ids FROM pages");
        if (
          allPages.some(
            (p) =>
              p.project_id !== v.project_id &&
              JSON.parse(p.excluded_ids).includes(id)
          )
        )
          throw new Response(
            "Quitá el monitor de las exclusiones antes de moverlo.",
            { status: 409 }
          );
      }
      const key = id ?? crypto.randomUUID();
      let config: CheckConfig = v.config;
      if (old?.kind === "http" && v.kind === "http" && v.keepCredentials) {
        const original = await unseal<HttpConfig>(
          old.config,
          env.CONFIG_KEY,
          old.id
        );
        config = {
          ...(config as HttpConfig),
          headers: { ...original.headers, ...(config as HttpConfig).headers }
        };
      }
      const secret =
        v.kind === "heartbeat" && old?.kind !== "heartbeat" ? token() : null;
      const encrypted = await seal(config, env.CONFIG_KEY, key),
        next =
          now +
          (v.kind === "heartbeat" ? v.interval_seconds + v.grace_seconds : 0);
      if (old)
        await statement(
          env.DB,
          `UPDATE monitors SET project_id=?,group_id=?,name=?,kind=?,config=?,config_version=config_version+1,interval_seconds=?,grace_seconds=?,failure_threshold=?,recovery_threshold=?,paused=?,failures=0,successes=0,last_checked=NULL,last_ok=NULL,next_due=?,last_heartbeat=NULL,heartbeat_hash=?,status=CASE WHEN status='down' THEN 'down' ELSE 'pending' END WHERE id=?`,
          v.project_id,
          v.group_id,
          v.name,
          v.kind,
          encrypted,
          v.interval_seconds,
          v.grace_seconds,
          v.failure_threshold,
          v.recovery_threshold,
          +v.paused,
          next,
          secret
            ? await digest(secret)
            : v.kind === "heartbeat"
              ? old.heartbeat_hash
              : null,
          key
        ).run();
      else
        await statement(
          env.DB,
          `INSERT INTO monitors(id,project_id,group_id,name,kind,config,interval_seconds,grace_seconds,failure_threshold,recovery_threshold,paused,next_due,heartbeat_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          key,
          v.project_id,
          v.group_id,
          v.name,
          v.kind,
          encrypted,
          v.interval_seconds,
          v.grace_seconds,
          v.failure_threshold,
          v.recovery_threshold,
          +v.paused,
          next,
          secret ? await digest(secret) : null,
          now
        ).run();
      return json(
        { id: key, ...(secret ? { token: secret } : {}) },
        old ? 200 : 201
      );
    }
    if (method === "DELETE" && id) {
      await env.DB.batch([
        statement(
          env.DB,
          "DELETE FROM maintenance WHERE scope='monitor' AND target_id=?",
          id
        ),
        statement(env.DB, "DELETE FROM monitors WHERE id=?", id)
      ]);
      return json({ ok: true });
    }
  }
  if (resource === "maintenance") {
    if (["POST", "PUT"].includes(method)) {
      const v = maintenanceInput.parse(await body(request));
      const table = {
        project: "projects",
        group: "groups",
        monitor: "monitors"
      }[v.scope];
      if (
        !(await first(
          env.DB,
          `SELECT id FROM ${table} WHERE id=?`,
          v.target_id
        ))
      )
        missing();
      const key = id ?? crypto.randomUUID();
      await statement(
        env.DB,
        "INSERT INTO maintenance(id,scope,target_id,title,starts_at,ends_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET scope=excluded.scope,target_id=excluded.target_id,title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at",
        key,
        v.scope,
        v.target_id,
        v.title,
        v.starts_at,
        v.ends_at
      ).run();
      return json({ id: key });
    }
    if (method === "DELETE" && id) {
      await statement(env.DB, "DELETE FROM maintenance WHERE id=?", id).run();
      return json({ ok: true });
    }
  }
  if (resource === "pages") {
    if (["POST", "PUT"].includes(method)) {
      const v = pageInput.parse(await body(request));
      await requireProject(env, v.project_id);
      for (const group of v.group_ids)
        await requireGroup(env, group, v.project_id);
      for (const monitorId of v.excluded_ids) {
        const m = await monitor(env, monitorId);
        if (m.project_id !== v.project_id)
          throw new Response("La exclusión no pertenece al proyecto.", {
            status: 400
          });
      }
      const key = id ?? crypto.randomUUID();
      await statement(
        env.DB,
        "INSERT INTO pages(id,slug,title,description,project_id,group_ids,excluded_ids,published) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug,title=excluded.title,description=excluded.description,project_id=excluded.project_id,group_ids=excluded.group_ids,excluded_ids=excluded.excluded_ids,published=excluded.published",
        key,
        v.slug,
        v.title,
        v.description,
        v.project_id,
        JSON.stringify(v.group_ids),
        JSON.stringify(v.excluded_ids),
        +v.published
      ).run();
      return json({ id: key });
    }
    if (method === "DELETE" && id) {
      await statement(env.DB, "DELETE FROM pages WHERE id=?", id).run();
      return json({ ok: true });
    }
  }
  if (resource === "notifications" && action === "retry" && method === "POST") {
    await statement(
      env.DB,
      "UPDATE notifications SET state='pending',attempts=0,next_attempt=?,error=NULL WHERE id=? AND state='failed'",
      now,
      id
    ).run();
    return json({ ok: true });
  }
  return json({ error: "Ruta no encontrada." }, 404);
}

export async function publicPage(env: Env, slug: string) {
  const page = await first<{
    title: string;
    description: string;
    project_id: string;
    group_ids: string;
    excluded_ids: string;
  }>(env.DB, "SELECT * FROM pages WHERE slug=? AND published=1", slug);
  if (!page) missing();
  const groups = JSON.parse(page.group_ids) as string[],
    excluded = JSON.parse(page.excluded_ids) as string[];
  const all = await rows<Monitor>(
      env.DB,
      "SELECT * FROM monitors WHERE project_id=? ORDER BY name",
      page.project_id
    ),
    activeWindows = await windows(env),
    now = nowSeconds();
  const included = all.filter(
    (m) =>
      (!groups.length || groups.includes(m.group_id ?? "")) &&
      !excluded.includes(m.id)
  );
  const monitors = await Promise.all(
    included.map(async (m) => {
      const stats = await rows<Stat>(
        env.DB,
        "SELECT day,observed_seconds,up_seconds FROM daily_stats WHERE monitor_id=? AND day>=? ORDER BY day",
        m.id,
        new Date((now - 90 * 86400) * 1000).toISOString().slice(0, 10)
      );
      const incidents = await rows<Incident>(
        env.DB,
        "SELECT opened_at,closed_at FROM incidents WHERE monitor_id=? AND (closed_at IS NULL OR closed_at>=?) ORDER BY opened_at DESC LIMIT 20",
        m.id,
        now - 90 * 86400
      );
      return {
        id: m.id,
        name: m.name,
        status: displayStatus(m, activeWindows, now),
        lastChecked: m.last_checked,
        stats,
        incidents: incidents.map((i) => ({
          ...i,
          message: i.closed_at
            ? "Servicio recuperado"
            : "Interrupción del servicio"
        }))
      };
    })
  );
  return json({
    title: page.title,
    description: page.description,
    monitors,
    updatedAt: now
  });
}

export async function receiveHeartbeat(request: Request, env: Env, id: string) {
  const m = await first<Monitor>(
    env.DB,
    "SELECT * FROM monitors WHERE id=? AND kind='heartbeat'",
    id
  );
  if (!m || !(await verifyHeartbeat(request, m.heartbeat_hash)))
    return json({ error: "Token inválido." }, 401);
  if (m.paused) return json({ accepted: false, paused: true });
  const v = z
    .object({ ok: z.boolean().default(true) })
    .parse(await body(request));
  await heartbeat(env, m, v.ok);
  const received = nowSeconds();
  await statement(
    env.DB,
    "UPDATE monitors SET last_heartbeat=?,next_due=? WHERE id=? AND config_version=? AND (last_heartbeat IS NULL OR last_heartbeat<=?)",
    received,
    received + m.interval_seconds + m.grace_seconds,
    m.id,
    m.config_version,
    received
  ).run();
  return json({ accepted: true });
}
