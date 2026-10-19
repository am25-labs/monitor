import { useState, type FormEvent } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Download, X } from "lucide-react";
import { api, type Snapshot } from "../lib/api";
import { useLocale } from "../lib/locale";
import { retention } from "../shared/analytics";
import { metricDays, metricTotals, type MetricsData } from "../shared/metrics";
import { MetricFilterFields, metricParams, type MetricFilters } from "./metric-filters";
import { Notice } from "./common";
import { Button } from "./ui/button";

export function MetricExportDialog({ data, initial }: { data: Snapshot; initial: MetricFilters }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [filters, setFilters] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function changeOpen(value: boolean) {
    if (busy) return;
    if (value) { setFilters({ ...initial }); setError(""); }
    setOpen(value);
  }
  async function download(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const metrics = await api<MetricsData>(`admin/metrics?${metricParams(filters)}`);
      const selected = data.monitors.filter((item) => (!filters.project || item.project_id === filters.project) && (!filters.group || item.group_id === filters.group) && (!filters.monitor || item.id === filters.monitor));
      const payload = { schemaVersion: 1, retention, exportedAt: new Date().toISOString(), timezone: "UTC", filters: { project: filters.project || null, group: filters.group || null, monitor: filters.monitor || null }, units: { duration: "seconds", latency: "milliseconds", availability: "percent" }, limitations: ["Availability is based on observed time across selected monitors. Missing data is not uptime. Maintenance is excluded from observed availability. Latency uses successful measured checks. Telemetry cannot prove root cause."], ...metrics, monitors: selected.map(({ id, name, project_id, group_id, kind }) => ({ id, name, project_id, group_id, kind })), totals: metricTotals(metrics.stats), daily: metricDays(metrics.stats, metrics.start, metrics.end) };
      const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `monitor-metrics-${metrics.start}-${metrics.end}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setOpen(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("No se pudo exportar la información.")); }
    finally { setBusy(false); }
  }
  return <Dialog.Root open={open} onOpenChange={changeOpen}>
    <Dialog.Trigger render={<Button variant="outline" />}><Download data-icon="inline-start" />{t("Exportar métricas JSON")}</Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Backdrop className="monitor-export-backdrop" />
      <Dialog.Popup className="monitor-export-popup">
        <Dialog.Close render={<Button variant="ghost" size="icon-sm" disabled={busy} />} className="absolute right-5 top-5" aria-label={t("Cerrar")}><X /></Dialog.Close>
        <form onSubmit={(event) => void download(event)} className="flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-col gap-2 pr-8">
            <Dialog.Title className="text-lg font-medium">{t("Exportar métricas JSON")}</Dialog.Title>
            <Dialog.Description className="text-sm text-muted-foreground">{t("Selecciona el período, proyecto, grupo y monitor para la exportación. Estos filtros no cambian las métricas de la página.")}</Dialog.Description>
          </div>
          <MetricFilterFields data={data} value={filters} onChange={setFilters} prefix="export-metrics" disabled={busy} className="grid gap-4 sm:grid-cols-2" />
          <p className="text-xs text-muted-foreground">{t("Hasta 366 días por consulta. La exportación incluye únicamente el período y los filtros seleccionados.")}</p>
          <Notice message={error} destructive />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Dialog.Close render={<Button variant="outline" disabled={busy} />}>{t("Cancelar")}</Dialog.Close>
            <Button type="submit" disabled={busy}>{busy ? t("Procesando…") : t("Descargar JSON")}</Button>
          </div>
        </form>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
