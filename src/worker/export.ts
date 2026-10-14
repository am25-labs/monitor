import { z } from "zod";
import { product } from "../shared/product";
import { readExportPeriod, type ExportPeriod } from "../shared/export-period";

const tables = [
  "projects", "groups", "monitors", "jobs", "results", "daily_stats",
  "hourly_stats", "short_stats", "incidents", "notifications",
  "notification_deliveries", "maintenance", "pages", "public_incidents",
  "incident_monitors", "incident_updates", "app_settings", "engine",
  "sqlite_sequence"
] as const;

type Table = typeof tables[number];
type ExportRow = Record<string, unknown> & { export_rowid: number };

export function projectFilter(table: string) {
  const project = "IN (SELECT value FROM json_each(?))";
  const monitor = `IN (SELECT id FROM monitors WHERE project_id ${project})`;
  const incident = `IN (SELECT id FROM incidents WHERE monitor_id ${monitor})`;
  const publicIncident = `IN (SELECT id FROM public_incidents WHERE project_id ${project})`;
  switch (table) {
    case "projects": return `id ${project}`;
    case "groups":
    case "monitors":
    case "pages":
    case "public_incidents": return `project_id ${project}`;
    case "jobs":
    case "results":
    case "daily_stats":
    case "hourly_stats":
    case "short_stats":
    case "incidents": return `monitor_id ${monitor}`;
    case "notifications": return `incident_id ${incident}`;
    case "notification_deliveries": return `notification_id IN (SELECT id FROM notifications WHERE incident_id ${incident})`;
    case "incident_monitors":
    case "incident_updates": return `incident_id ${publicIncident}`;
    case "maintenance": return `scope='global' OR (scope='project' AND target_id ${project}) OR (scope='group' AND target_id IN (SELECT id FROM groups WHERE project_id ${project})) OR (scope='monitor' AND target_id ${monitor})`;
    default: return "0";
  }
}

function periodSelection(table: Table, period: ExportPeriod): { filter: string; args: (string | number)[] } {
  const start = Date.parse(period.start) / 1000;
  const end = Date.parse(period.end) / 1000;
  const overlap = "opened_at<? AND (closed_at IS NULL OR closed_at>?)";
  const within = (column: string) => ({ filter: `${column}>=? AND ${column}<?`, args: [start, end] });
  switch (table) {
    case "jobs": return within("due_at");
    case "results": return within("checked_at");
    case "daily_stats":
    case "hourly_stats":
    case "short_stats": {
      const column = { daily_stats: "day", hourly_stats: "hour", short_stats: "slot" }[table];
      return { filter: `${column}>=? AND ${column}<?`, args: [period.start.slice(0, 10), period.end.slice(0, 10)] };
    }
    case "incidents": return { filter: `(${overlap}) OR id IN (SELECT technical_id FROM public_incidents WHERE ${overlap})`, args: [end, start, end, start] };
    case "public_incidents": return { filter: overlap, args: [end, start] };
    case "maintenance": return { filter: "starts_at<? AND (ends_at IS NULL OR ends_at>?)", args: [end, start] };
    case "notifications": return { filter: `created_at>=? AND created_at<? AND incident_id IN (SELECT id FROM incidents WHERE ${overlap})`, args: [start, end, end, start] };
    case "notification_deliveries": {
      const notifications = periodSelection("notifications", period);
      return { filter: `notification_id IN (SELECT id FROM notifications WHERE ${notifications.filter})`, args: notifications.args };
    }
    case "incident_monitors": return { filter: `incident_id IN (SELECT id FROM public_incidents WHERE ${overlap})`, args: [end, start] };
    case "incident_updates": return { filter: `created_at>=? AND created_at<? AND incident_id IN (SELECT id FROM public_incidents WHERE ${overlap})`, args: [start, end, end, start] };
    default: return { filter: "1", args: [] };
  }
}

function selection(table: Table, projectIds: string[] | null, period?: ExportPeriod) {
  const filter = projectIds === null ? "1" : projectFilter(table);
  const args: (string | number)[] = Array.from({ length: filter.split("?").length - 1 }, () => JSON.stringify(projectIds));
  if (!period) return { filter, args };
  const temporal = periodSelection(table, period);
  return { filter: `(${filter}) AND (${temporal.filter})`, args: [...args, ...temporal.args] };
}

async function* exportChunks(db: D1DatabaseSession, projectIds: string[] | null, startedAt: string, period?: ExportPeriod) {
  const selectedTables = projectIds === null ? tables : tables.filter((table) => !["app_settings", "engine", "sqlite_sequence"].includes(table));
  const schema = await db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND tbl_name IN (SELECT value FROM json_each(?)) ORDER BY type,name")
    .bind(JSON.stringify(selectedTables)).all();
  const bounds = await db.batch<{ last_rowid: number | null }>(selectedTables.map((table) => db.prepare(`SELECT MAX(rowid) AS last_rowid FROM ${table}`)));
  yield `{"format":"am25-monitor","formatVersion":1,"appVersion":${JSON.stringify(product.version)},"startedAt":${JSON.stringify(startedAt)},"scope":${JSON.stringify(projectIds === null ? { type: "full" } : { type: "projects", projectIds, ...(period ? { period } : {}) })},"consistency":"live","credentials":"encrypted-with-original-CONFIG_KEY","schema":${JSON.stringify(schema.results)},"data":{`;
  for (const [index, table] of selectedTables.entries()) {
    yield `${index ? "," : ""}${JSON.stringify(table)}:[`;
    const { filter, args } = selection(table, projectIds, period);
    const lastRowid = bounds[index].results[0].last_rowid ?? 0;
    let cursor = 0;
    let separator = "";
    while (cursor < lastRowid) {
      const { results } = await db.prepare(`SELECT rowid AS export_rowid,* FROM ${table} WHERE rowid>? AND rowid<=? AND (${filter}) ORDER BY rowid LIMIT 1000`)
        .bind(cursor, lastRowid, ...args).all<ExportRow>();
      if (!results.length) break;
      cursor = results[results.length - 1].export_rowid;
      const records = results.map(({ export_rowid: _, ...record }) => record);
      yield separator + records.map((record) => JSON.stringify(record)).join(",");
      separator = ",";
    }
    yield "]";
  }
  yield `},"completedAt":${JSON.stringify(new Date().toISOString())}}`;
}

export async function exportData(request: Request, env: Env) {
  const params = new URL(request.url).searchParams;
  const scope = z.enum(["full", "projects"]).parse(params.get("scope"));
  const projectIds = scope === "full" ? null : [...new Set(z.array(z.uuid()).min(1).parse(params.getAll("project")))];
  const period = scope === "projects" ? readExportPeriod(params) : undefined;
  const db = env.DB.withSession("first-primary");
  if (projectIds) {
    const { results } = await db.prepare("SELECT id FROM projects WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(projectIds)).all();
    if (results.length !== projectIds.length) throw new Response("No encontrado.", { status: 404 });
  }
  const startedAt = new Date().toISOString();
  const chunks = exportChunks(db, projectIds, startedAt, period);
  const first = await chunks.next();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.value) controller.enqueue(encoder.encode(first.value));
    },
    async pull(controller) {
      try {
        const chunk = await chunks.next();
        if (chunk.done) controller.close();
        else controller.enqueue(encoder.encode(chunk.value));
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() { await chunks.return(); }
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="monitor-${scope}-${period ? `${period.start.slice(0, period.type === "month" ? 7 : 4)}-` : ""}${startedAt.replace(/[:.]/g, "-")}.json"`,
      "Cache-Control": "no-store"
    }
  });
}
