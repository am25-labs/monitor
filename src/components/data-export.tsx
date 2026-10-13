import { useState, type FormEvent } from "react";
import { Download } from "lucide-react";
import type { Project } from "../shared/types";
import { useLocale } from "../lib/locale";
import { ChoiceSelect } from "./choice-select";
import { FormField, Notice, Panel } from "./common";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "./ui/field";

export function DataExport({ projects }: { projects: Project[] }) {
  const { t } = useLocale();
  const [scope, setScope] = useState("full");
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
    if (scope === "projects") projectIds.forEach((id) => params.append("project", id));
    try {
      const response = await fetch(`/api/v1/admin/settings/export?${params}`, { credentials: "same-origin" });
      if (response.status === 401) {
        location.assign("/app/");
        throw new Error(t("Tu sesión expiró. Vuelve a entrar."));
      }
      if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json"))
        throw new Error(t("No se pudo exportar la información."));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = response.headers.get("Content-Disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "monitor-backup.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (error) {
      setError(error instanceof Error ? error.message : t("No se pudo exportar la información."));
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
          <FieldDescription>{t("Las credenciales conservan su cifrado. Guarda también la CONFIG_KEY original por separado para poder recuperarlas.")}</FieldDescription>
          <FieldDescription>{t("La exportación lee los datos durante la descarga; no representa una captura de un único instante.")}</FieldDescription>
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
