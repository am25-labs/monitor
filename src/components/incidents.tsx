import { useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useRefresh, type Snapshot } from "../lib/api";
import { useMutation } from "../lib/mutations";
import { useLocale } from "../lib/locale";
import { LocaleProvider } from "../lib/locale";
import { type Language } from "../shared/settings";
import {
  stages,
  stageLabels,
  impacts,
  type Stage,
  type Impact,
  type IncidentDetail,
  type PublicIncident,
  type PublicIncidentView
} from "../shared/incidents";
import { Panel, Notice, Nothing, FormField, StatusBadge } from "./common";
import { IncidentCard } from "./incident-card";
import { ChoiceSelect } from "./choice-select";
import { CheckboxList } from "./checkbox-list";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { FieldGroup } from "./ui/field";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { ProviderOutageControl } from "./provider-outage-control";
import type { ProviderOutageState } from "../shared/provider-outage";

function Messages({
  title = false,
  initial
}: {
  title?: boolean;
  initial?: {
    title_es?: string;
    title_en?: string;
    message_es?: string;
    message_en?: string;
  };
}) {
  const { t } = useLocale();
  return (
    <FieldGroup className="grid gap-4 md:grid-cols-2">
      {(["es", "en"] as const).map((language) => (
        <FieldGroup key={language}>
          {title && (
            <FormField
              id={`title-${language}`}
              label={t(
                language === "es" ? "Título en español" : "Título en inglés"
              )}
            >
              <Input
                id={`title-${language}`}
                name={`title_${language}`}
                maxLength={200}
                defaultValue={initial?.[`title_${language}`] ?? ""}
              />
            </FormField>
          )}
          <FormField
            id={`message-${language}`}
            label={t(
              language === "es"
                ? "Actualización en español"
                : "Actualización en inglés"
            )}
          >
            <Textarea
              id={`message-${language}`}
              name={`message_${language}`}
              maxLength={4000}
              rows={5}
              defaultValue={initial?.[`message_${language}`] ?? ""}
            />
          </FormField>
        </FieldGroup>
      ))}
    </FieldGroup>
  );
}
function ImpactFields({
  stage,
  impact,
  onStage,
  onImpact,
  automatic = false,
  resolved = false,
  draft = false
}: {
  stage: Stage;
  impact: Impact;
  onStage: (v: Stage) => void;
  onImpact: (v: Impact) => void;
  automatic?: boolean;
  resolved?: boolean;
  draft?: boolean;
}) {
  const { t } = useLocale();
  return (
    <FieldGroup className="grid gap-4 sm:grid-cols-2">
      <FormField id="incident-impact" label={t("Impacto")}>
        <ChoiceSelect
          id="incident-impact"
          value={impact}
          disabled={automatic || resolved}
          options={impacts.map((value) => ({
            value,
            label: t(value === "down" ? "Caído" : "Degradado")
          }))}
          onValueChange={(v) => onImpact(v as Impact)}
        />
      </FormField>
      <FormField id="incident-stage" label={t("Etapa")}>
        <ChoiceSelect
          id="incident-stage"
          value={stage}
          options={stages
            .filter((s) =>
              resolved
                ? s === "resolved"
                : (!automatic && !draft) || s !== "resolved"
            )
            .map((value) => ({ value, label: t(stageLabels[value]) }))}
          onValueChange={(v) => onStage(v as Stage)}
        />
      </FormField>
    </FieldGroup>
  );
}
function DraftForm({
  data,
  incident,
  onSaved,
  onCancel,
  monitorId
}: {
  data: Snapshot;
  incident?: IncidentDetail;
  onSaved: (id: string) => void;
  onCancel: () => void;
  monitorId?: string;
}) {
  const mutation = useMutation();
  const { t } = useLocale();
  const [project, setProject] = useState(
    incident?.project_id ??
      data.monitors.find((m) => m.id === monitorId)?.project_id ??
      data.projects[0]?.id ??
      ""
  );
  const [selected, setSelected] = useState(
    incident?.monitors.map((m) => m.id) ?? (monitorId ? [monitorId] : [])
  );
  const [impact, setImpact] = useState<Impact>(incident?.impact ?? "degraded");
  const [stage, setStage] = useState<Stage>(incident?.stage ?? "investigating");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const result = await mutation.mutate<{ id: string }>(
        `admin/incidents${incident ? `/${incident.id}` : ""}`,
        incident ? "PUT" : "POST",
        {
          project_id: project,
          monitor_ids: selected,
          impact,
          stage,
          ...Object.fromEntries(
            ["title_es", "title_en", "message_es", "message_en"].map((k) => [
              k,
              form.get(k)
            ])
          )
        }
      );
      onSaved(result.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Falló la operación."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title={t("Borrador de incidente")}>
      <form onSubmit={save}>
        <FieldGroup>
          <FormField id="incident-project" label={t("Proyecto")}>
            <ChoiceSelect
              id="incident-project"
              value={project}
              options={data.projects.map((p) => ({
                value: p.id,
                label: p.name
              }))}
              onValueChange={(v) => {
                setProject(v);
                setSelected([]);
              }}
            />
          </FormField>
          <CheckboxList
            id="incident-monitors"
            name="monitors"
            label={t("Servicios afectados")}
            value={selected}
            onValueChange={setSelected}
            options={data.monitors
              .filter((m) => m.project_id === project)
              .map((m) => ({ value: m.id, label: m.name }))}
          />
          <ImpactFields
            impact={impact}
            stage={stage}
            onImpact={setImpact}
            onStage={setStage}
            draft
          />
          <Messages title initial={{ ...incident, ...incident?.updates[0] }} />
          <p className="text-sm text-muted-foreground">
            {t(
              "Completa los idiomas de las páginas que publican estos servicios. Los reportes manuales no alteran la disponibilidad medida."
            )}
          </p>
          <Notice message={error} destructive />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy || !selected.length}>
              {t("Guardar borrador")}
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
function IncidentEditor({ data, id, provider = false }: { data: Snapshot; id: string; provider?: boolean }) {
  const mutation = useMutation();
  const { t, date, language } = useLocale();
  const navigate = useNavigate();
  const {
    data: incident,
    error
  } = useRefresh<IncidentDetail>(`admin/incidents/${id}`);
  const [editing, setEditing] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null),
    [impact, setImpact] = useState<Impact | null>(null);
  const [previewLanguage, setPreviewLanguage] = useState<Language>(language);
  async function publish() {
    setBusy(true);
    setNotice("");
    try {
      await mutation.mutate(`admin/incidents/${id}/publish`, "POST", {});
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("Falló la operación."));
    } finally {
      setBusy(false);
    }
  }
  async function update(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const element = e.currentTarget,
      form = new FormData(element);
    setBusy(true);
    setNotice("");
    try {
      await mutation.mutate(`admin/incidents/${id}/updates`, "POST", {
        stage: stage ?? incident!.stage,
        impact: impact ?? incident!.impact,
        message_es: form.get("message_es"),
        message_en: form.get("message_en")
      });
      element.reset();
      setStage(null);
      setImpact(null);
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("Falló la operación."));
    } finally {
      setBusy(false);
    }
  }
  if (!incident) return <Notice message={error} destructive />;
  if (editing)
    return (
      <DraftForm
        data={data}
        incident={incident}
        onSaved={() => {
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  const preview: PublicIncidentView = {
    ...incident,
    title:
      incident.origin === "automatic"
        ? t("Incidente detectado automáticamente")
        : incident[`title_${previewLanguage}`],
    updates: incident.updates.map((u) => ({
      ...u,
      message: u.event
        ? t(
            u.event === "recovered"
              ? "El servicio volvió a funcionar normalmente."
              : u.impact === "down"
                ? "Detectamos una interrupción del servicio."
                : "Detectamos respuestas más lentas de lo habitual."
          )
        : u[`message_${previewLanguage}`]
    }))
  };
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => navigate("/app/incidents")}>
          {t("Volver")}
        </Button>
        {!incident.published && (
          <>
            <Button variant="outline" onClick={() => setEditing(true)}>
              {t("Editar borrador")}
            </Button>
            <Button onClick={() => void publish()} disabled={busy}>
              {t("Publicar incidente")}
            </Button>
          </>
        )}
      </div>
      <Notice message={notice || error} destructive />
      {incident.origin === "manual" && (
        <ChoiceSelect
          aria-label={t("Idioma de la vista previa")}
          value={previewLanguage}
          options={[
            { value: "es", label: t("Español") },
            { value: "en", label: t("Inglés") }
          ]}
          onValueChange={(v) => setPreviewLanguage(v as Language)}
        />
      )}
      <LocaleProvider language={previewLanguage} documentLanguage={false}>
        <IncidentCard incident={preview} published={Boolean(incident.published)} />
      </LocaleProvider>
      <p className="text-sm text-muted-foreground">
        {t("Inicio:")} {date(incident.opened_at)}
      </p>
      {incident.published && (
        <Panel title={t("Publicar actualización")}>
          <form onSubmit={update}>
            <FieldGroup>
              <ImpactFields
                stage={stage ?? incident.stage}
                impact={impact ?? incident.impact}
                onStage={setStage}
                onImpact={setImpact}
                automatic={incident.origin === "automatic" || provider}
                resolved={incident.closed_at !== null}
              />
              <Messages />
              <p className="text-sm text-muted-foreground">
                {t(
                  provider
                    ? "Finaliza el incidente desde el control del proveedor de infraestructura."
                    : "Las correcciones se añaden a la cronología. Los incidentes automáticos se resuelven cuando el servicio se recupera."
                )}
              </p>
              <Button disabled={busy}>{t("Publicar actualización")}</Button>
            </FieldGroup>
          </form>
        </Panel>
      )}
    </div>
  );
}
export function Incidents({ data }: { data: Snapshot }) {
  const { id } = useParams(),
    navigate = useNavigate();
  const [query] = useSearchParams();
  const monitorId = query.get("monitor") ?? undefined;
  const { t, date, language } = useLocale();
  const { data: list, error } = useRefresh<PublicIncident[]>(
    `admin/incidents${monitorId ? `?monitor=${monitorId}` : ""}`
  );
  const [creating, setCreating] = useState(false);
  const provider = useRefresh<ProviderOutageState>("admin/incidents/provider");
  const providerControl = <ProviderOutageControl state={provider.data} error={provider.error} hasMonitors={data.monitors.length > 0} />;
  if (id) return <div className="flex flex-col gap-6">{providerControl}<IncidentEditor key={id} data={data} id={id} provider={provider.data?.outage?.incident_ids.includes(id)} /></div>;
  if (creating)
    return (
      <DraftForm
        data={data}
        monitorId={monitorId}
        onSaved={(id) => {
          setCreating(false);
          navigate(`/app/incidents/${id}`);
        }}
        onCancel={() => setCreating(false)}
      />
    );
  return (
    <div className="flex flex-col gap-6">
      {providerControl}
      <Button
        className="self-start"
        disabled={!data.monitors.length}
        onClick={() => setCreating(true)}
      >
        {t("Crear incidente")}
      </Button>
      <Notice message={error} destructive />
      {list?.map((i) => (
        <Panel
          key={i.id}
          title={
            i.origin === "automatic"
              ? t("Incidente detectado automáticamente")
              : i[`title_${language}`] || i.title_es || i.title_en
          }
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2">
              <StatusBadge status={i.closed_at === null ? i.impact : "up"} />
              <Badge variant="outline">{t(stageLabels[i.stage])}</Badge>
              <Badge variant="secondary">
                {t(i.origin === "automatic" ? "Automático" : "Manual")}
              </Badge>
              {!i.published && <Badge variant="outline">{t("Borrador")}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground">
              {date(i.updated_at)}
            </p>
            <Button
              variant="outline"
              className="self-start"
              onClick={() => navigate(`/app/incidents/${i.id}`)}
            >
              {t("Ver incidente")}
            </Button>
          </div>
        </Panel>
      ))}
      {list && !list.length && (
        <Nothing description={t("No hay incidentes para mostrar.")} />
      )}
    </div>
  );
}
