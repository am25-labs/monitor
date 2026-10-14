import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useRefresh, type Snapshot } from "../lib/api";
import { useLocale } from "../lib/locale";
import { locales } from "../shared/i18n";
import { metricDays, metricTotals, type MetricsData } from "../shared/metrics";
import { ChoiceSelect } from "./choice-select";
import { FormField, Notice, Nothing, Panel } from "./common";
import { MetricCharts } from "./metric-charts";
import { buttonVariants } from "./ui/button";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "./ui/chart";
import { FieldGroup } from "./ui/field";
import { Skeleton } from "./ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export function Metrics({ data }: { data: Snapshot }) {
  const { t, language } = useLocale();
  const [period, setPeriod] = useState("30");
  const [project, setProject] = useState("");
  const [monitor, setMonitor] = useState("");
  const params = new URLSearchParams({ days: period });
  if (project) params.set("project", project);
  if (monitor) params.set("monitor", monitor);
  const metrics = useRefresh<MetricsData>(`admin/metrics?${params}`);
  const number = (value: number, digits = 0) => value.toLocaleString(locales[language], { maximumFractionDigits: digits });
  const value = (amount: number | null, unit: string) => amount === null ? t("Sin datos") : `${number(amount, 2)}${unit}`;
  const dayLabel = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(locales[language], { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
  const monitors = data.monitors.filter((item) => !project || item.project_id === project);
  const selected = monitors.filter((item) => !monitor || item.id === monitor);
  const total = metricTotals(metrics.data?.stats ?? []);
  const days = metrics.data ? metricDays(metrics.data.stats, metrics.data.start, metrics.data.end) : [];
  const rows = selected.map((item) => ({ monitor: item, ...metricTotals(metrics.data?.stats.filter((stat) => stat.monitor_id === item.id) ?? []), incidents: metrics.data?.incidents.find((incident) => incident.monitor_id === item.id)?.overlapping ?? 0 })).sort((a, b) => b.outage - a.outage || a.monitor.name.localeCompare(b.monitor.name));
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Link to="/app/" className={buttonVariants({ variant: "outline", className: "self-start" })}>{t("Volver al resumen")}</Link>
      <Panel title={t("Explorar métricas")} description={t("Filtra los agregados diarios por período, proyecto y monitor. Todos los días se agrupan en UTC; el día actual está en curso.")}>
        <FieldGroup className="grid gap-4 sm:grid-cols-3">
          <FormField id="metrics-period" label={t("Período")}>
            <ChoiceSelect id="metrics-period" value={period} onValueChange={setPeriod} options={[{ value: "7", label: t("Últimos 7 días") }, { value: "30", label: t("Últimos 30 días") }, { value: "90", label: t("Últimos 90 días") }]} />
          </FormField>
          <FormField id="metrics-project" label={t("Proyecto")}>
            <ChoiceSelect id="metrics-project" value={project} onValueChange={(id) => { setProject(id); setMonitor(""); }} options={[{ value: "", label: t("Todos los proyectos") }, ...data.projects.map((item) => ({ value: item.id, label: item.name }))]} />
          </FormField>
          <FormField id="metrics-monitor" label={t("Monitor")}>
            <ChoiceSelect id="metrics-monitor" value={monitor} onValueChange={setMonitor} options={[{ value: "", label: t("Todos los monitores") }, ...monitors.map((item) => ({ value: item.id, label: item.name }))]} />
          </FormField>
        </FieldGroup>
      </Panel>
      <Notice message={metrics.error} destructive />
      {!metrics.data && !metrics.error && <Skeleton className="h-64 w-full" />}
      {metrics.data && <>
        <p className="text-sm text-muted-foreground">{t("Del {start} al {end} (UTC)", { start: dayLabel(metrics.data.start), end: dayLabel(metrics.data.end) })}</p>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            [t("Disponibilidad observada"), value(total.availability, "%")],
            [t("Latencia media"), value(total.latency, " ms")],
            [t("Interrupción observada"), total.observed ? `${number(total.outage / 60, 1)} min` : t("Sin datos")],
            [t("Incidentes iniciados"), number(metrics.data.incidents.reduce((sum, incident) => sum + incident.opened, 0))]
          ].map(([title, amount]) => <Panel key={title} title={title}><p className="text-2xl font-semibold tabular-nums">{amount}</p></Panel>)}
        </div>
        <p className="text-xs text-muted-foreground">{t("La disponibilidad y las interrupciones suman el tiempo observado de los monitores. No equivalen a la disponibilidad de un único servicio. La latencia usa solo comprobaciones exitosas con medición.")}</p>
        <MetricCharts stats={metrics.data.stats} start={metrics.data.start} end={metrics.data.end} />
        <Panel title={t("Evolución de incidentes")} description={t("Incidentes técnicos iniciados y resueltos cada día. No se duplican con sus publicaciones públicas.")}>
          <ChartContainer config={{ opened: { label: t("Iniciados"), color: "var(--destructive)" }, closed: { label: t("Resueltos"), color: "var(--success)" } }} className="h-64 w-full" aria-label={t("Evolución de incidentes")}>
            <BarChart accessibilityLayer data={metrics.data.incidentDays}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={dayLabel} minTickGap={24} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={32} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => dayLabel(String(label))} />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="opened" fill="var(--color-opened)" radius={3} isAnimationActive={false} />
              <Bar dataKey="closed" fill="var(--color-closed)" radius={3} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
        </Panel>
        <Panel title={t("Métricas por monitor")} description={t("Ordenados por tiempo de interrupción. Incidentes incluye los que se superponen con el período.")}>
          {rows.length ? <Table>
            <TableHeader><TableRow>{["Monitor", "Disponibilidad", "Latencia media", "Interrupción (min)", "Comprobaciones", "Fallos", "Incidentes"].map((title) => <TableHead key={title}>{t(title)}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{rows.map((row) => <TableRow key={row.monitor.id}>
              <TableCell><Link className="font-medium hover:underline" to={`/app/monitors/${row.monitor.id}`}>{row.monitor.name}</Link></TableCell>
              <TableCell>{value(row.availability, "%")}</TableCell><TableCell>{value(row.latency, " ms")}</TableCell><TableCell>{row.observed ? number(row.outage / 60, 1) : t("Sin datos")}</TableCell><TableCell>{number(row.checks)}</TableCell><TableCell>{number(row.failedChecks)}</TableCell><TableCell>{number(row.incidents)}</TableCell>
            </TableRow>)}</TableBody>
          </Table> : <Nothing description={t("No hay monitores para estos filtros.")} />}
        </Panel>
        <Panel title={t("Detalle diario")} description={t("Los días sin observaciones se muestran como sin datos, no como 100% disponible.")}>
          <div className="max-h-96 overflow-y-auto"><Table>
            <TableHeader><TableRow>{["Día (UTC)", "Disponibilidad", "Latencia media", "Tiempo observado (min)", "Interrupción (min)", "Comprobaciones", "Fallos"].map((title) => <TableHead key={title}>{t(title)}</TableHead>)}</TableRow></TableHeader>
            <TableBody>{[...days].reverse().map((day) => <TableRow key={day.day}><TableCell>{dayLabel(day.day)}</TableCell><TableCell>{value(day.availability, "%")}</TableCell><TableCell>{value(day.latency, " ms")}</TableCell><TableCell>{day.observed ? number(day.observed / 60, 1) : t("Sin datos")}</TableCell><TableCell>{day.observed ? number(day.outage / 60, 1) : t("Sin datos")}</TableCell><TableCell>{number(day.checks)}</TableCell><TableCell>{number(day.failedChecks)}</TableCell></TableRow>)}</TableBody>
          </Table></div>
        </Panel>
      </>}
    </div>
  );
}
