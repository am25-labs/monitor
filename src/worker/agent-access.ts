import { timingSafeEqual } from "node:crypto";
import { analyticsSettings, tokenInput, type AgentToken } from "../shared/analytics";
import { digest, token } from "./crypto";
import { first, nowSeconds, statement } from "./db";

export async function agentSettings(env: Env) {
  const stored = await first<{ value: string }>(env.DB, "SELECT value FROM app_settings WHERE id='analytics'");
  return { stored: stored?.value ?? null, value: analyticsSettings.parse(stored ? JSON.parse(stored.value) : { hourly_metrics_since: null, tokens: [] }) };
}

export async function agentTokens(env: Env): Promise<AgentToken[]> {
  return (await agentSettings(env)).value.tokens.map(({ hash: _, ...entry }) => entry);
}

export async function changeAgentToken(env: Env, input: unknown, id?: string) {
  const { stored, value } = await agentSettings(env);
  let secret: string | undefined;
  if (id) value.tokens = value.tokens.filter((entry) => entry.id !== id);
  else {
    const data = tokenInput.parse(input);
    const now = nowSeconds();
    value.tokens = value.tokens.filter((entry) => entry.expires_at > now);
    if (value.tokens.length >= 20) throw Response.json({ error: "Revoca una credencial antes de crear otra." }, { status: 409 });
    const key = crypto.randomUUID();
    secret = `${key}.${token()}`;
    value.tokens.push({ id: key, name: data.name, hash: await digest(secret), created_at: now, expires_at: now + data.expiresInDays * 86400 });
  }
  const saved = await statement(env.DB,
    "INSERT INTO app_settings(id,value,updated_at) VALUES('analytics',?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE app_settings.value=?",
    JSON.stringify(value), nowSeconds(), stored
  ).run();
  if (!saved.meta.changes) throw Response.json({ error: "La configuración cambió. Actualiza la página e inténtalo de nuevo." }, { status: 409 });
  return { token: secret, tokens: value.tokens.map(({ hash: _, ...entry }) => entry) };
}

export async function authorizeAgent(request: Request, env: Env) {
  const bearer = request.headers.get("Authorization")?.match(/^Bearer ([a-f\d-]{36}\.[a-f\d]{64})$/i)?.[1];
  const invalid = () => new Response(JSON.stringify({ error: "Invalid or expired read-only credential." }), { status: 401, headers: { "Content-Type": "application/json", "WWW-Authenticate": 'Bearer realm="monitor-analytics"' } });
  if (!bearer) throw invalid();
  const entry = (await agentSettings(env)).value.tokens.find((item) => item.id === bearer.split(".")[0]);
  if (!entry || entry.expires_at <= nowSeconds()) throw invalid();
  const encoder = new TextEncoder();
  if (!timingSafeEqual(encoder.encode(entry.hash), encoder.encode(await digest(bearer)))) throw invalid();
}
