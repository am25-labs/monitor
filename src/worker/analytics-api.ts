import { z } from "zod";
import { checkQuery, compareParams, comparisonQuery, incidentQuery, metricQuery } from "../shared/analytics";
import { analyticsChecks, analyticsCompare, analyticsIncident, analyticsIncidents, analyticsInfo, analyticsMetrics, listAnalyticsMonitors } from "./analytics";
import { openapiDocument } from "./openapi";

export function queryParams(request: Request) {
  const entries: Record<string, unknown> = {};
  for (const [key, value] of new URL(request.url).searchParams) {
    if (key in entries) throw Response.json({ error: "No repitas los parámetros de consulta." }, { status: 400 });
    entries[key] = key === "limit" ? Number(value) : value;
  }
  return entries;
}

export async function analyticsApi(request: Request, env: Env, path: string) {
  if (request.method !== "GET") return new Response(null, { status: 405, headers: { Allow: "GET" } });
  const input = queryParams(request);
  let result: unknown;
  if (path === "info") { z.object({}).strict().parse(input); result = await analyticsInfo(env); }
  else if (path === "monitors") result = await listAnalyticsMonitors(env, input);
  else if (path === "metrics") result = await analyticsMetrics(env, metricQuery.parse(input));
  else if (path === "incidents") result = await analyticsIncidents(env, incidentQuery.parse(input));
  else if (path === "checks") result = await analyticsChecks(env, checkQuery.parse(input));
  else if (path === "compare") {
    const query = compareParams.parse(input);
    const filters = { project: query.project, group: query.group, monitor: query.monitor };
    result = await analyticsCompare(env, comparisonQuery.parse({ baseline: { ...filters, start: query.baseline_start, end: query.baseline_end }, current: { ...filters, start: query.start, end: query.end } }));
  } else if (/^incidents\/[^/]+$/.test(path)) {
    z.object({}).strict().parse(input);
    let id: string;
    try { id = decodeURIComponent(path.slice("incidents/".length)); }
    catch { throw Response.json({ error: "Identificador de incidente inválido." }, { status: 400 }); }
    result = await analyticsIncident(env, id);
  }
  else if (path === "openapi.json") { z.object({}).strict().parse(input); result = openapiDocument(env.APP_ORIGIN); }
  else return Response.json({ error: "Ruta no encontrada." }, { status: 404 });
  return Response.json(result);
}
