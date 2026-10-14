import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { useLocale } from "../lib/locale";
import { locales } from "../shared/i18n";
import { metricDays } from "../shared/metrics";
import type { Stat } from "../shared/types";
import { Nothing, Panel } from "./common";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart";

export function MetricCharts({ stats, start, end }: { stats: Stat[]; start: string; end: string }) {
  const { t, language } = useLocale();
  const days = metricDays(stats, start, end);
  const formatDate = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(locales[language], { month: "short", day: "numeric", timeZone: "UTC" });
  const charts = [
    { key: "availability", title: t("Disponibilidad diaria"), description: t("Porcentaje del tiempo observado sin interrupciones. Días en UTC."), color: "var(--success)", unit: "%" },
    { key: "latency", title: t("Latencia media diaria"), description: t("Promedio ponderado de comprobaciones exitosas con latencia. Días en UTC."), color: "var(--primary)", unit: " ms" }
  ] as const;
  return (
    <div className="grid min-w-0 gap-6 xl:grid-cols-2">
      {charts.map((chart) => (
        <Panel key={chart.key} title={chart.title} description={chart.description}>
          {days.some((day) => day[chart.key] !== null) ? (
            <ChartContainer config={{ [chart.key]: { label: chart.title, color: chart.color } }} className="h-56 w-full" aria-label={chart.title}>
              <LineChart accessibilityLayer data={days} margin={{ left: 0, right: 12 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tickFormatter={formatDate} minTickGap={24} />
                <YAxis width={48} tickLine={false} axisLine={false} domain={chart.key === "availability" ? [0, 100] : [0, "auto"]} tickFormatter={(value: number) => `${value}${chart.unit}`} />
                <ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => formatDate(String(label))} formatter={(value) => <span>{Number(value).toLocaleString(locales[language], { maximumFractionDigits: 2 })}{chart.unit}</span>} />} />
                <Line type="linear" dataKey={chart.key} stroke={`var(--color-${chart.key})`} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
              </LineChart>
            </ChartContainer>
          ) : <Nothing description={t("No hay mediciones suficientes para esta gráfica.")} />}
        </Panel>
      ))}
    </div>
  );
}
