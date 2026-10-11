import { createRemoteJWKSet, jwtVerify } from "jose";
import { digest } from "./crypto";

export async function authorize(request: Request, env: Env) {
  const u = new URL(request.url);
  if (
    env.ENVIRONMENT === "local" &&
    ["localhost", "127.0.0.1"].includes(u.hostname)
  )
    return;
  const assertion =
    request.headers.get("Cf-Access-Jwt-Assertion") ??
    request.headers
      .get("Cookie")
      ?.match(/(?:^|;\s*)CF_Authorization=([^;]+)/)?.[1];
  const audiences = env.ACCESS_AUDIENCES.split(",").filter(Boolean);
  if (!assertion || !audiences.length || u.origin !== env.APP_ORIGIN)
    throw new Response("Acceso no autorizado", { status: 401 });
  try {
    const jwks = createRemoteJWKSet(
      new URL("/cdn-cgi/access/certs", env.ACCESS_TEAM_DOMAIN)
    );
    const { payload } = await jwtVerify(assertion, jwks, {
      issuer: env.ACCESS_TEAM_DOMAIN,
      audience: audiences,
      algorithms: ["RS256"]
    });
    if (
      typeof payload.exp !== "number" ||
      !payload.sub ||
      typeof payload.email !== "string" ||
      payload.email.toLowerCase() !== env.ACCESS_EMAIL.toLowerCase()
    )
      throw new Error("Identity denied");
  } catch {
    throw new Response("Acceso no autorizado", { status: 401 });
  }
}
export function requireOrigin(request: Request, env: Env) {
  if (
    env.ENVIRONMENT === "local" &&
    ["localhost", "127.0.0.1"].includes(new URL(request.url).hostname)
  )
    return;
  if (request.headers.get("Origin") !== env.APP_ORIGIN)
    throw new Response("Origen no autorizado", { status: 403 });
}
export async function verifyHeartbeat(request: Request, hash: string | null) {
  const bearer = request.headers
    .get("Authorization")
    ?.match(/^Bearer ([a-f\d]{64})$/i)?.[1];
  return Boolean(hash && bearer && (await digest(bearer)) === hash);
}
