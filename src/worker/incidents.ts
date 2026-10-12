import type {
  Impact,
  IncidentDetail,
  IncidentUpdate,
  PublicIncident,
  PublicIncidentView
} from "../shared/incidents";
import { incidentInput, updateInput } from "../shared/incidents";
import { pageMonitors } from "../shared/page-scope";
import { translate } from "../shared/i18n";
import type { Language } from "../shared/settings";
import type { Monitor, StatusPage } from "../shared/types";
import { first, rows, statement } from "./db";

function invalid(message: string, status = 400): never {
  throw new Response(message, { status });
}
export async function incidentDetail(
  env: Env,
  id: string
): Promise<IncidentDetail> {
  const incident = await first<PublicIncident>(
    env.DB,
    "SELECT * FROM public_incidents WHERE id=?",
    id
  );
  if (!incident) invalid("Incidente no encontrado.", 404);
  const [monitors, updates] = await Promise.all([
    rows<{ id: string; name: string }>(
      env.DB,
      "SELECT m.id,m.name FROM incident_monitors im JOIN monitors m ON m.id=im.monitor_id WHERE im.incident_id=? ORDER BY m.name",
      id
    ),
    rows<IncidentUpdate>(
      env.DB,
      "SELECT * FROM incident_updates WHERE incident_id=? ORDER BY created_at,rowid",
      id
    )
  ]);
  return { ...incident, monitors, updates };
}
export async function incidentList(env: Env, monitorId?: string) {
  return rows<PublicIncident>(
    env.DB,
    `SELECT * FROM public_incidents ${monitorId ? "WHERE id IN (SELECT incident_id FROM incident_monitors WHERE monitor_id=?)" : ""} ORDER BY closed_at IS NULL DESC,updated_at DESC,id DESC LIMIT 100`,
    ...(monitorId ? [monitorId] : [])
  );
}
export async function requiredLanguages(
  env: Env,
  project: string,
  monitorIds: string[]
) {
  const [pages, monitors] = await Promise.all([
    rows<
      Omit<StatusPage, "group_ids" | "excluded_ids" | "included_ids"> & {
        group_ids: string;
        excluded_ids: string;
        included_ids: string | null;
      }
    >(
      env.DB,
      "SELECT * FROM pages WHERE published=1 AND project_id=?",
      project
    ),
    rows<Monitor>(env.DB, "SELECT * FROM monitors WHERE project_id=?", project)
  ]);
  const languages = new Set<Language>();
  for (const page of pages) {
    const selected = effectiveMonitors(page, monitors);
    if (selected.some((m) => monitorIds.includes(m.id)))
      languages.add(page.language);
  }
  return languages;
}
function effectiveMonitors(
  page: {
    project_id: string;
    group_ids: string;
    excluded_ids: string;
    included_ids: string | null;
  },
  monitors: Monitor[]
) {
  const ids =
    page.included_ids === null
      ? null
      : (JSON.parse(page.included_ids) as string[]);
  const excluded = JSON.parse(page.excluded_ids) as string[];
  return pageMonitors(
    monitors,
    page.project_id,
    JSON.parse(page.group_ids)
  ).filter((m) =>
    ids === null ? !excluded.includes(m.id) : ids.includes(m.id)
  );
}
function requireTranslation(
  detail: IncidentDetail,
  languages: Iterable<Language>
) {
  if (detail.origin === "automatic") {
    for (const language of languages)
      if (detail.updates.some((u) => !u.event && !u[`message_${language}`]))
        invalid("Completa las traducciones del incidente antes de publicarlo.");
    return;
  }
  for (const language of languages)
    if (
      !detail[`title_${language}`] ||
      detail.updates.some((u) => !u.event && !u[`message_${language}`])
    )
      invalid("Completa las traducciones del incidente antes de publicarlo.");
}
export async function validatePageIncidents(
  env: Env,
  page: {
    published: boolean;
    language: Language;
    project_id: string;
    group_ids: string[];
    included_ids?: string[];
    excluded_ids: string[];
  }
) {
  if (!page.published) return;
  const monitors = await rows<Monitor>(
    env.DB,
    "SELECT * FROM monitors WHERE project_id=?",
    page.project_id
  );
  const selected = pageMonitors(
    monitors,
    page.project_id,
    page.group_ids
  ).filter((m) =>
    page.included_ids === undefined
      ? !page.excluded_ids.includes(m.id)
      : page.included_ids.includes(m.id)
  );
  const ids = new Set(selected.map((m) => m.id));
  const incidents = await rows<PublicIncident>(
    env.DB,
    "SELECT * FROM public_incidents WHERE project_id=? AND published=1",
    page.project_id
  );
  for (const incident of incidents) {
    const detail = await incidentDetail(env, incident.id);
    if (detail.monitors.some((m) => ids.has(m.id)))
      requireTranslation(detail, [page.language]);
  }
}
export async function saveIncident(
  env: Env,
  input: unknown,
  now: number,
  id?: string
) {
  const value = incidentInput.parse(input);
  if (value.stage === "resolved")
    invalid("Crea el incidente antes de resolverlo.");
  const old = id ? await incidentDetail(env, id) : null;
  if (old && (old.origin !== "manual" || old.published))
    invalid("Solo se pueden editar borradores manuales.", 409);
  if (
    !(await first(
      env.DB,
      "SELECT id FROM projects WHERE id=?",
      value.project_id
    ))
  )
    invalid("Proyecto no encontrado.");
  for (const monitorId of value.monitor_ids)
    if (
      !(await first(
        env.DB,
        "SELECT id FROM monitors WHERE id=? AND project_id=?",
        monitorId,
        value.project_id
      ))
    )
      invalid("El monitor no pertenece al alcance seleccionado.");
  if (!value.message_es && !value.message_en)
    invalid("Escribe una actualización.");
  const key = id ?? crypto.randomUUID();
  const result = await env.DB.batch([
    statement(
      env.DB,
      "INSERT INTO public_incidents(id,project_id,origin,impact,stage,title_es,title_en,opened_at,updated_at) VALUES(?,?,'manual',?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET project_id=excluded.project_id,impact=excluded.impact,stage=excluded.stage,title_es=excluded.title_es,title_en=excluded.title_en,updated_at=excluded.updated_at WHERE public_incidents.origin='manual' AND public_incidents.published=0",
      key,
      value.project_id,
      value.impact,
      value.stage,
      value.title_es,
      value.title_en,
      now,
      now
    ),
    statement(
      env.DB,
      "DELETE FROM incident_monitors WHERE incident_id=? AND EXISTS(SELECT 1 FROM public_incidents WHERE id=? AND published=0)",
      key,
      key
    ),
    statement(
      env.DB,
      "DELETE FROM incident_updates WHERE incident_id=? AND EXISTS(SELECT 1 FROM public_incidents WHERE id=? AND published=0)",
      key,
      key
    ),
    ...value.monitor_ids.map((m) =>
      statement(
        env.DB,
        "INSERT OR IGNORE INTO incident_monitors SELECT ?,? WHERE EXISTS(SELECT 1 FROM public_incidents WHERE id=? AND published=0)",
        key,
        m,
        key
      )
    ),
    statement(
      env.DB,
      "INSERT INTO incident_updates(id,incident_id,stage,impact,message_es,message_en,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM public_incidents WHERE id=? AND published=0)",
      crypto.randomUUID(),
      key,
      value.stage,
      value.impact,
      value.message_es,
      value.message_en,
      now,
      key
    )
  ]);
  if (!result[0].meta.changes)
    invalid("Solo se pueden editar borradores manuales.", 409);
  return { id: key };
}
export async function publishIncident(env: Env, id: string, now: number) {
  const detail = await incidentDetail(env, id);
  if (detail.published) return;
  if (!detail.monitors.length) invalid("Selecciona los servicios afectados.");
  requireTranslation(
    detail,
    await requiredLanguages(
      env,
      detail.project_id,
      detail.monitors.map((m) => m.id)
    )
  );
  const result = await statement(
    env.DB,
    "UPDATE public_incidents SET published=1,updated_at=? WHERE id=? AND published=0 AND updated_at=? AND EXISTS(SELECT 1 FROM incident_updates WHERE id=? AND incident_id=public_incidents.id)",
    now,
    id,
    detail.updated_at,
    detail.updates.at(-1)?.id ?? ""
  ).run();
  if (!result.meta.changes)
    invalid(
      "El incidente cambió. Actualiza la página e inténtalo de nuevo.",
      409
    );
}
export async function addUpdate(
  env: Env,
  id: string,
  input: unknown,
  now: number
) {
  const value = updateInput.parse(input),
    detail = await incidentDetail(env, id);
  if (!detail.published)
    invalid("Publica el incidente antes de añadir actualizaciones.", 409);
  if (detail.closed_at !== null && value.stage !== "resolved")
    invalid("Un incidente resuelto no puede reabrirse.", 409);
  if (detail.closed_at !== null && value.impact !== detail.impact)
    invalid(
      "Las correcciones no cambian el impacto de un incidente resuelto.",
      409
    );
  const languages = await requiredLanguages(
    env,
    detail.project_id,
    detail.monitors.map((m) => m.id)
  );
  for (const language of languages)
    if (!value[`message_${language}`])
      invalid("Completa las traducciones del incidente antes de publicarlo.");
  if (
    detail.origin === "automatic" &&
    (value.impact !== detail.impact ||
      (value.stage === "resolved" && detail.closed_at === null))
  )
    invalid(
      "El motor controla el impacto y la recuperación de los incidentes automáticos.",
      409
    );
  const updateId = crypto.randomUUID();
  const guard =
    "id=? AND updated_at=? AND impact=? AND stage=? AND closed_at IS ?";
  const args = [
    id,
    detail.updated_at,
    detail.impact,
    detail.stage,
    detail.closed_at
  ];
  const result = await env.DB.batch([
    statement(
      env.DB,
      `INSERT INTO incident_updates(id,incident_id,stage,impact,message_es,message_en,created_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM public_incidents WHERE ${guard})`,
      updateId,
      id,
      value.stage,
      value.impact,
      value.message_es,
      value.message_en,
      now,
      ...args
    ),
    statement(
      env.DB,
      "UPDATE public_incidents SET stage=?,impact=?,updated_at=?,closed_at=CASE WHEN ?='resolved' THEN COALESCE(closed_at,?) ELSE closed_at END WHERE id=? AND EXISTS(SELECT 1 FROM incident_updates WHERE id=?)",
      value.stage,
      value.impact,
      now,
      value.stage,
      now,
      id,
      updateId
    )
  ]);
  if (!result[0].meta.changes)
    invalid(
      "El incidente cambió. Actualiza la página e inténtalo de nuevo.",
      409
    );
}
export async function automaticStatements(
  env: Env,
  monitor: Monitor,
  status: string,
  degraded: number,
  now: number,
  jobId: string,
  lease: string
) {
  const active = await first<PublicIncident>(
    env.DB,
    "SELECT * FROM public_incidents WHERE monitor_id=? AND origin='automatic' AND closed_at IS NULL",
    monitor.id
  );
  const impact: Impact | null =
    status === "down"
      ? "down"
      : status === "up" && degraded
        ? "degraded"
        : null;
  if (!impact && (!active || status !== "up")) return [];
  if (active && impact === active.impact) return [];
  const key = active?.id ?? `automatic:${jobId}`,
    stage = impact ? "investigating" : "resolved";
  const guard =
    "EXISTS(SELECT 1 FROM results r JOIN jobs j ON j.id=r.job_id WHERE r.job_id=? AND r.checked_at=? AND j.state='running' AND j.lease_token=?)";
  const args = [jobId, now, lease];
  const batch = active
    ? [
        statement(
          env.DB,
          `UPDATE public_incidents SET impact=?,stage=?,updated_at=?,closed_at=?,technical_id=COALESCE((SELECT id FROM incidents WHERE monitor_id=? AND closed_at IS NULL),technical_id) WHERE id=? AND ${guard}`,
          impact ?? active.impact,
          stage,
          now,
          impact ? null : now,
          monitor.id,
          key,
          ...args
        )
      ]
    : [
        statement(
          env.DB,
          `INSERT OR IGNORE INTO public_incidents(id,project_id,origin,monitor_id,technical_id,impact,stage,published,opened_at,updated_at) SELECT ?,?,'automatic',?,(SELECT id FROM incidents WHERE monitor_id=? AND closed_at IS NULL),?, ?,1,?,? WHERE ${guard}`,
          key,
          monitor.project_id,
          monitor.id,
          monitor.id,
          impact,
          stage,
          now,
          now,
          ...args
        ),
        statement(
          env.DB,
          `INSERT OR IGNORE INTO incident_monitors SELECT ?,? WHERE ${guard}`,
          key,
          monitor.id,
          ...args
        )
      ];
  batch.push(
    statement(
      env.DB,
      `INSERT OR IGNORE INTO incident_updates(id,incident_id,stage,impact,event,created_at) SELECT ?,?,?,?,?,? WHERE ${guard}`,
      `automatic-update:${jobId}`,
      key,
      stage,
      impact ?? active!.impact,
      impact ? (active ? "changed" : "detected") : "recovered",
      now,
      ...args
    )
  );
  return batch;
}
function automaticMessage(update: IncidentUpdate, language: Language) {
  return translate(
    language,
    update.event === "recovered"
      ? "El servicio volvió a funcionar normalmente."
      : update.impact === "down"
        ? "Detectamos una interrupción del servicio."
        : "Detectamos respuestas más lentas de lo habitual."
  );
}
export async function publicIncidents(
  env: Env,
  project: string,
  monitors: Monitor[],
  language: Language,
  now: number,
  archive = false,
  cursor?: { time: number; id: string }
) {
  if (!monitors.length)
    return { incidents: [] as PublicIncidentView[], nextCursor: null };
  const monitorIds = JSON.stringify(monitors.map((m) => m.id));
  const list = await rows<PublicIncident>(
    env.DB,
    `SELECT * FROM public_incidents WHERE project_id=? AND published=1 AND id IN (SELECT incident_id FROM incident_monitors WHERE monitor_id IN (SELECT value FROM json_each(?))) AND ${archive ? "closed_at>=?" : "(closed_at IS NULL OR closed_at>=?)"} ${cursor ? "AND (opened_at<? OR (opened_at=? AND id<?))" : ""} ORDER BY opened_at DESC,id DESC ${archive ? "LIMIT 21" : ""}`,
    project,
    monitorIds,
    now - (archive ? 90 : 1) * 86400,
    ...(cursor ? [cursor.time, cursor.time, cursor.id] : [])
  );
  const visible = archive ? list.slice(0, 20) : list;
  const incidentIds = JSON.stringify(visible.map((i) => i.id));
  const [affected, updates] = await Promise.all([
    rows<{ incident_id: string; id: string; name: string }>(
      env.DB,
      "SELECT im.incident_id,m.id,m.name FROM incident_monitors im JOIN monitors m ON m.id=im.monitor_id WHERE im.incident_id IN (SELECT value FROM json_each(?)) AND m.id IN (SELECT value FROM json_each(?)) ORDER BY m.name",
      incidentIds,
      monitorIds
    ),
    rows<IncidentUpdate>(
      env.DB,
      "SELECT * FROM incident_updates WHERE incident_id IN (SELECT value FROM json_each(?)) ORDER BY created_at,rowid",
      incidentIds
    )
  ]);
  const incidents = visible.map((incident) => {
    return {
      id: incident.id,
      origin: incident.origin,
      impact: incident.impact,
      stage: incident.stage,
      title:
        incident.origin === "automatic"
          ? translate(language, "Incidente detectado automáticamente")
          : incident[`title_${language}`],
      opened_at: incident.opened_at,
      closed_at: incident.closed_at,
      updated_at: incident.updated_at,
      monitors: affected
        .filter((m) => m.incident_id === incident.id)
        .map((m) => ({ id: m.id, name: m.name })),
      updates: updates
        .filter((u) => u.incident_id === incident.id)
        .map((u) => ({
          id: u.id,
          stage: u.stage,
          impact: u.impact,
          created_at: u.created_at,
          message: u.event
            ? automaticMessage(u, language)
            : u[`message_${language}`]
        }))
    } satisfies PublicIncidentView;
  });
  const last = visible.at(-1);
  return {
    incidents,
    nextCursor:
      archive && list.length > 20 && last
        ? { time: last.opened_at, id: last.id }
        : null
  };
}
