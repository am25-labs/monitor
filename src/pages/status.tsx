import { useState } from "react";
import { ChoiceSelect } from "../components/choice-select";
import { useParams } from "react-router-dom";
import { Moon, Sun, RefreshCw } from "lucide-react";
import { availability, date, useRefresh } from "../lib/api";
import type { Status } from "../shared/types";
import { Notice, Nothing, Panel, StatusBadge } from "../components/common";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";

interface PublicData {
  title: string;
  description: string;
  updatedAt: number;
  monitors: {
    id: string;
    name: string;
    status: Status;
    lastChecked: number | null;
    stats: { day: string; observed_seconds: number; up_seconds: number }[];
    hourly: { hour: string; observed_seconds: number; up_seconds: number }[];
    incidents: {
      opened_at: number;
      closed_at: number | null;
      message: string;
    }[];
  }[];
}
type DailyStat = PublicData["monitors"][number]["stats"][number];

type HistoryRange = "90d" | "7d" | "24h";
const periods = { "90d": "90 días", "7d": "7 días", "24h": "24 horas" };

function History({
  stats,
  hourly,
  range,
  updatedAt
}: {
  stats: DailyStat[];
  hourly: PublicData["monitors"][number]["hourly"];
  range: HistoryRange;
  updatedAt: number;
}) {
  const hours = range === "24h";
  const count = hours ? 24 : range === "7d" ? 7 : 90;
  const stride = hours ? 3600000 : 86400000;
  const last = Math.floor((updatedAt * 1000) / stride) * stride;
  const byDay = new Map(
    (hours ? hourly.map((stat) => ({ ...stat, day: stat.hour })) : stats).map(
      (stat) => [stat.day, stat]
    )
  );
  const days = Array.from({ length: count }, (_, index) => {
    const day = new Date(last - (count - 1 - index) * stride)
      .toISOString()
      .slice(0, hours ? 13 : 10);
    const stat = byDay.get(day);
    const state = !stat?.observed_seconds
      ? "none"
      : stat.up_seconds === stat.observed_seconds
        ? "up"
        : stat.up_seconds === 0
          ? "down"
          : "partial";
    return { day, stat, state };
  });
  const observed = days.flatMap(({ stat }) =>
    stat?.observed_seconds ? [stat] : []
  );
  const labels: Record<string, string> = {
    none: "Sin registros",
    up: "Sin interrupciones registradas",
    down: "Interrupción durante todo el tiempo observado",
    partial: "Hubo interrupciones"
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>
          Historial {hours ? "por hora" : "diario"} · últimos {periods[range]}
        </p>
        <p className="text-muted-foreground">
          Disponibilidad observada: {availability(observed)}
        </p>
      </div>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}
        role="list"
        aria-label={`Historial ${hours ? "por hora" : "diario"}, de más antiguo a más reciente`}
      >
        {days.map(({ day, stat, state }) => {
          const label = `${day.replace("T", " ")}${hours ? ":00" : ""} (UTC): ${labels[state]}${stat?.observed_seconds ? ` · ${availability([stat])}` : ""}`;
          return (
            <span
              key={day}
              role="listitem"
              aria-label={label}
              title={label}
              className={cn(
                "h-6 rounded-sm",
                state === "none" && "bg-muted",
                state === "up" && "bg-success",
                state === "down" && "bg-destructive",
                state === "partial" && "bg-warning"
              )}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>
          Hace {count - 1} {hours ? "horas" : "días"}
        </span>
        <span>{hours ? "Hora actual" : "Día más reciente"}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {[
          ["bg-success", "Sin interrupciones"],
          ["bg-warning", "Con interrupciones"],
          ["bg-destructive", "Sin disponibilidad"],
          ["bg-muted", "Sin registros"]
        ].map(([color, label]) => (
          <span key={label} className="flex items-center gap-1.5">
            <span
              className={cn("size-2 rounded-sm", color)}
              aria-hidden="true"
            />
            {label}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {observed.length} de {count} {hours ? "horas" : "días"} con registros.
        Cada segmento representa {hours ? "una hora" : "un día"} UTC; el
        segmento actual está en curso y el historial puede incluir incidentes ya
        resueltos.
      </p>
    </div>
  );
}
export function PublicStatus({
  theme,
  toggleTheme
}: {
  theme: string;
  toggleTheme: () => void;
}) {
  const { slug } = useParams(),
    { data, error, refresh } = useRefresh<PublicData>(`public/${slug}`);
  const [range, setRange] = useState<HistoryRange>("7d");
  const overall: Status = data?.monitors.some((m) => m.status === "down")
    ? "down"
    : data?.monitors.some(
          (m) => m.status === "unknown" || m.status === "pending"
        )
      ? "unknown"
      : data?.monitors.some((m) => m.status === "maintenance")
        ? "maintenance"
        : data?.monitors.length && data.monitors.every((m) => m.status === "up")
          ? "up"
          : "pending";
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6 md:py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            Estado de los servicios
          </p>
          <h1 className="text-3xl font-semibold">
            {data?.title ?? "Estado del proyecto"}
          </h1>
          <p className="mt-2 text-muted-foreground">{data?.description}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label="Actualizar"
            onClick={() => void refresh()}
          >
            <RefreshCw />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Cambiar tema"
            onClick={toggleTheme}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </div>
      </header>
      <Notice message={error} destructive />
      {!data && !error && <Skeleton className="h-60 w-full" />}
      {data && (
        <>
          {data.monitors.length > 0 && (
            <Panel
              title="Estado general"
              description={`Última actualización: ${date(data.updatedAt)}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <StatusBadge status={overall} />
                <ChoiceSelect
                  aria-label="Período del historial"
                  className="w-full sm:w-48"
                  value={range}
                  onValueChange={(value) => setRange(value as HistoryRange)}
                  options={[
                    { value: "90d", label: "Últimos 90 días" },
                    { value: "7d", label: "Últimos 7 días" },
                    { value: "24h", label: "Últimas 24 horas" }
                  ]}
                />
              </div>
            </Panel>
          )}
          {data.monitors.length ? (
            data.monitors.map((m) => {
              const incidents = m.incidents.filter(
                (incident) =>
                  incident.closed_at === null ||
                  incident.closed_at >= data.updatedAt - 86400
              );
              return (
                <Panel key={m.id} title={m.name}>
                  <div className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        Estado actual
                      </span>
                      <StatusBadge status={m.status} />
                    </div>
                    <History
                      stats={m.stats}
                      hourly={m.hourly ?? []}
                      range={range}
                      updatedAt={data.updatedAt}
                    />
                    <p className="text-xs text-muted-foreground">
                      Última comprobación: {date(m.lastChecked)}
                    </p>
                    {incidents.length > 0 && (
                      <div className="flex flex-col gap-3 border-t pt-3">
                        <p className="text-sm font-medium">
                          Incidentes recientes
                        </p>
                        {incidents.map((i) => (
                          <div key={i.opened_at} className="text-sm">
                            <p>{i.message}</p>
                            <p className="text-muted-foreground">
                              {date(i.opened_at)}
                              {i.closed_at
                                ? ` → ${date(i.closed_at)}`
                                : " · En curso"}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </Panel>
              );
            })
          ) : (
            <Nothing
              title="Sin servicios publicados"
              description="No hay servicios disponibles para mostrar en esta página."
            />
          )}
        </>
      )}
      <footer className="mt-auto flex flex-col gap-2 border-t pt-6 text-center text-xs text-muted-foreground">
        <p>AM25 Monitor · Estado público de los servicios</p>
        <p>
          Actualización automática cada 30 segundos · Fechas en tu hora local
        </p>
        <p>
          La disponibilidad corresponde al tiempo observado durante los últimos
          {periods[range]}. Excluye pausas, mantenimiento y períodos sin datos.
        </p>
      </footer>
    </main>
  );
}
