import { useState, type FormEvent } from "react";
import { date, useRefresh } from "../lib/api";
import { useMutation } from "../lib/mutations";
import { useLocale } from "../lib/locale";
import type { AgentToken } from "../shared/analytics";
import { FormField, Notice, Panel } from "./common";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { FieldGroup } from "./ui/field";

type Credentials = { tokens: AgentToken[]; token?: string };
export function AgentAccess() {
  const { t, language, timeZone } = useLocale();
  const credentials = useRefresh<Credentials>("admin/agent-tokens");
  const mutation = useMutation();
  const [name, setName] = useState("");
  const [expires, setExpires] = useState("90");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function change(id?: string, event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await mutation.mutate<Credentials>(`admin/agent-tokens${id ? `/${id}` : ""}`, id ? "DELETE" : "POST", id ? undefined : { name, expiresInDays: Number(expires) });
      if (result.token) { setSecret(result.token); setName(""); }
      await credentials.refresh(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : t("No fue posible completar la operación.")); }
    finally { setBusy(false); }
  }
  const origin = window.location.origin;
  return <Panel title={t("Integraciones de análisis")} description={t("Credenciales privadas de solo lectura para consultar métricas, comprobaciones e incidentes mediante API o MCP. No permiten cambiar la configuración.")}>
    <div className="flex flex-col gap-6">
      <div className="break-all text-sm"><p>{t("API de análisis")}: <code>{origin}/api/v1/analytics</code></p><p>{t("Servidor MCP")}: <code>{`${origin}/mcp`}</code></p><p>{t("Especificación OpenAPI")}: <code>{origin}/api/v1/analytics/openapi.json</code></p></div>
      <p className="text-sm text-muted-foreground">{t("Usa Authorization: Bearer con una credencial. MCP requiere un cliente compatible con Streamable HTTP y encabezados personalizados; no incluye inicio de sesión OAuth interactivo.")}</p>
      <form className="flex flex-col gap-4" onSubmit={(event) => void change(undefined, event)}>
        <FieldGroup className="grid gap-4 sm:grid-cols-2">
          <FormField id="agent-token-name" label={t("Nombre de la credencial")}><Input id="agent-token-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required disabled={busy} /></FormField>
          <FormField id="agent-token-expiry" label={t("Vigencia (días)")}><Input id="agent-token-expiry" type="number" min={1} max={365} step={1} value={expires} onChange={(event) => setExpires(event.target.value)} required disabled={busy} /></FormField>
        </FieldGroup>
        <Button className="self-start" type="submit" disabled={busy}>{t("Crear credencial")}</Button>
      </form>
      {secret && <div className="flex flex-col gap-3 rounded-lg border p-4">
        <p className="text-sm">{t("Guardá esta credencial ahora. Solo se muestra al crearla.")}</p>
        <Input aria-label={t("Credencial creada")} readOnly value={secret} autoComplete="off" />
        <Button variant="outline" className="self-start" onClick={() => setSecret("")}>{t("Ocultar credencial")}</Button>
      </div>}
      <Notice message={error || credentials.error} destructive />
      <div className="flex flex-col divide-y">{credentials.data?.tokens.map((entry) => <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div><p className="text-sm font-medium">{entry.name}</p><p className="text-xs text-muted-foreground">{t("Vence: {date}", { date: date(entry.expires_at, language, timeZone) })}</p></div>
        <Button variant="outline" disabled={busy} onClick={() => void change(entry.id)}>{t("Revocar")}</Button>
      </div>)}</div>
    </div>
  </Panel>;
}
