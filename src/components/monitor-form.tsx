import { useState, type FormEvent } from "react";
import type { HttpConfig, SafeMonitor, TcpConfig } from "../shared/types";
import type { Snapshot } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Textarea } from "./ui/textarea";
import { NativeSelect } from "./ui/native-select";
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
      setError(e instanceof Error ? e.message : "Revisá los datos.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title={monitor ? "Editar monitor" : "Nuevo monitor"}>
      <form onSubmit={submit}>
        <FieldGroup>
          <FormField label="Nombre" id="name">
            <Input
              id="name"
              name="name"
              required
              maxLength={120}
              defaultValue={monitor?.name}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Proyecto" id="project">
              <NativeSelect
                id="project"
                value={project}
                onChange={(e) => {
                  setProject(e.target.value);
                  setGroup("");
                }}
                required
              >
                {data.projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField label="Grupo" id="group">
              <NativeSelect
                id="group"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                <option value="">Sin grupo</option>
                {data.groups
                  .filter((g) => g.project_id === project)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
              </NativeSelect>
            </FormField>
          </div>
          <FormField label="Tipo de monitor" id="kind">
            <NativeSelect
              id="kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="http">HTTP / HTTPS</option>
              <option value="tcp">Conexión TCP</option>
              <option value="heartbeat">Heartbeat</option>
            </NativeSelect>
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
                <FormField label="Método" id="method">
                  <NativeSelect
                    id="method"
                    name="method"
                    defaultValue={http?.method ?? "GET"}
                  >
                    <option>GET</option>
                    <option>HEAD</option>
                  </NativeSelect>
                </FormField>
                <FormField label="Códigos aceptados" id="codes">
                  <Input
                    id="codes"
                    name="codes"
                    defaultValue={http?.codes ?? "200-299"}
                    required
                    placeholder="200-299,401"
                  />
                </FormField>
              </div>
              <FormField label="Seguir redirecciones" id="follow">
                <NativeSelect
                  id="follow"
                  name="follow"
                  defaultValue={String(http?.followRedirects ?? false)}
                >
                  <option value="false">No</option>
                  <option value="true">Sí</option>
                </NativeSelect>
              </FormField>
              <FormField label="Headers de la comprobación (JSON)" id="headers">
                <Textarea
                  id="headers"
                  name="headers"
                  defaultValue="{}"
                  placeholder={'{"Authorization":"Bearer …"}'}
                />
                <FieldDescription>
                  Los valores se cifran y no se vuelven a mostrar.
                </FieldDescription>
              </FormField>
              {monitor?.hasCredentials && (
                <FormField label="Headers existentes" id="keep">
                  <NativeSelect id="keep" name="keep" defaultValue="true">
                    <option value="true">
                      Conservar y combinar con los nuevos
                    </option>
                    <option value="false">
                      Reemplazar por los indicados arriba
                    </option>
                  </NativeSelect>
                </FormField>
              )}
              <FormField label="Validación del contenido" id="assertion">
                <NativeSelect
                  id="assertion"
                  value={assertion}
                  onChange={(e) =>
                    setAssertion(e.target.value as typeof assertion)
                  }
                >
                  <option value="none">Solo código HTTP</option>
                  <option value="text">Contiene un texto</option>
                  <option value="json">Valor JSON esperado</option>
                </NativeSelect>
              </FormField>
              {assertion === "text" && (
                <FormField label="Texto esperado" id="text">
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
                  <FormField label="Valor esperado (JSON)" id="expected">
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
                  Debe ser accesible desde Workers. Las conexiones a IP privadas
                  o de Cloudflare están restringidas.
                </FieldDescription>
              </FormField>
              <FormField label="Puerto" id="port">
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
            <FormField label="Timeout (segundos)" id="timeout">
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
                  ? "Intervalo esperado (minutos)"
                  : "Frecuencia (minutos)"
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
              <FormField label="Tolerancia (segundos)" id="grace">
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
            <FormField label="Fallos para abrir incidente" id="failures">
              <Input
                id="failures"
                name="failures"
                type="number"
                min={1}
                max={20}
                defaultValue={monitor?.failure_threshold ?? 2}
              />
            </FormField>
            <FormField label="Éxitos para recuperar" id="recoveries">
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
              {busy ? "Guardando…" : "Guardar monitor"}
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
