import { useLocale } from "../lib/locale";
import { useState, type FormEvent } from "react";
import type { HttpConfig, SafeMonitor, TcpConfig } from "../shared/types";
import type { Snapshot } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { ChoiceSelect } from "./choice-select";
import { FieldDescription, FieldGroup } from "./ui/field";
import { FormField, Notice, Panel } from "./common";

export function MonitorForm({
  data,
  monitor,
  onSave,
  onCancel
}: {
  data: Snapshot;
  monitor?: SafeMonitor;
  onSave: (v: unknown, id?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useLocale();
  const http =
      monitor?.kind === "http" ? (monitor.config as HttpConfig) : undefined,
    tcp = monitor?.kind === "tcp" ? (monitor.config as TcpConfig) : undefined;
  const [kind, setKind] = useState(monitor?.kind ?? "http"),
    [project, setProject] = useState(
      monitor?.project_id ?? data.projects[0]?.id ?? ""
    );
  const [group, setGroup] = useState(monitor?.group_id ?? ""),
    [assertion, setAssertion] = useState(http?.assertion ?? "none"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget);
    try {
      const config =
        kind === "heartbeat"
          ? {}
          : kind === "tcp"
            ? {
                host: f.get("host"),
                port: Number(f.get("port")),
                timeoutSeconds: Number(f.get("timeout"))
              }
            : {
                url: f.get("url"),
                method: f.get("method"),
                headers: JSON.parse(String(f.get("headers") || "{}")),
                codes: f.get("codes"),
                followRedirects: f.get("follow") === "true",
                timeoutSeconds: Number(f.get("timeout")),
                assertion,
                text: f.get("text") ?? undefined,
                pointer: f.get("pointer") ?? undefined,
                ...(assertion === "json"
                  ? { expected: JSON.parse(String(f.get("expected"))) }
                  : {})
              };
      await onSave(
        {
          name: f.get("name"),
          project_id: project,
          group_id: group || null,
          kind,
          config,
          interval_seconds: Number(f.get("interval")) * 60,
          grace_seconds: Number(f.get("grace") ?? 60),
          failure_threshold: Number(f.get("failures")),
          recovery_threshold: Number(f.get("recoveries")),
          paused: Boolean(monitor?.paused),
          keepCredentials: f.get("keep") !== "false"
        },
        monitor?.id
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("Revisá los datos."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title={monitor ? t("Editar monitor") : t("Nuevo monitor")}>
      <form onSubmit={submit}>
        <FieldGroup>
          <FormField label={t("Nombre")} id="name">
            <Input
              id="name"
              name="name"
              required
              maxLength={120}
              defaultValue={monitor?.name}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("Proyecto")} id="project">
              <ChoiceSelect
                id="project"
                value={project}
                onValueChange={(value) => {
                  setProject(value);
                  setGroup("");
                }}
                required
                options={[
                  ...data.projects.map((p) => ({ value: p.id, label: p.name }))
                ]}
              />
            </FormField>
            <FormField label={t("Grupo")} id="group">
              <ChoiceSelect
                id="group"
                value={group}
                onValueChange={(value) => setGroup(value)}
                options={[
                  { value: "", label: t("Sin grupo") },
                  ...data.groups
                    .filter((g) => g.project_id === project)
                    .map((g) => ({ value: g.id, label: g.name }))
                ]}
              />
            </FormField>
          </div>
          <FormField label={t("Tipo de monitor")} id="kind">
            <ChoiceSelect
              id="kind"
              value={kind}
              onValueChange={(value) => setKind(value as typeof kind)}
              options={[
                { value: "http", label: "HTTP / HTTPS" },
                { value: "tcp", label: t("Conexión TCP") },
                { value: "heartbeat", label: "Heartbeat" }
              ]}
            />
          </FormField>
          {kind === "http" && (
            <>
              <FormField label="URL" id="url">
                <Input
                  id="url"
                  name="url"
                  type="url"
                  required
                  defaultValue={http?.url}
                  placeholder="https://proyecto.example/health"
                />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label={t("Método")} id="method">
                  <ChoiceSelect
                    id="method"
                    name="method"
                    defaultValue={http?.method ?? "GET"}
                    options={[
                      { value: "GET", label: "GET" },
                      { value: "HEAD", label: "HEAD" }
                    ]}
                  />
                </FormField>
                <FormField label={t("Códigos aceptados")} id="codes">
                  <Input
                    id="codes"
                    name="codes"
                    defaultValue={http?.codes ?? "200-299"}
                    required
                    placeholder="200-299,401"
                  />
                </FormField>
              </div>
              <FormField label={t("Seguir redirecciones")} id="follow">
                <ChoiceSelect
                  id="follow"
                  name="follow"
                  defaultValue={String(http?.followRedirects ?? false)}
                  options={[
                    { value: "false", label: t("No") },
                    { value: "true", label: t("Sí") }
                  ]}
                />
              </FormField>
              <FormField
                label={t("Headers de la comprobación (JSON)")}
                id="headers"
              >
                <Textarea
                  id="headers"
                  name="headers"
                  defaultValue="{}"
                  placeholder={'{"Authorization":"Bearer …"}'}
                />
                <FieldDescription>
                  {t("Los valores se cifran y no se vuelven a mostrar.")}
                </FieldDescription>
              </FormField>
              {monitor?.hasCredentials && (
                <FormField label={t("Headers existentes")} id="keep">
                  <ChoiceSelect
                    id="keep"
                    name="keep"
                    defaultValue="true"
                    options={[
                      {
                        value: "true",
                        label: t("Conservar y combinar con los nuevos")
                      },
                      {
                        value: "false",
                        label: t("Reemplazar por los indicados arriba")
                      }
                    ]}
                  />
                </FormField>
              )}
              <FormField label={t("Validación del contenido")} id="assertion">
                <ChoiceSelect
                  id="assertion"
                  value={assertion}
                  onValueChange={(value) =>
                    setAssertion(value as typeof assertion)
                  }
                  options={[
                    { value: "none", label: t("Solo código HTTP") },
                    { value: "text", label: t("Contiene un texto") },
                    { value: "json", label: t("Valor JSON esperado") }
                  ]}
                />
              </FormField>
              {assertion === "text" && (
                <FormField label={t("Texto esperado")} id="text">
                  <Input
                    id="text"
                    name="text"
                    required
                    defaultValue={http?.text}
                  />
                </FormField>
              )}
              {assertion === "json" && (
                <>
                  <FormField label="JSON Pointer" id="pointer">
                    <Input
                      id="pointer"
                      name="pointer"
                      defaultValue={http?.pointer ?? "/status"}
                      placeholder="/dependencies/database/healthy"
                    />
                  </FormField>
                  <FormField label={t("Valor esperado (JSON)")} id="expected">
                    <Input
                      id="expected"
                      name="expected"
                      required
                      defaultValue={JSON.stringify(http?.expected ?? true)}
                    />
                  </FormField>
                </>
              )}
            </>
          )}
          {kind === "tcp" && (
            <>
              <FormField label="Host" id="host">
                <Input
                  id="host"
                  name="host"
                  required
                  defaultValue={tcp?.host}
                />
                <FieldDescription>
                  {t(
                    "Debe ser accesible desde Workers. Las conexiones a IP privadas o de Cloudflare están restringidas."
                  )}
                </FieldDescription>
              </FormField>
              <FormField label={t("Puerto")} id="port">
                <Input
                  id="port"
                  name="port"
                  type="number"
                  min={1}
                  max={65535}
                  required
                  defaultValue={tcp?.port ?? 443}
                />
              </FormField>
            </>
          )}
          {kind !== "heartbeat" && (
            <FormField label={t("Timeout (segundos)")} id="timeout">
              <Input
                id="timeout"
                name="timeout"
                type="number"
                min={1}
                max={30}
                defaultValue={http?.timeoutSeconds ?? tcp?.timeoutSeconds ?? 10}
              />
            </FormField>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={
                kind === "heartbeat"
                  ? t("Intervalo esperado (minutos)")
                  : t("Frecuencia (minutos)")
              }
              id="interval"
            >
              <Input
                id="interval"
                name="interval"
                type="number"
                min={1}
                max={10080}
                step="any"
                required
                defaultValue={(monitor?.interval_seconds ?? 60) / 60}
              />
            </FormField>
            {kind === "heartbeat" && (
              <FormField label={t("Tolerancia (segundos)")} id="grace">
                <Input
                  id="grace"
                  name="grace"
                  type="number"
                  min={0}
                  max={86400}
                  defaultValue={monitor?.grace_seconds ?? 60}
                />
              </FormField>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("Fallos para abrir incidente")} id="failures">
              <Input
                id="failures"
                name="failures"
                type="number"
                min={1}
                max={20}
                defaultValue={monitor?.failure_threshold ?? 2}
              />
            </FormField>
            <FormField label={t("Éxitos para recuperar")} id="recoveries">
              <Input
                id="recoveries"
                name="recoveries"
                type="number"
                min={1}
                max={20}
                defaultValue={monitor?.recovery_threshold ?? 1}
              />
            </FormField>
          </div>
          <Notice message={error} destructive />
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !project}>
              {busy ? t("Guardando…") : t("Guardar monitor")}
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
