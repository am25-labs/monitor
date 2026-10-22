import { CliError, requireValue } from "./messages.mjs";

export class CloudflareError extends CliError {
  constructor(status, codes = []) {
    super(`Cloudflare rechazó la operación (HTTP ${status}; ${codes.join(", ") || "sin código"}). Revisá los permisos y el diagnóstico.`, `Cloudflare rejected the operation (HTTP ${status}; ${codes.join(", ") || "no code"}). Check permissions and diagnostics.`);
    this.status = status;
    this.codes = codes;
  }
}

export class Cloudflare {
  constructor(token, fetcher = fetch) { this.token = token; this.fetcher = fetcher; }

  async request(path, { method = "GET", body, allowMissing = false } = {}) {
    requireValue(path.startsWith("/") && !path.startsWith("//"), "Ruta de API inválida.", "Invalid API path.");
    const response = await this.fetcher(`https://api.cloudflare.com/client/v4${path}`, {
      method, headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000)
    });
    if (allowMissing && response.status === 404) return null;
    let data;
    try { data = await response.json(); }
    catch { throw new CloudflareError(response.status); }
    if (!response.ok || data.success === false) throw new CloudflareError(response.status, (data.errors ?? []).map((error) => error.code).filter(Number.isFinite));
    return data;
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
