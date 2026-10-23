import { CliError, requireValue } from "./messages.mjs";
import { setTimeout } from "node:timers/promises";

function retryDelay(response, attempt) {
  const value = response?.headers.get("retry-after");
  if (!value) return 500 * 2 ** attempt;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(delay) ? Math.max(0, delay) : 500 * 2 ** attempt;
}

export class CloudflareError extends CliError {
  constructor(status, codes = []) {
    const detail = status >= 500
      ? ["Cloudflare no pudo completar la solicitud. Volvé a intentar más tarde.", "Cloudflare could not complete the request. Try again later."]
      : status === 429
        ? ["Se alcanzó el límite de solicitudes de Cloudflare. Esperá antes de reintentar.", "Cloudflare's request limit was reached. Wait before retrying."]
        : ["Revisá los permisos y el diagnóstico.", "Check permissions and diagnostics."];
    super(`Error de Cloudflare (HTTP ${status}; ${codes.join(", ") || "sin código"}). ${detail[0]}`, `Cloudflare error (HTTP ${status}; ${codes.join(", ") || "no code"}). ${detail[1]}`);
    this.status = status;
    this.codes = codes;
  }
}

export class Cloudflare {
  constructor(token, fetcher = fetch, pause = setTimeout) { this.token = token; this.fetcher = fetcher; this.pause = pause; }

  async request(path, { method = "GET", body, allowMissing = false } = {}) {
    requireValue(path.startsWith("/") && !path.startsWith("//"), "Ruta de API inválida.", "Invalid API path.");
    for (let attempt = 0; ; attempt++) {
      const canRetry = method === "GET" && attempt < 2;
      let response;
      try {
        response = await this.fetcher(`https://api.cloudflare.com/client/v4${path}`, {
          method, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000)
        });
      } catch (error) {
        if (!canRetry || !(error instanceof TypeError || ["TimeoutError", "AbortError"].includes(error?.name))) throw error;
        await this.pause(retryDelay(null, attempt));
        continue;
      }
      const delay = retryDelay(response, attempt);
      if (canRetry && [408, 429, 500, 502, 503, 504].includes(response.status) && delay <= 30000) {
        await response.body?.cancel();
        await this.pause(delay);
        continue;
      }
      if (allowMissing && response.status === 404) return null;
      let data;
      try { data = await response.json(); }
      catch { throw new CloudflareError(response.status); }
      if (!response.ok || data.success === false) throw new CloudflareError(response.status, (data.errors ?? []).map((error) => error.code).filter(Number.isFinite));
      return data;
    }
  }

  async get(path, options) { return (await this.request(path, options))?.result ?? null; }
  async post(path, body) { return (await this.request(path, { method: "POST", body })).result; }

  async list(path) {
    const result = [];
    let page = 1, cursor;
    while (true) {
      const query = new URLSearchParams(cursor ? { cursor } : { page: String(page), per_page: "50" });
      const data = await this.request(`${path}${path.includes("?") ? "&" : "?"}${query}`);
      requireValue(Array.isArray(data.result), "Respuesta inesperada de Cloudflare.", "Unexpected Cloudflare response.");
      result.push(...data.result);
      const nextCursor = data.result_info?.cursors?.after ?? data.result_info?.cursor;
      if (nextCursor && nextCursor !== cursor) { cursor = nextCursor; continue; }
      if (data.result_info?.total_pages > page) { page++; continue; }
      break;
    }
    return result;
  }

  account(state, suffix) { return `/accounts/${encodeURIComponent(state.accountId)}${suffix}`; }
  async query(state, sql, params = []) {
    const result = await this.post(this.account(state, `/d1/database/${encodeURIComponent(state.resources.database.id)}/query`), { sql, params });
    requireValue(Array.isArray(result) && result.every((item) => item.success !== false), "Falló la consulta de diagnóstico de D1.", "D1 diagnostic query failed.");
    return result[0]?.results ?? [];
  }
}
