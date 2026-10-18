import { useState } from "react";
import { useLocale } from "../lib/locale";
import { useMutation } from "../lib/mutations";
import type { ProviderOutageState } from "../shared/provider-outage";
import { Notice, Panel } from "./common";
import { Button } from "./ui/button";

export function ProviderOutageControl({ state, error, hasMonitors }: {
  state: ProviderOutageState | null;
  error: string;
  hasMonitors: boolean;
}) {
  const { t, date } = useLocale();
  const mutation = useMutation();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const outage = state?.outage;
  async function toggle() {
    if (!state) return;
    setBusy(true);
    setNotice("");
    try {
      await mutation.mutate("admin/incidents/provider", "PUT", outage ? { enabled: false, id: outage.id } : { enabled: true });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : t("Falló la operación."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Panel title={t("Proveedor de infraestructura")}>
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {t("Publica un incidente para todos los monitores y pausa las alertas de caída, incluidos los reintentos y las repeticiones de emergencia. Las comprobaciones continúan y las recuperaciones se siguen notificando.")}
        </p>
        {outage && <p className="text-sm">{t("Incidente del proveedor activo desde {date}.", { date: date(outage.started_at) })}</p>}
        <Notice message={notice || error} destructive />
        <Button
          className="self-start"
          variant={outage ? "outline" : "default"}
          disabled={!state || busy || (!outage && !hasMonitors)}
          onClick={() => void toggle()}
        >
          {t(outage ? "Finalizar incidente del proveedor" : "Activar incidente del proveedor")}
        </Button>
        {outage && <p className="text-xs text-muted-foreground">{t("Al finalizar, las alertas de caída vuelven a habilitarse. Los avisos silenciados no se reenvían.")}</p>}
      </div>
    </Panel>
  );
}
