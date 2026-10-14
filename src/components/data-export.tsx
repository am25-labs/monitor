import { useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import type { Project } from "../shared/types";
import { useLocale } from "../lib/locale";
import { locales } from "../shared/i18n";
import { ChoiceSelect } from "./choice-select";
import { FormField, Notice, Panel } from "./common";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "./ui/field";

export function DataExport({ projects }: { projects: Project[] }) {
  const { t, language } = useLocale();
  const [scope, setScope] = useState("full");
  const [period, setPeriod] = useState("month");
  const [year, setYear] = useState(() => String(new Date().getUTCFullYear()));
  const [month, setMonth] = useState(() => String(new Date().getUTCMonth() + 1));
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const projectIds = selected.filter((id) => projects.some((project) => project.id === id));
  const allSelected = projects.length > 0 && projectIds.length === projects.length;

  function selectProject(id: string, checked: boolean) {
    setSelected((current) => checked
      ? [...new Set([...current, id])]
      : current.filter((value) => value !== id));
  }

  async function download(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const params = new URLSearchParams({ scope });
    if (scope === "projects") {
      projectIds.forEach((id) => params.append("project", id));
      if (period !== "all") {
        params.set("period", period);
        params.set("year", year);
        if (period === "month") params.set("month", month);
      }
    }
    try {
      const response = await fetch(`/api/v1/admin/settings/export?${params}`, { credentials: "same-origin" });
      if (response.status === 401) {
        setError("Tu sesión expiró. Vuelve a entrar.");
        location.assign("/app/");
        return;
      }
      if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json"))
        throw new Error("Export failed");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "monitor-backup.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {
      setError("No se pudo exportar la información.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel title={t("Exportar datos")} description={t("Descarga un backup completo o los datos de los proyectos seleccionados en JSON. Se conservan los IDs y sus relaciones.")}>
      <form onSubmit={download} className="flex flex-col gap-6">
        <FieldGroup>
          <FormField id="export-scope" label={t("Datos a exportar")}>
            <ChoiceSelect id="export-scope" value={scope} disabled={busy} onValueChange={setScope} options={[
              { value: "full", label: t("Backup completo") },
              { value: "projects", label: t("Por proyectos") }
            ]} />
            <FieldDescription>
              {scope === "full"
                ? t("Incluye todos los proyectos, grupos, monitores, historial, incidentes, páginas públicas, mantenimientos y ajustes almacenados.")
                : t("Incluye los proyectos seleccionados y sus grupos, monitores, historial, incidentes, páginas públicas y mantenimientos. Los ajustes globales se incluyen solo en el backup completo.")}
            </FieldDescription>
          </FormField>
          {scope === "projects" && (
            <FieldSet disabled={busy}>
              <FieldLegend variant="label">{t("Período a exportar")}</FieldLegend>
              <FieldGroup className="grid gap-4 md:grid-cols-3">
                <FormField id="export-period" label={t("Período")}>
                  <ChoiceSelect id="export-period" value={period} disabled={busy} onValueChange={setPeriod} options={[
                    { value: "month", label: t("Un mes") },
                    { value: "year", label: t("Año completo") },
                    { value: "all", label: t("Todo el historial") }
                  ]} />
                </FormField>
                {period !== "all" && (
                  <FormField id="export-year" label={t("Año")}>
                    <Input id="export-year" type="number" min={1970} max={9998} step={1} required disabled={busy} value={year} onChange={(event) => setYear(event.target.value)} />
                  </FormField>
                )}
                {period === "month" && (
                  <FormField id="export-month" label={t("Mes")}>
                    <ChoiceSelect id="export-month" value={month} disabled={busy} onValueChange={setMonth} options={Array.from({ length: 12 }, (_, index) => ({
                      value: String(index + 1),
                      label: new Intl.DateTimeFormat(locales[language], { month: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2000, index, 1)))
                    }))} />
                  </FormField>
                )}
              </FieldGroup>
              <FieldDescription>{period === "all"
                ? t("Incluye todo el historial conservado y permite restaurar los proyectos seleccionados.")
                : t("Meses y años calendario en UTC. Incluye únicamente el historial conservado del período y los incidentes y mantenimientos que se traslapen con él. Estos reportes no se pueden restaurar.")}</FieldDescription>
            </FieldSet>
          )}
          {scope === "projects" && (
            <FieldSet disabled={busy}>
              <FieldLegend variant="label">{t("Proyectos")}</FieldLegend>
              <Field orientation="horizontal" data-disabled={busy || !projects.length}>
                <Checkbox id="export-all-projects" disabled={busy || !projects.length} checked={allSelected} indeterminate={!allSelected && projectIds.length > 0} onCheckedChange={(checked) => setSelected(checked === true ? projects.map((project) => project.id) : [])} />
                <FieldLabel htmlFor="export-all-projects">{t("Seleccionar todos")}</FieldLabel>
              </Field>
              <FieldGroup className="max-h-72 overflow-y-auto">
                {projects.map((project) => (
                  <Field key={project.id} orientation="horizontal" data-disabled={busy}>
                    <Checkbox id={`export-${project.id}`} disabled={busy} checked={projectIds.includes(project.id)} onCheckedChange={(checked) => selectProject(project.id, checked === true)} />
                    <FieldContent className="min-w-0">
                      <FieldLabel htmlFor={`export-${project.id}`}>{project.name}</FieldLabel>
                      <span className="break-all font-mono text-xs text-muted-foreground">{project.id}</span>
                    </FieldContent>
                  </Field>
                ))}
              </FieldGroup>
              {!projects.length && <FieldDescription>{t("No hay proyectos para exportar.")}</FieldDescription>}
            </FieldSet>
          )}
          <div className="flex flex-col gap-1">
            <FieldDescription>{t("El JSON conserva la configuración y las credenciales cifradas. Para restaurarlas, Monitor necesita la misma CONFIG_KEY usada al crear la copia. Esa clave no se incluye en el archivo y debe conservarse por separado. Los reportes de métricas e incidentes no necesitan la clave.")}</FieldDescription>
            <FieldDescription>{t("Los datos se leen durante la descarga; los cambios realizados mientras se exporta pueden aparecer en la copia.")}</FieldDescription>
          </div>
        </FieldGroup>
        <Notice message={error} destructive />
        <Button type="submit" disabled={busy || (scope === "projects" && !projectIds.length)} className="self-end">
          <Download data-icon="inline-start" />
          {busy ? t("Exportando…") : t("Descargar JSON")}
        </Button>
      </form>
    </Panel>
  );
}
