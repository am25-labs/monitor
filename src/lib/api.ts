import type {
  SafeNotificationConfig,
  GeneralSettings,
  Language
} from "../shared/settings";
import { translate } from "../shared/i18n";
import { defaultTimeZone, formatDate } from "../shared/time";
import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { RefreshContext } from "./refresh-context";
import type {
  Group,
  Incident,
  Project,
  SafeMonitor,
  Stat,
  StatusPage,
  Window
} from "../shared/types";

export interface Snapshot {
  projects: Project[];
  groups: Group[];
  monitors: SafeMonitor[];
  maintenance: Window[];
  pages: StatusPage[];
  incidents: Incident[];
  stats: Stat[];
  engine: {
    last_started: number | null;
    last_finished: number | null;
    last_error: string | null;
  };
  notifications: {
    id: string;
    channel: string | null;
    monitor_name: string;
    event: string;
    state: string;
    attempts: number;
    error: string | null;
  }[];
  backlog: { total: number; oldest: number | null };
  settings: {
    general: GeneralSettings;
    notifications: SafeNotificationConfig;
    environment: string;
  };
}
export async function api<T>(
  path: string,
  method = "GET",
  payload?: unknown,
  signal?: AbortSignal
): Promise<T> {
  const options: RequestInit = {
    method,
    credentials: "same-origin",
    cache: method === "GET" ? "no-store" : undefined,
    headers:
      payload === undefined ? {} : { "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    signal
  };
  let response: Response | undefined;
  const attempts = method === "GET" ? 2 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      signal?.throwIfAborted();
      response = await fetch(`/api/v1/${path}`, options);
      break;
    } catch (error) {
      if (signal?.aborted) throw error;
      if (attempt === attempts - 1)
        throw new Error("No se pudo conectar con Monitor. Revisa tu conexión e intenta actualizar nuevamente.");
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!response) throw new Error("Falló la consulta.");
  if (response.status === 401) {
    if (path.startsWith("admin")) location.assign("/app/");
    throw new Error("Tu sesión expiró. Vuelve a entrar.");
  }
  if (!response.headers.get("Content-Type")?.includes("application/json"))
    throw new Error(
      "No se pudo consultar el servicio. Revisa tu sesión o conexión."
    );
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof data.error === "string"
        ? data.error
        : "No fue posible completar la operación."
    );
  return data as T;
}
export function useRefresh<T>(path: string) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const group = useContext(RefreshContext);
  const active = useRef<{
    path: string;
    controller: AbortController;
    promise: Promise<void>;
  } | null>(null);
  const refresh = useCallback((force = false) => {
    if (!path) return Promise.resolve();
    if (!force && active.current?.path === path) return active.current.promise;
    active.current?.controller.abort();
    const controller = new AbortController();
    const request = { path, controller, promise: Promise.resolve() };
    active.current = request;
    setLoading(true);
    request.promise = (async () => {
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 20000);
      try {
        const result = await api<T>(path, "GET", undefined, controller.signal);
        if (active.current !== request || controller.signal.aborted) return;
        setData(result);
        setError("");
      } catch (e) {
        if (active.current !== request || (controller.signal.aborted && !timedOut)) return;
        setError(timedOut
          ? "La actualización tardó demasiado. Se volverá a intentar automáticamente."
          : e instanceof Error ? e.message : "Falló la consulta.");
      } finally {
        clearTimeout(timeout);
        if (active.current === request) {
          active.current = null;
          setLoading(false);
        }
      }
    })();
    return request.promise;
  }, [path]);
  useEffect(() => {
    if (path && group) return group.register(() => refresh(true));
  }, [path, group, refresh]);
  useEffect(() => {
    setData(null);
    setError("");
    setLoading(false);
    if (!path) return;
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    return () => {
      clearInterval(timer);
      active.current?.controller.abort();
      active.current = null;
    };
  }, [refresh]);
  return { data, error, refresh, loading };
}
export function date(
  value: number | null | undefined,
  language: Language = "es",
  timeZone: string = defaultTimeZone
) {
  return formatDate(value, language, timeZone);
}
export function availability(
  stats: Pick<Stat, "observed_seconds" | "up_seconds">[],
  language: Language = "es"
) {
  const total = stats.reduce((v, s) => v + s.observed_seconds, 0),
    up = stats.reduce((v, s) => v + s.up_seconds, 0);
  return total
    ? `${((100 * up) / total).toFixed(2)}%`
    : translate(language, "Sin datos");
}
