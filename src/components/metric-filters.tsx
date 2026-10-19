import type { Snapshot } from "../lib/api";
import { useLocale } from "../lib/locale";
import { ChoiceSelect } from "./choice-select";
import { FormField } from "./common";
import { Input } from "./ui/input";
import { FieldGroup } from "./ui/field";

export interface MetricFilters {
  period: string;
  project: string;
  group: string;
  monitor: string;
  start: string;
  end: string;
}

export function defaultMetricFilters(): MetricFilters {
  return { period: "30", project: "", group: "", monitor: "", start: new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) };
}

export function metricParams(filters: MetricFilters) {
  const params = new URLSearchParams(filters.period === "custom" ? { start: filters.start, end: filters.end } : { days: filters.period });
  for (const key of ["project", "group", "monitor"] as const)
    if (filters[key]) params.set(key, filters[key]);
  return params;
}

export function MetricFilterFields({ data, value, onChange, prefix, disabled = false, className }: {
  data: Snapshot;
  value: MetricFilters;
  onChange: (value: MetricFilters) => void;
  prefix: string;
  disabled?: boolean;
  className: string;
}) {
  const { t } = useLocale();
  const today = new Date().toISOString().slice(0, 10);
  const monitors = data.monitors.filter((item) => (!value.project || item.project_id === value.project) && (!value.group || item.group_id === value.group));
  return <FieldGroup className={className}>
    <FormField id={`${prefix}-period`} label={t("Período")}>
      <ChoiceSelect id={`${prefix}-period`} disabled={disabled} value={value.period} onValueChange={(period) => onChange({ ...value, period })} options={[{ value: "7", label: t("Últimos 7 días") }, { value: "30", label: t("Últimos 30 días") }, { value: "90", label: t("Últimos 90 días") }, { value: "custom", label: t("Personalizado") }]} />
    </FormField>
    <FormField id={`${prefix}-project`} label={t("Proyecto")}>
      <ChoiceSelect id={`${prefix}-project`} disabled={disabled} value={value.project} onValueChange={(project) => onChange({ ...value, project, group: "", monitor: "" })} options={[{ value: "", label: t("Todos los proyectos") }, ...data.projects.map((item) => ({ value: item.id, label: item.name }))]} />
    </FormField>
    <FormField id={`${prefix}-group`} label={t("Grupo")}>
      <ChoiceSelect id={`${prefix}-group`} disabled={disabled} value={value.group} onValueChange={(group) => onChange({ ...value, group, monitor: "" })} options={[{ value: "", label: t("Todos los grupos") }, ...data.groups.filter((item) => !value.project || item.project_id === value.project).map((item) => ({ value: item.id, label: item.name }))]} />
    </FormField>
    <FormField id={`${prefix}-monitor`} label={t("Monitor")}>
      <ChoiceSelect id={`${prefix}-monitor`} disabled={disabled} value={value.monitor} onValueChange={(monitor) => onChange({ ...value, monitor })} options={[{ value: "", label: t("Todos los monitores") }, ...monitors.map((item) => ({ value: item.id, label: item.name }))]} />
    </FormField>
    {value.period === "custom" && <>
      <FormField id={`${prefix}-start`} label={t("Desde (UTC)")}><Input id={`${prefix}-start`} type="date" disabled={disabled} required value={value.start} max={value.end < today ? value.end : today} onChange={(event) => onChange({ ...value, start: event.target.value })} /></FormField>
      <FormField id={`${prefix}-end`} label={t("Hasta (UTC)")}><Input id={`${prefix}-end`} type="date" disabled={disabled} required value={value.end} min={value.start} max={today} onChange={(event) => onChange({ ...value, end: event.target.value })} /></FormField>
    </>}
  </FieldGroup>;
}
