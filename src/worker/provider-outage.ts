import { providerOutageChange, providerOutageInput, type ProviderOutage } from "../shared/provider-outage";
import { first, rows, statement } from "./db";

export const providerOutageActive = "EXISTS(SELECT 1 FROM app_settings WHERE id='provider-outage')";
const owned = "EXISTS(SELECT 1 FROM app_settings WHERE id='provider-outage' AND json_extract(value,'$.id')=?)";

export async function providerOutage(env: Env): Promise<ProviderOutage | null> {
  const stored = await first<{ value: string }>(env.DB, "SELECT value FROM app_settings WHERE id='provider-outage'");
  return stored ? providerOutageInput.parse(JSON.parse(stored.value)) : null;
}

async function activate(env: Env, now: number) {
  const existing = await providerOutage(env);
  if (existing) return existing;
  const projects = await rows<{ id: string }>(env.DB, "SELECT id FROM projects WHERE EXISTS(SELECT 1 FROM monitors WHERE monitors.project_id=projects.id)");
  if (!projects.length) throw new Response("Agrega un monitor antes de activar el incidente del proveedor.", { status: 409 });
  const outage: ProviderOutage = { id: crypto.randomUUID(), started_at: now, incident_ids: projects.map(() => crypto.randomUUID()) };
  const batch = [statement(env.DB, "INSERT INTO app_settings(id,value,updated_at) VALUES('provider-outage',?,?) ON CONFLICT(id) DO NOTHING", JSON.stringify(outage), now)];
  for (const [index, project] of projects.entries()) {
    const id = outage.incident_ids[index];
    batch.push(
      statement(env.DB, `INSERT INTO public_incidents(id,project_id,origin,impact,stage,title_es,title_en,published,opened_at,updated_at) SELECT ?,?,'manual','down','identified',?,?,1,?,? WHERE ${owned}`,
        id, project.id, "Interrupción del proveedor de infraestructura", "Infrastructure provider outage", now, now, outage.id),
      statement(env.DB, `INSERT INTO incident_monitors(incident_id,monitor_id) SELECT ?,id FROM monitors WHERE project_id=? AND ${owned}`, id, project.id, outage.id),
      statement(env.DB, `INSERT INTO incident_updates(id,incident_id,stage,impact,message_es,message_en,created_at) SELECT ?,?,'identified','down',?,?,? WHERE ${owned}`,
        crypto.randomUUID(), id,
        "El proveedor de infraestructura está experimentando un inconveniente que ha interrumpido nuestros servicios. Continuamos supervisando su restablecimiento.",
        "Our infrastructure provider is experiencing an issue that has interrupted our services. We continue monitoring their recovery.", now, outage.id)
    );
  }
  batch.push(
    statement(env.DB, `UPDATE notifications SET state='cancelled',error=NULL,lease_token=NULL,lease_until=NULL WHERE event='opened' AND state IN ('pending','sending','failed') AND ${owned}`, outage.id),
    statement(env.DB, `UPDATE notification_deliveries SET state='cancelled',error=NULL WHERE state IN ('pending','failed') AND notification_id IN (SELECT id FROM notifications WHERE event='opened' AND state='cancelled') AND ${owned}`, outage.id)
  );
  await env.DB.batch(batch);
  return providerOutage(env);
}

async function deactivate(env: Env, id: string, now: number) {
  const outage = await providerOutage(env);
  if (!outage) return null;
  if (outage.id !== id) throw new Response("El incidente cambió. Actualiza la página e inténtalo de nuevo.", { status: 409 });
  const batch: D1PreparedStatement[] = [];
  for (const incident of outage.incident_ids) {
    batch.push(
      statement(env.DB, `INSERT INTO incident_updates(id,incident_id,stage,impact,message_es,message_en,created_at) SELECT ?,id,'resolved',impact,?,?,? FROM public_incidents WHERE id=? AND closed_at IS NULL AND ${owned}`,
        crypto.randomUUID(), "El proveedor de infraestructura ha restablecido su operación. El estado de cada servicio se confirma mediante sus comprobaciones.",
        "The infrastructure provider has restored its operations. Each service's status is confirmed by its checks.", now, incident, id),
      statement(env.DB, `UPDATE public_incidents SET stage='resolved',closed_at=?,updated_at=? WHERE id=? AND closed_at IS NULL AND ${owned}`, now, now, incident, id)
    );
  }
  batch.push(statement(env.DB, "DELETE FROM app_settings WHERE id='provider-outage' AND json_extract(value,'$.id')=?", id));
  await env.DB.batch(batch);
  return providerOutage(env);
}

export async function changeProviderOutage(env: Env, input: unknown, now: number) {
  const value = providerOutageChange.parse(input);
  return value.enabled ? activate(env, now) : deactivate(env, value.id, now);
}
