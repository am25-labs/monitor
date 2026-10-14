import { useLocale } from "../lib/locale";
import { localDateTime, parseDateTime } from "../shared/time";
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
import { pageMonitors } from "../shared/page-scope";

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
  const { t, timeZone } = useLocale();
  const [project, setProject] = useState(
    String(value?.project_id ?? data.projects[0]?.id ?? "")
  );
  const [groups, setGroups] = useState(
    (value?.group_ids as string[] | undefined) ?? []
  );
  const [included, setIncluded] = useState(
    (value?.included_ids as string[] | undefined) ?? []
  );
  const [language, setLanguage] = useState(String(value?.language ?? "es"));
  const [timing, setTiming] = useState(
    value?.ends_at === null ? "manual" : "scheduled"
  );
  const eligible = pageMonitors(data.monitors, project, groups);
  const [scope, setScope] = useState(String(value?.scope ?? "project")),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const names = {
    projects: t("proyecto"),
    groups: t("grupo"),
    pages: t("página pública"),
    maintenance: t("ventana de mantenimiento")
  };
  const datetime = (v: unknown) => {
    return v == null ? "" : localDateTime(Number(v), timeZone).slice(0, 16);
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
                language,
                title: f.get("title"),
                slug: f.get("slug"),
                description: f.get("description"),
                project_id: project,
                group_ids: groups,
                included_ids: included.filter((id) =>
                  eligible.some((m) => m.id === id)
                ),
                published: f.get("published") === "true"
              }
            : {
                title: f.get("title"),
                scope,
                target_id: scope === "global" ? null : f.get("target_id"),
                starts_at:
                  timing === "manual"
                    ? Number(
                        value?.ends_at === null && value?.starts_at
                          ? value.starts_at
                          : Math.floor(Date.now() / 1000)
                      )
                    : parseDateTime(String(f.get("starts_at")), timeZone),
                ends_at:
                  timing === "manual"
                    ? null
                    : parseDateTime(String(f.get("ends_at")), timeZone)
              };
    try {
      if (
        resource === "maintenance" &&
        timing === "scheduled" &&
        (!f.get("starts_at") || !f.get("ends_at"))
      )
        throw new Error(
          t("Elige las fechas de inicio y fin del mantenimiento.")
        );
      if (resource === "maintenance" && timing === "scheduled" &&
          "starts_at" in payload && (payload.starts_at === null || payload.ends_at === null))
        throw new Error(t("La fecha u hora no existe en la zona horaria seleccionada."));
      await onSave(resource, payload, value?.id as string | undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Revisa los datos."));
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
    <Panel title={`${value ? t("Editar") : t("Crear")} ${names[resource]}`}>
      <form onSubmit={submit}>
        <FieldGroup>
          <FormField
            label={
              resource === "projects" || resource === "groups"
                ? t("Nombre")
                : t("Título")
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
            <FormField label={t("Descripción")} id="description">
              <Textarea
                id="description"
                name="description"
                defaultValue={String(value?.description ?? "")}
              />
            </FormField>
          )}
          {(resource === "groups" || resource === "pages") && (
            <FormField label={t("Proyecto")} id="resource-project">
              <ChoiceSelect
                id="resource-project"
                value={project}
                onValueChange={(value) => {
                  setProject(value);
                  setGroups([]);
                  setIncluded([]);
                }}
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
              <FormField label={t("Idioma de la página")} id="page-language">
                <ChoiceSelect
                  id="page-language"
                  value={language}
                  onValueChange={setLanguage}
                  options={[
                    { value: "es", label: t("Español") },
                    { value: "en", label: t("Inglés") }
                  ]}
                />
              </FormField>
              <FormField label={t("Identificador de la página")} id="slug">
                <Input
                  id="slug"
                  name="slug"
                  required
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  defaultValue={String(value?.slug ?? "")}
                  placeholder={t("mi-proyecto")}
                />
                <FieldDescription>
                  {t("Se publicará en /status/identificador.")}
                </FieldDescription>
              </FormField>
              <CheckboxList
                key={`groups-${project}`}
                id="group_ids"
                name="group_ids"
                label={t("Grupos incluidos")}
                options={data.groups
                  .filter((g) => g.project_id === project)
                  .map((g) => ({ value: g.id, label: g.name }))}
                value={groups}
                onValueChange={(selected) => {
                  setGroups(selected);
                  const ids = new Set(
                    pageMonitors(data.monitors, project, selected).map(
                      (m) => m.id
                    )
                  );
                  setIncluded((current) => current.filter((id) => ids.has(id)));
                }}
              />
              <FieldDescription>
                {t(
                  "Sin grupos seleccionados, puedes elegir monitores de todo el proyecto."
                )}
              </FieldDescription>
              <CheckboxList
                key={`included-${project}`}
                id="included_ids"
                name="included_ids"
                label={t("Monitores incluidos")}
                options={eligible.map((m) => ({ value: m.id, label: m.name }))}
                value={included}
                onValueChange={setIncluded}
              />
              <FieldDescription>
                {t(
                  "Solo se publicarán los monitores marcados. Sin selección no se muestra ninguno; los monitores nuevos requieren selección manual."
                )}
              </FieldDescription>
              <FormField label={t("Publicación")} id="published">
                <ChoiceSelect
                  id="published"
                  name="published"
                  defaultValue={String(value?.published ?? false)}
                  options={[
                    { value: "false", label: t("Borrador") },
                    { value: "true", label: t("Pública") }
                  ]}
                />
              </FormField>
            </>
          )}
          {resource === "maintenance" && (
            <>
              <FormField label={t("Aplicar a")} id="scope">
                <ChoiceSelect
                  id="scope"
                  value={scope}
                  onValueChange={(value) => setScope(value)}
                  options={[
                    { value: "global", label: t("Todos los monitores") },
                    { value: "project", label: t("Proyecto") },
                    { value: "group", label: t("Grupo") },
                    { value: "monitor", label: t("Monitor") }
                  ]}
                />
              </FormField>
              {scope !== "global" && (
                <FormField label={t("Destino")} id="target_id">
                  <ChoiceSelect
                    key={scope}
                    id="target_id"
                    name="target_id"
                    required
                    defaultValue={
                      value?.scope === scope && value?.target_id
                        ? String(value?.target_id)
                        : targets[0]?.id
                    }
                    options={[
                      ...targets.map((item) => ({
                        value: item.id,
                        label:
                          scope === "monitor"
                            ? `${item.name} · ${data.projects.find((p) => p.id === data.monitors.find((m) => m.id === item.id)?.project_id)?.name ?? ""}`
                            : item.name
                      }))
                    ]}
                  />
                </FormField>
              )}
              <FormField label={t("Duración")} id="maintenance-timing">
                <ChoiceSelect
                  id="maintenance-timing"
                  value={timing}
                  onValueChange={setTiming}
                  options={[
                    { value: "scheduled", label: t("Programar inicio y fin") },
                    {
                      value: "manual",
                      label: t("Desde ahora hasta finalizar manualmente")
                    }
                  ]}
                />
                <FieldDescription>
                  {t(
                    "El mantenimiento evita nuevas alertas y excluye ese tiempo de la disponibilidad."
                  )}
                </FieldDescription>
              </FormField>
              {timing === "scheduled" && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label={t("Inicio ({zone})", { zone: timeZone })} id="starts_at">
                    <DateTimePicker
                      id="starts_at"
                      name="starts_at"
                      defaultValue={datetime(value?.starts_at)}
                    />
                  </FormField>
                  <FormField label={t("Fin ({zone})", { zone: timeZone })} id="ends_at">
                    <DateTimePicker
                      id="ends_at"
                      name="ends_at"
                      defaultValue={datetime(value?.ends_at)}
                    />
                  </FormField>
                </div>
              )}
            </>
          )}
          <Notice message={error} destructive />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? t("Guardando…") : t("Guardar")}
            </Button>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t("Cancelar")}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </Panel>
  );
}
