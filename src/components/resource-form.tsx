import { useState, type FormEvent } from "react";
import type { Snapshot } from "../lib/api";
import { FormField, Notice, Panel } from "./common";
import { FieldDescription, FieldGroup } from "./ui/field";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { ChoiceSelect } from "./choice-select";
import { CheckboxList } from "./checkbox-list";
import { DateTimePicker } from "./date-picker";
import { Button } from "./ui/button";

export type Resource = "projects" | "groups" | "pages" | "maintenance";
export function ResourceForm({
  resource,
  data,
  value,
  onSave,
  onCancel
}: {
  resource: Resource;
  data: Snapshot;
  value?: Record<string, unknown>;
  onSave: (resource: Resource, v: unknown, id?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [project, setProject] = useState(
    String(value?.project_id ?? data.projects[0]?.id ?? "")
  );
  const [scope, setScope] = useState(String(value?.scope ?? "project")),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const names = {
    projects: "proyecto",
    groups: "grupo",
    pages: "página pública",
    maintenance: "ventana de mantenimiento"
  };
  const datetime = (v: unknown) => {
    if (!v) return "";
    const d = new Date(Number(v) * 1000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString()
      .slice(0, 16);
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    const payload =
      resource === "projects"
        ? { name: f.get("name"), description: f.get("description") }
        : resource === "groups"
          ? { name: f.get("name"), project_id: project }
          : resource === "pages"
            ? {
                title: f.get("title"),
                slug: f.get("slug"),
                description: f.get("description"),
                project_id: project,
                group_ids: f.getAll("group_ids"),
                excluded_ids: f.getAll("excluded_ids"),
                published: f.get("published") === "true"
              }
            : {
                title: f.get("title"),
                scope,
                target_id: f.get("target_id"),
                starts_at: Math.floor(
                  new Date(String(f.get("starts_at"))).getTime() / 1000
                ),
                ends_at: Math.floor(
                  new Date(String(f.get("ends_at"))).getTime() / 1000
                )
              };
    try {
      if (
        resource === "maintenance" &&
        (!f.get("starts_at") || !f.get("ends_at"))
      )
        throw new Error("Elegí las fechas de inicio y fin del mantenimiento.");
      await onSave(resource, payload, value?.id as string | undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Revisá los datos.");
    } finally {
      setBusy(false);
    }
  }
  const targets =
    scope === "project"
      ? data.projects
      : scope === "group"
        ? data.groups
        : data.monitors;
  return (
    <Panel title={`${value ? "Editar" : "Crear"} ${names[resource]}`}>
      <form onSubmit={submit}>
        <FieldGroup>
          <FormField
            label={
              resource === "projects" || resource === "groups"
                ? "Nombre"
                : "Título"
            }
            id="resource-title"
          >
            <Input
              id="resource-title"
              name={
                resource === "projects" || resource === "groups"
                  ? "name"
                  : "title"
              }
              required
              defaultValue={String(value?.name ?? value?.title ?? "")}
            />
          </FormField>
          {(resource === "projects" || resource === "pages") && (
            <FormField label="Descripción" id="description">
              <Textarea
                id="description"
                name="description"
                defaultValue={String(value?.description ?? "")}
              />
            </FormField>
          )}
          {(resource === "groups" || resource === "pages") && (
            <FormField label="Proyecto" id="resource-project">
              <ChoiceSelect
                id="resource-project"
                value={project}
                onValueChange={(value) => setProject(value)}
                disabled={resource === "groups" && Boolean(value)}
                required
                options={[
                  ...data.projects.map((p) => ({ value: p.id, label: p.name }))
                ]}
              />
            </FormField>
          )}
          {resource === "pages" && (
            <>
              <FormField label="Identificador de la página" id="slug">
                <Input
                  id="slug"
                  name="slug"
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  defaultValue={String(value?.slug ?? "")}
                  placeholder="mi-proyecto"
                />
                <FieldDescription>
                  Se publicará en /status/identificador.
                </FieldDescription>
              </FormField>
              <CheckboxList
                key={`groups-${project}`}
                id="group_ids"
                name="group_ids"
                label="Grupos incluidos"
                options={data.groups
                  .filter((g) => g.project_id === project)
                  .map((g) => ({ value: g.id, label: g.name }))}
                defaultValue={
                  project === value?.project_id
                    ? (value?.group_ids as string[] | undefined)
                    : []
                }
              />
              <FieldDescription>
                Sin selección incluye todo el proyecto.
              </FieldDescription>
              <CheckboxList
                key={`excluded-${project}`}
                id="excluded_ids"
                name="excluded_ids"
                label="Monitores que se ocultarán"
                options={data.monitors
                  .filter((m) => m.project_id === project)
                  .map((m) => ({ value: m.id, label: m.name }))}
                defaultValue={
                  project === value?.project_id
                    ? (value?.excluded_ids as string[] | undefined)
                    : []
                }
              />
              <FieldDescription>
                Marcá únicamente los monitores que no querés mostrar. Para
                publicar todos los monitores de los grupos incluidos, dejá estas
                casillas sin marcar.
              </FieldDescription>
              <FormField label="Publicación" id="published">
                <ChoiceSelect
                  id="published"
                  name="published"
                  defaultValue={String(value?.published ?? false)}
                  options={[
                    { value: "false", label: "Borrador" },
                    { value: "true", label: "Pública" }
                  ]}
                />
              </FormField>
            </>
          )}
          {resource === "maintenance" && (
            <>
              <FormField label="Aplicar a" id="scope">
                <ChoiceSelect
                  id="scope"
                  value={scope}
                  onValueChange={(value) => setScope(value)}
                  options={[
                    { value: "project", label: "Proyecto" },
                    { value: "group", label: "Grupo" },
                    { value: "monitor", label: "Monitor" }
                  ]}
                />
              </FormField>
              <FormField label="Destino" id="target_id">
                <ChoiceSelect
                  key={scope}
                  id="target_id"
                  name="target_id"
                  required
                  defaultValue={
                    value?.scope === scope
                      ? String(value?.target_id)
                      : targets[0]?.id
                  }
                  options={[
                    ...targets.map((t) => ({ value: t.id, label: t.name }))
                  ]}
                />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Inicio (hora local)" id="starts_at">
                  <DateTimePicker
                    id="starts_at"
                    name="starts_at"
                    defaultValue={datetime(value?.starts_at)}
                  />
                </FormField>
                <FormField label="Fin (hora local)" id="ends_at">
                  <DateTimePicker
                    id="ends_at"
                    name="ends_at"
                    defaultValue={datetime(value?.ends_at)}
                  />
                </FormField>
              </div>
            </>
          )}
          <Notice message={error} destructive />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Guardando…" : "Guardar"}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
          </div>
        </FieldGroup>
      </form>
    </Panel>
  );
}
