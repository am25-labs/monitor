import { useState } from "react";
import { useRefresh } from "../lib/api";
import { useLocale } from "../lib/locale";
import { utcDay } from "../shared/time";
import { cn } from "../lib/utils";
import { historySegments, type HistoryRange } from "../shared/history";
import type { MonitorHistory, SafeMonitor } from "../shared/types";
import { ChoiceSelect } from "./choice-select";
import { Notice, Panel } from "./common";
import { Skeleton } from "./ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";

export function HistoryStrip({ range, compact = false, ...history }: MonitorHistory & { range: HistoryRange; compact?: boolean }) {
  const { t, date, availability, language } = useLocale();
  const segments = historySegments(history, range);
  const labels: Record<string, string> = {
    none: t("Sin registros"),
    up: range === "7d" || range === "90d" ? t("Operativo") : t("Sin interrupciones"),
    down: t("Con interrupciones"),
    degraded: t("Con degradación"),
    maintenance: t("Mantenimiento")
  };
  return (
    <div className="overflow-x-auto">
      <div
        className={cn("grid", compact || range === "90d" ? "gap-0.5" : "gap-px")}
        style={{ gridTemplateColumns: `repeat(${segments.length}, ${compact ? "4px" : "minmax(0, 1fr)"})`, minWidth: compact || range === "90d" ? undefined : segments.length * 2 }}
        role="list"
        aria-label={t("Historial, de más antiguo a más reciente")}
      >
        {segments.map(({ start, stat, state, coverage, partial, maintenance }) => {
          const time = range === "90d" ? utcDay(new Date(start * 1000).toISOString().slice(0, 10), language) : date(start);
          const label = `${time}: ${labels[state]}${stat?.observed_seconds ? ` · ${availability([stat])} · ${t("{outage} s de interrupción / {observed} s observados", { outage: Math.round(stat.observed_seconds - stat.up_seconds), observed: Math.round(stat.observed_seconds) })}` : ""}${maintenance ? ` · ${t("{seconds} s de mantenimiento", { seconds: Math.round(maintenance) })}` : ""}${partial ? ` · ${t("Cobertura parcial: {coverage}%", { coverage: coverage.toFixed(1) })}` : ""}`;
          return (
            <Tooltip key={start}>
              <TooltipTrigger
                render={<span />}
                role="listitem"
                tabIndex={0}
                aria-label={label}
                className={cn(
                  "rounded-[1px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  compact ? "h-4" : "h-6",
                  state === "none" && "bg-muted",
                  state === "up" && "bg-success",
                  state === "down" && "bg-destructive",
                  state === "degraded" && "bg-warning",
                  state === "maintenance" && "bg-maintenance"
                )}
              />
              <TooltipContent>{label}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

export function MonitorTimeline({ monitor }: { monitor: SafeMonitor }) {
  const { t, availability } = useLocale();
  const [range, setRange] = useState<Exclude<HistoryRange, "1h">>("24h");
  const { data, error } = useRefresh<MonitorHistory>(`admin/monitors/${monitor.id}/history`);
  const observed = data ? historySegments(data, range).flatMap(({ stat }) => stat?.observed_seconds ? [stat] : []) : [];
  return (
    <Panel title={t("Historial de disponibilidad")}>
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">{t("Disponibilidad observada:")} {availability(observed)}</p>
          <ChoiceSelect className="w-full sm:w-48" aria-label={t("Historial de disponibilidad")} value={range} onValueChange={(value) => setRange(value as Exclude<HistoryRange, "1h">)} options={[
            { value: "24h", label: t("Últimas 24 horas") },
            { value: "7d", label: t("Últimos 7 días") },
            { value: "90d", label: t("Últimos 90 días") }
          ]} />
        </div>
        <Notice message={error} destructive />
        {data ? <HistoryStrip {...data} range={range} /> : <Skeleton className="h-6 w-full" />}
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{t("Inicio del período")}</span><span>{range === "90d" ? t("Día más reciente") : t("Ahora")}</span>
        </div>
      </div>
    </Panel>
  );
}
