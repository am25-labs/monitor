import { useParams } from "react-router-dom";
import { Moon, Sun } from "lucide-react";
import { availability, date, useRefresh } from "../lib/api";
import type { Status } from "../shared/types";
import { Notice, Nothing, Panel, StatusBadge } from "../components/common";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";

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
    incidents: {
      opened_at: number;
      closed_at: number | null;
      message: string;
    }[];
  }[];
}
export function PublicStatus({
  theme,
  toggleTheme
}: {
  theme: string;
  toggleTheme: () => void;
}) {
  const { slug } = useParams(),
    { data, error } = useRefresh<PublicData>(`public/${slug}`);
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
        <Button
          variant="outline"
          size="icon"
          className="shrink-0"
          aria-label="Cambiar tema"
          onClick={toggleTheme}
        >
          {theme === "dark" ? <Sun /> : <Moon />}
        </Button>
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
              <StatusBadge status={overall} />
            </Panel>
          )}
          {data.monitors.length ? (
            data.monitors.map((m) => (
              <Panel key={m.id} title={m.name}>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <StatusBadge status={m.status} />
                    <p className="text-sm text-muted-foreground">
                      Disponibilidad · 90 días: {availability(m.stats)}
                    </p>
                  </div>
                  <div
                    className="flex gap-1"
                    aria-label="Disponibilidad diaria de los últimos 90 días"
                  >
                    {m.stats.map((s) => (
                      <span
                        key={s.day}
                        title={`${s.day}: ${availability([s])}`}
                        className={`h-6 flex-1 rounded-sm ${!s.observed_seconds ? "bg-muted" : s.up_seconds === s.observed_seconds ? "bg-success" : s.up_seconds === 0 ? "bg-destructive" : "bg-warning"}`}
                      />
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Última comprobación: {date(m.lastChecked)}
                  </p>
                  {m.incidents.map((i) => (
                    <div key={i.opened_at} className="border-t pt-3 text-sm">
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
              </Panel>
            ))
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
          90 días. Excluye pausas, mantenimiento y períodos sin datos.
        </p>
      </footer>
    </main>
  );
}
