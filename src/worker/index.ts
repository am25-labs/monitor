export { MonitorScheduler } from "./scheduler";
export { MonitorRunner } from "./runner";
import { authorizeAgent } from "./agent-access";
import { analyticsApi } from "./analytics-api";
import { ZodError } from "zod";
import type { JobMessage } from "../shared/types";
import { admin, json, publicPage, receiveHeartbeat } from "./api";
import { authorize, requireOrigin } from "./auth";
import { consume } from "./engine";
import { generalSettings } from "./settings";
import { validationMessage } from "../shared/validation";

async function route(request: Request, env: Env) {
  const url = new URL(request.url),
    path = url.pathname;
  if (env.ENVIRONMENT !== "local" && url.origin !== env.APP_ORIGIN)
    return json({ error: "Dominio no autorizado." }, 404);
  if (path === "/mcp" || path.startsWith("/api/v1/analytics/")) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== env.APP_ORIGIN) return json({ error: "Origen no autorizado." }, 403);
    await authorizeAgent(request, env);
    if (path === "/mcp") return (await import("./mcp")).mcp(request, env);
    return analyticsApi(request, env, path.slice("/api/v1/analytics/".length));
  }
  if (path === "/") return Response.redirect(new URL("/app/", url), 302);
  if (
    path === "/app" ||
    path.startsWith("/app/") ||
    path === "/api/v1/admin" ||
    path.startsWith("/api/v1/admin/")
  ) {
    await authorize(request, env);
    if (path.startsWith("/api/")) {
      if (!["GET", "HEAD"].includes(request.method))
        requireOrigin(request, env);
      return admin(request, env, path.slice("/api/v1/admin/".length));
    }
    if (env.ENVIRONMENT === "local")
      return new Response(
        "Abre http://localhost:5173/app/ para el dashboard local."
      );
    return env.ASSETS.fetch(new Request(new URL("/", url), request));
  }
  const heartbeat = path.match(/^\/api\/v1\/heartbeats\/([a-f\d-]+)$/);
  if (heartbeat && request.method === "POST")
    return receiveHeartbeat(request, env, heartbeat[1]);
  const page = path.match(/^\/api\/v1\/public\/([a-z0-9-]+)$/);
  if (page && request.method === "GET") return publicPage(env, page[1], url.searchParams);
  if (path.startsWith("/api/"))
    return json({ error: "Ruta no encontrada." }, 404);
  if (env.ENVIRONMENT === "local")
    return new Response("Frontend local en http://localhost:5173");
  if (/^\/status\/[a-z0-9-]+\/?$/.test(path))
    return env.ASSETS.fetch(new Request(new URL("/", url), request));
  if (path.startsWith("/assets/")) return env.ASSETS.fetch(request);
  return new Response("No encontrado.", { status: 404 });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try {
      response = await route(request, env);
    } catch (error) {
      if (error instanceof Response) response = error;
      else if (error instanceof ZodError) {
        const settings = await generalSettings(env).catch(() => ({ language: "es" as const }));
        response = json(
          { error: validationMessage(error, settings.language) },
          400
        );
      } else {
        const message = error instanceof Error ? error.message : "";
        const conflict = /FOREIGN KEY|UNIQUE constraint|monitor_capacity/.test(
          message
        );
        response = json(
          {
            error: conflict
              ? "El recurso tiene dependencias, un nombre duplicado o se alcanzó el límite de 100 monitores."
              : "No fue posible completar la operación."
          },
          conflict ? 409 : 500
        );
        if (!conflict)
          console.error(
            JSON.stringify({
              event: "request_failure",
              path: new URL(request.url).pathname
            })
          );
      }
    }
    const secured = new Response(response.body, response);
    secured.headers.set("X-Content-Type-Options", "nosniff");
    secured.headers.set("Referrer-Policy", "same-origin");
    secured.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://cloudflareinsights.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
    );
    if (!new URL(request.url).pathname.startsWith("/assets/"))
      secured.headers.set("Cache-Control", "no-store");
    return secured;
  },
  async scheduled(_controller: ScheduledController, env: Env) {
    await env.SCHEDULER.getByName("engine").ensure();
  },
  async queue(batch: MessageBatch<JobMessage>, env: Env) {
    await consume(batch, env);
  }
} satisfies ExportedHandler<Env, JobMessage>;
