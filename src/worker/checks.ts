import { connect } from "cloudflare:sockets";
import type {
  CheckConfig,
  CheckResult,
  HttpConfig,
  TcpConfig
} from "../shared/types";

export const reasons: Record<string, string> = {
  ok: "Comprobación exitosa",
  http_status: "Código HTTP inesperado",
  text_mismatch: "El contenido esperado no está presente",
  json_mismatch: "El valor JSON no coincide",
  invalid_json: "La respuesta no es JSON válido",
  body_limit: "La respuesta supera el límite permitido",
  timeout: "El servicio no respondió a tiempo",
  connection: "No fue posible conectar",
  heartbeat_missing: "No se recibió el heartbeat esperado",
  heartbeat_failed: "El servicio reportó un fallo"
};
export function matchesCode(code: number, expected: string) {
  return expected.split(",").some((item) => {
    const [start, end] = item.trim().split("-").map(Number);
    return code >= start && code <= (end ?? start);
  });
}
export function jsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  return pointer
    .slice(1)
    .split("/")
    .reduce<unknown>((node, part) => {
      const field = part.replace(/~1/g, "/").replace(/~0/g, "~");
      return typeof node === "object" &&
        node !== null &&
        Object.hasOwn(node, field)
        ? (node as Record<string, unknown>)[field]
        : undefined;
    }, value);
}
export function equalJson(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (
    !a ||
    !b ||
    typeof a !== "object" ||
    typeof b !== "object" ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return false;
  const x = a as Record<string, unknown>,
    y = b as Record<string, unknown>;
  return (
    Object.keys(x).length === Object.keys(y).length &&
    Object.keys(x).every((k) => Object.hasOwn(y, k) && equalJson(x[k], y[k]))
  );
}
export async function readBounded(response: Response, limit = 262144) {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) throw new Error("body_limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(output);
}
export async function httpCheck(
  config: HttpConfig,
  fetcher: typeof fetch = fetch
): Promise<CheckResult> {
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    config.timeoutSeconds * 1000
  );
  let code: number | null = null;
  const result = (reason: string): CheckResult => ({
    ok: reason === "ok",
    latency: Math.round(performance.now() - started),
    code,
    reason,
    diagnostic: reasons[reason]
  });
  try {
    const response = await fetcher(config.url, {
      method: config.method,
      headers: config.headers,
      redirect: config.followRedirects ? "follow" : "manual",
      signal: controller.signal,
      cache: "no-store"
    });
    code = response.status;
    if (!matchesCode(code, config.codes)) {
      await response.body?.cancel();
      return result("http_status");
    }
    if (config.assertion === "none") {
      await response.body?.cancel();
      return result("ok");
    }
    const body = await readBounded(response);
    if (config.assertion === "text")
      return result(body.includes(config.text!) ? "ok" : "text_mismatch");
    let value: unknown;
    try {
      value = JSON.parse(body);
    } catch {
      return result("invalid_json");
    }
    return result(
      equalJson(jsonPointer(value, config.pointer!), config.expected)
        ? "ok"
        : "json_mismatch"
    );
  } catch (error) {
    return result(
      controller.signal.aborted
        ? "timeout"
        : error instanceof Error && error.message === "body_limit"
          ? "body_limit"
          : "connection"
    );
  } finally {
    clearTimeout(timer);
  }
}
export async function tcpCheck(
  config: TcpConfig,
  connector: typeof connect = connect
): Promise<CheckResult> {
  const started = performance.now();
  let socket: ReturnType<typeof connect> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    socket = connector({ hostname: config.host, port: config.port });
    await Promise.race([
      socket.opened,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("timeout")),
          config.timeoutSeconds * 1000
        );
      })
    ]);
    return {
      ok: true,
      latency: Math.round(performance.now() - started),
      code: null,
      reason: "ok",
      diagnostic: reasons.ok
    };
  } catch (error) {
    const reason =
      error instanceof Error && error.message === "timeout"
        ? "timeout"
        : "connection";
    return {
      ok: false,
      latency: Math.round(performance.now() - started),
      code: null,
      reason,
      diagnostic: reasons[reason]
    };
  } finally {
    clearTimeout(timer);
    await socket?.close().catch(() => undefined);
  }
}
export async function check(kind: "http" | "tcp", config: CheckConfig) {
  return kind === "http"
    ? httpCheck(config as HttpConfig)
    : tcpCheck(config as TcpConfig);
}
