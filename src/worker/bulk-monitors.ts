import { bulkMonitorInput } from "../shared/bulk-monitors";
import type { Monitor, Window } from "../shared/types";
import { first, rows, statement } from "./db";
import { suppressNotifications } from "./mail";
import { generalSettings } from "./settings";
import { translate } from "../shared/i18n";

export async function validateMonitorMove(env: Env, monitor: Monitor, project: string, group: string | null) {
  if (monitor.project_id !== project && await first(env.DB,
    "SELECT incident_id FROM incident_monitors WHERE monitor_id=? LIMIT 1", monitor.id))
    throw new Response("Borra el historial del monitor antes de cambiarlo de proyecto.", { status: 409 });
  if (monitor.project_id === project && monitor.group_id === group) return;
  const pages = await rows<{ project_id: string; excluded_ids: string; included_ids: string | null }>(
    env.DB, "SELECT project_id,excluded_ids,included_ids FROM pages");
  if (pages.some((page) => page.project_id !== project && JSON.parse(page.included_ids ?? page.excluded_ids).includes(monitor.id)))
    throw new Response("Quita el monitor de la página pública antes de moverlo.", { status: 409 });
}

export async function bulkMonitors(env: Env, input: unknown, now: number) {
  const value = bulkMonitorInput.parse(input);
  const placeholders = value.ids.map(() => "?").join(",");
  const monitors = await rows<Monitor>(env.DB, `SELECT * FROM monitors WHERE id IN (${placeholders})`, ...value.ids);
  if (monitors.length !== value.ids.length) throw new Response("Monitor no encontrado.", { status: 404 });
  const reset = "config_version=config_version+1,failures=0,successes=0,slow_checks=0,fast_checks=0,degraded=0,last_checked=NULL,last_ok=NULL,next_due=CASE WHEN kind='heartbeat' THEN ?+interval_seconds+grace_seconds ELSE ? END";
  const changes: D1PreparedStatement[] = [];
  if (value.action === "project") {
    if (!await first(env.DB, "SELECT id FROM projects WHERE id=?", value.project_id))
      throw new Response("Proyecto no encontrado.", { status: 404 });
    for (const monitor of monitors) {
      if (monitor.project_id === value.project_id) continue;
      await validateMonitorMove(env, monitor, value.project_id, null);
      changes.push(statement(env.DB, `UPDATE monitors SET project_id=?,group_id=NULL,${reset} WHERE id=?`, value.project_id, now, now, monitor.id));
    }
  } else if (value.action === "group") {
    const group = value.group_id ? await first<{ project_id: string }>(env.DB, "SELECT project_id FROM groups WHERE id=?", value.group_id) : null;
    if (value.group_id && (!group || monitors.some((monitor) => monitor.project_id !== group.project_id)))
      throw new Response("El grupo no pertenece al proyecto.", { status: 400 });
    for (const monitor of monitors) {
      if (monitor.group_id === value.group_id) continue;
      await validateMonitorMove(env, monitor, monitor.project_id, value.group_id);
      changes.push(statement(env.DB, `UPDATE monitors SET group_id=?,${reset} WHERE id=?`, value.group_id, now, now, monitor.id));
    }
  } else if (value.action === "pause") {
    for (const monitor of monitors)
      if (Boolean(monitor.paused) !== value.paused)
        changes.push(statement(env.DB, `UPDATE monitors SET paused=?,${reset} WHERE id=?`, +value.paused, now, now, monitor.id));
  } else {
    const active = await rows<Window>(env.DB, `SELECT * FROM maintenance WHERE scope='monitor' AND target_id IN (${placeholders}) AND starts_at<=? AND (ends_at IS NULL OR ends_at>?)`, ...value.ids, now, now);
    if (value.enabled) {
      const title = translate((await generalSettings(env)).language, "Mantenimiento manual");
      for (const monitor of monitors)
        if (!active.some((window) => window.target_id === monitor.id))
          changes.push(statement(env.DB, "INSERT INTO maintenance(id,scope,target_id,title,starts_at,ends_at) SELECT ?,'monitor',?,?,?,NULL WHERE NOT EXISTS(SELECT 1 FROM maintenance WHERE scope='monitor' AND target_id=? AND starts_at<=? AND (ends_at IS NULL OR ends_at>?))", crypto.randomUUID(), monitor.id, title, now, monitor.id, now, now));
    } else {
      for (const window of active)
        changes.push(statement(env.DB, "UPDATE maintenance SET ends_at=? WHERE id=?", Math.max(window.starts_at + 1, now), window.id));
    }
  }
  if (changes.length) await env.DB.batch(changes);
  await suppressNotifications(env, now);
  return { ok: true, count: monitors.length };
}
