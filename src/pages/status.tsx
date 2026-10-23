import { HistoryStrip } from "../components/monitor-timeline";
import { historySegments } from "../shared/history";
import { overallStatus, type PublicIncidentView } from "../shared/incidents";
import { IncidentCard } from "../components/incident-card";
import { IncidentArchive } from "../components/incident-archive";
import { useLocale, LocaleProvider } from "../lib/locale";
import { useState } from "react";
import type { Language } from "../shared/settings";
import { ChoiceSelect } from "../components/choice-select";
import { useParams } from "react-router-dom";
import { Moon, Sun, RefreshCw } from "lucide-react";
import { useRefresh } from "../lib/api";
import { Spinner } from "../components/ui/spinner";
import type { MonitorHistory, Status } from "../shared/types";
import { Notice, Nothing, Panel, StatusBadge } from "../components/common";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";

interface PublicData {
  incidents: PublicIncidentView[];
  language: Language;
  timeZone: string;
  title: string;
  description: string;
  updatedAt: number;
  groups?: { id: string; name: string }[];
  monitors: {
    id: string;
    name: string;
    groupId: string | null;
    status: Status;
    lastChecked: number | null;
    maintenance?: MonitorHistory["maintenance"];
    stats: { day: string; observed_seconds: number; up_seconds: number; degraded_count?: number }[];
    short: { slot: string; observed_seconds: number; up_seconds: number; degraded_count?: number }[];
    hourly: { hour: string; observed_seconds: number; up_seconds: number; degraded_count?: number }[];
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
  short,
  maintenance,
  range,
  updatedAt
}: {
  stats: DailyStat[];
  hourly: PublicData["monitors"][number]["hourly"];
  short: PublicData["monitors"][number]["short"];
  maintenance?: MonitorHistory["maintenance"];
  range: HistoryRange;
  updatedAt: number;
}) {
  const { t, availability } = useLocale();
  const granular = range !== "90d";
  const history = { stats, hourly, short, updatedAt, maintenance };
  const days = historySegments(history, range);
  const observed = days.flatMap(({ stat }) => stat?.observed_seconds ? [stat] : []);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p>
          {t("Historial")}{" "}
          {range === "24h"
            ? t("cada 5 minutos")
            : range === "7d"
              ? t("por hora")
              : t("diario")}{" "}
          {t("· últimos")} {t(periods[range])}
        </p>
        <p className="text-muted-foreground">
          {t("Disponibilidad observada:")} {availability(observed)}
        </p>
      </div>
      <div className="flex flex-col gap-1">
        <HistoryStrip {...history} range={range} />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{t("Inicio del período")}</span>
          <span>{granular ? t("Ahora") : t("Día más reciente")}</span>
        </div>
      </div>
    </div>
  );
}
export function PublicMonitors({ monitors, groups = [], range, updatedAt }: {
  monitors: PublicData["monitors"];
  groups?: PublicData["groups"];
  range: HistoryRange;
  updatedAt: number;
}) {
  const { t } = useLocale();
  const renderMonitor = (m: PublicData["monitors"][number]) => (
    <Panel key={m.id} title={m.name}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {t("Estado actual")}
          </span>
          <StatusBadge status={m.status} />
        </div>
        <History
          stats={m.stats}
          hourly={m.hourly ?? []}
          short={m.short ?? []}
          maintenance={m.maintenance}
          range={range}
          updatedAt={updatedAt}
        />
      </div>
    </Panel>
  );
  if (!groups.length) return <>{monitors.map(renderMonitor)}</>;
  return <>{groups.map((group) => {
    const selected = monitors.filter((monitor) => monitor.groupId === group.id);
    if (!selected.length) return null;
    return <section key={group.id} className="flex flex-col gap-4" aria-labelledby={`monitor-group-${group.id}`}>
      <h2 id={`monitor-group-${group.id}`} className="text-lg font-semibold">{group.name}</h2>
      <div className="flex flex-col gap-6">{selected.map(renderMonitor)}</div>
    </section>;
  })}</>;
}

function HistoryGuide({ monitors, range, updatedAt }: {
  monitors: PublicData["monitors"];
  range: HistoryRange;
  updatedAt: number;
}) {
  const { t } = useLocale();
  const segments = monitors.flatMap((monitor) => historySegments({
    stats: monitor.stats, hourly: monitor.hourly ?? [], short: monitor.short ?? [], maintenance: monitor.maintenance, updatedAt
  }, range));
  const count = segments.length;
  const observed = segments.filter(({ stat }) => stat?.observed_seconds);
  return (
    <div className="mt-4 flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
        {[
          ["bg-success", range === "24h" ? t("Sin interrupciones") : t("Operativo")],
          ["bg-warning", t("Con degradación")],
          ["bg-destructive", t("Con interrupciones")],
          ["bg-maintenance", t("Mantenimiento")],
          ["bg-muted", t("Sin registros")]
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
        {t(
          "Entre todos los monitores: {observed} de {count} segmentos con registros. Cada segmento representa {duration}.",
          {
            observed: observed.length,
            count,
            duration: t(
              range === "24h"
                ? "5 minutos"
                : range === "7d"
                  ? "una hora"
                  : "un día UTC"
            )
          }
        )}
        {t(" Los segmentos más antiguos están a la izquierda y los más recientes, a la derecha.")}
        {range === "24h"
          ? t(
              " Rojo indica interrupciones; amarillo, degradación por latencia; azul, mantenimiento; verde, sin afectación; gris, sin registros."
            )
          : t(" Disponibilidad observada por segmento: verde, al menos 99.9%; amarillo, desde 95% hasta menos de 99.9% o degradación por latencia; rojo, menos de 95%; azul, mantenimiento; gris, sin registros. Las interrupciones breves se conservan en el detalle aunque el segmento sea verde.")}
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
  const { slug } = useParams();
  const snapshot = useRefresh<PublicData>(`public/${slug}`);
  return (
    <LocaleProvider language={snapshot.data?.language ?? "es"} timeZone={snapshot.data?.timeZone}>
      <StatusView theme={theme} toggleTheme={toggleTheme} {...snapshot} />
    </LocaleProvider>
  );
}
function StatusView({
  data,
  error,
  refresh,
  loading,
  theme,
  toggleTheme
}: {
  theme: string;
  toggleTheme: () => void;
  data: PublicData | null;
  error: string;
  refresh: (force?: boolean) => Promise<void>;
  loading: boolean;
}) {
  const { t, date, availability, timeZoneLabel } = useLocale();
  const [range, setRange] = useState<HistoryRange>("7d");
  const { slug = "" } = useParams();
  const overall = overallStatus(data?.monitors.map(m => m.status) ?? []);
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6 md:py-12">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            {t("Estado de los servicios")}
          </p>
          <h1 className="text-3xl font-semibold">
            {data?.title ?? t("Estado del proyecto")}
          </h1>
          <p className="mt-2 text-muted-foreground">{data?.description}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={t(loading ? "Actualizando…" : "Actualizar")}
            aria-busy={loading}
            disabled={loading}
            onClick={() => void refresh(true)}
          >
            {loading ? <Spinner aria-label={t("Actualizando…")} /> : <RefreshCw />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t("Cambiar tema")}
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
              title={t("Estado general")}
              description={t("Última actualización: {date}", {
                date: date(data.updatedAt)
              })}
            >
              <div className="flex flex-wrap items-center justify-between gap-4">
                <StatusBadge status={overall} />
                <ChoiceSelect
                  aria-label={t("Período del historial")}
                  className="w-full sm:w-48"
                  value={range}
                  onValueChange={(value) => setRange(value as HistoryRange)}
                  options={[
                    { value: "90d", label: t("Últimos 90 días") },
                    { value: "7d", label: t("Últimos 7 días") },
                    { value: "24h", label: t("Últimas 24 horas") }
                  ]}
                />
              </div>
              <HistoryGuide monitors={data.monitors} range={range} updatedAt={data.updatedAt} />
            </Panel>
          )}
          {data.incidents.some(i => i.closed_at === null) && <section className="flex flex-col gap-4" aria-labelledby="active-incidents">
            <h2 id="active-incidents" className="text-lg font-semibold">{t("Incidentes activos")}</h2>
            {data.incidents.filter(i => i.closed_at === null).map(i => <IncidentCard key={i.id} incident={i} />)}
          </section>}
          {data.monitors.length ? (
            <PublicMonitors monitors={data.monitors} groups={data.groups} range={range} updatedAt={data.updatedAt} />
          ) : (
            <Nothing
              title={t("Sin servicios publicados")}
              description={t(
                "No hay servicios disponibles para mostrar en esta página."
              )}
            />
          )}
        </>
      )}
      {data && <section className="flex flex-col gap-4" aria-labelledby="resolved-incidents">
        <h2 id="resolved-incidents" className="text-lg font-semibold">{t("Incidentes resueltos · últimas 24 horas")}</h2>
        {data.incidents.filter(i => i.closed_at !== null).map(i => <IncidentCard key={i.id} incident={i} />)}
        {!data.incidents.some(i => i.closed_at !== null) && <p className="text-sm text-muted-foreground">{t("No hay incidentes resueltos en las últimas 24 horas.")}</p>}
        <IncidentArchive key={slug} slug={slug} />
      </section>}
      <footer className="mt-auto flex flex-col gap-2 border-t pt-6 text-center text-xs text-muted-foreground">
        <p>{t("Monitor by AM25 · Estado público de los servicios")}</p>
        <p>
          {t(
            "Actualización automática cada 30 segundos · Zona horaria: {zone}", { zone: timeZoneLabel }
          )}
        </p>
        <p>
          {t(
            "La disponibilidad corresponde al tiempo observado durante los últimos {period}. Excluye pausas, mantenimiento y períodos sin datos.",
            { period: t(periods[range]) }
          )}
        </p>
      </footer>
    </main>
  );
}
