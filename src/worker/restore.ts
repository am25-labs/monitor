import { parseBackup, backupTables, projectTables, type Backup, type BackupRow } from "../shared/backup";
import { unseal } from "./crypto";
import { nowSeconds } from "./db";
import { projectFilter } from "./export";
import { monitorInput } from "../shared/schema";
import { generalInput, notificationInput } from "../shared/settings";
import { providerOutageInput } from "../shared/provider-outage";

const deletionOrder = ["notification_deliveries", "notifications", "incident_updates", "incident_monitors", "public_incidents", "incidents", "results", "jobs", "daily_stats", "hourly_stats", "short_stats", "pages", "maintenance", "monitors", "groups", "projects", "app_settings", "engine", "sqlite_sequence"];

function* rowChunks(records: BackupRow[]) {
  const encoder = new TextEncoder();
  let chunk: string[] = [];
  let size = 2;
  for (const record of records) {
    const value = JSON.stringify(record);
    const bytes = encoder.encode(value).length + 1;
    if (chunk.length && size + bytes > 256 * 1024) {
      yield `[${chunk.join(",")}]`;
      chunk = [];
      size = 2;
    }
    chunk.push(value);
    size += bytes;
  }
  if (chunk.length) yield `[${chunk.join(",")}]`;
}

function validateScope(backup: Backup) {
  const projects = new Set(backup.data.projects.map((row) => row.id));
  const monitors = new Map(backup.data.monitors.map((row) => [row.id, row]));
  const groups = new Map(backup.data.groups.map((row) => [row.id, row]));
  const incidents = new Set(backup.data.incidents.map((row) => row.id));
  const publicIncidents = new Map(backup.data.public_incidents.map((row) => [row.id, row]));
  const notifications = new Set(backup.data.notifications.map((row) => row.id));
  const invalid = () => { throw new Error("La copia contiene relaciones inválidas o datos de otro proyecto."); };
  for (const table of ["groups", "monitors", "pages", "public_incidents"])
    for (const row of backup.data[table]) if (!projects.has(row.project_id)) invalid();
  for (const row of backup.data.monitors)
    if (row.group_id !== null && groups.get(row.group_id)?.project_id !== row.project_id) invalid();
  for (const table of ["jobs", "results", "daily_stats", "hourly_stats", "short_stats", "incidents", "incident_monitors"])
    for (const row of backup.data[table]) if (!monitors.has(row.monitor_id)) invalid();
  for (const row of backup.data.notifications) if (row.incident_id !== null && !incidents.has(row.incident_id)) invalid();
  for (const row of backup.data.notification_deliveries) if (!notifications.has(row.notification_id)) invalid();
  for (const table of ["incident_monitors", "incident_updates"])
    for (const row of backup.data[table]) if (!publicIncidents.has(row.incident_id)) invalid();
  for (const row of backup.data.incident_monitors)
    if (monitors.get(row.monitor_id)?.project_id !== publicIncidents.get(row.incident_id)?.project_id) invalid();
  for (const row of backup.data.public_incidents) {
    if (row.monitor_id !== null && monitors.get(row.monitor_id)?.project_id !== row.project_id) invalid();
    if (row.technical_id !== null && !incidents.has(row.technical_id)) invalid();
  }
  for (const row of backup.data.pages) {
    for (const column of ["group_ids", "included_ids", "excluded_ids"]) {
      if (row[column] === null) continue;
      let ids: unknown;
      try { ids = JSON.parse(String(row[column])); } catch { invalid(); }
      if (!Array.isArray(ids) || ids.some((id) => {
        if (typeof id !== "string") return true;
        const target = (column === "group_ids" ? groups : monitors).get(id);
        return target !== undefined && target.project_id !== row.project_id;
      })) invalid();
    }
  }
  for (const row of backup.data.maintenance) {
    if (row.scope === "global" && row.target_id === null) continue;
    if (row.scope === "project" && projects.has(row.target_id)) continue;
    if (row.scope === "group" && groups.has(row.target_id)) continue;
    if (row.scope === "monitor" && monitors.has(row.target_id)) continue;
    if (backup.scope.type === "full" && ["project", "group", "monitor"].includes(String(row.scope)) && typeof row.target_id === "string") continue;
    invalid();
  }
}

async function validateKey(backup: Backup, key: string) {
  async function decode(value: string, context: string) {
    try { return await unseal(value, key, context); }
    catch { throw new Error("La copia no se puede descifrar con la CONFIG_KEY de esta instalación. No se modificó ningún dato."); }
  }
  const invalid = () => { throw new Error("La copia no es un JSON de Monitor completo y compatible."); };
  for (const row of backup.data.monitors) {
    const config = await decode(String(row.config), String(row.id));
    if (!monitorInput.safeParse({ ...row, config, paused: Boolean(row.paused) }).success) invalid();
  }
  for (const row of backup.data.app_settings ?? []) {
    if (row.id === "notifications") {
      if (!notificationInput.safeParse(await decode(String(row.value), "settings:notifications")).success) invalid();
    } else if (row.id === "general") {
      let value: unknown;
      try { value = JSON.parse(String(row.value)); } catch { invalid(); }
      if (!generalInput.safeParse(value).success) invalid();
    } else if (row.id === "provider-outage") {
      let value: unknown;
      try { value = JSON.parse(String(row.value)); } catch { invalid(); }
      if (!providerOutageInput.safeParse(value).success) invalid();
    }
  }
  for (const row of backup.data.notification_deliveries)
    if (row.receipt_token !== null) await decode(String(row.receipt_token), `receipt:${row.notification_id}`);
  if (backup.scope.type === "full" && (backup.data.engine.length !== 1 || backup.data.engine[0].id !== 1)) invalid();
}

export async function restoreData(input: unknown, env: Env) {
  const backup = parseBackup(input);
  validateScope(backup);
  await validateKey(backup, env.CONFIG_KEY);
  const full = backup.scope.type === "full";
  const tables = full ? backupTables : projectTables;
  const projects = JSON.stringify(backup.data.projects.map((row) => row.id));
  const db = env.DB.withSession("first-primary");
  const columns = await db.batch<{ name: string }>(tables.map((table) => db.prepare(`PRAGMA table_info(${table})`)));
  const statements: D1PreparedStatement[] = [];
  for (const table of deletionOrder.filter((table) => tables.includes(table))) {
    const filter = full ? "1" : projectFilter(table);
    const selected = table === "maintenance" && !full ? `(${filter}) AND scope<>'global'` : filter;
    const args = Array.from({ length: filter.split("?").length - 1 }, () => projects);
    statements.push(db.prepare(`DELETE FROM ${table} WHERE ${selected}`).bind(...args));
  }
  for (const [index, table] of tables.entries()) {
    const names = columns[index].results.map((column) => column.name);
    let records = backup.data[table];
    if (table === "maintenance" && !full) records = records.filter((row) => row.scope !== "global");
    if (table === "jobs") records = records.map((row) => ["pending", "running"].includes(String(row.state)) ? { ...row, state: "cancelled", lease_token: null, lease_until: null, completed_at: nowSeconds() } : row);
    if (table === "notifications") records = records.map((row) => ({ ...row, lease_token: null, lease_until: null, state: ["pending", "sending"].includes(String(row.state)) ? "cancelled" : row.state }));
    if (table === "notification_deliveries") records = records.map((row) => ["pending", "sending", "running"].includes(String(row.state)) ? { ...row, state: "cancelled" } : row);
    if (table === "monitors") records = records.map((row) => ({ ...row, next_due: nowSeconds() + 60 }));
    if (!records.length) continue;
    if (table === "sqlite_sequence") statements.push(db.prepare("DELETE FROM sqlite_sequence"));
    const values = names.map((name) => `json_extract(value,'$.${name}')`).join(",");
    for (const chunk of rowChunks(records))
      statements.push(db.prepare(`INSERT INTO ${table}(${names.join(",")}) SELECT ${values} FROM json_each(?)`).bind(chunk));
  }
  await db.batch(statements);
  return { ok: true };
}
