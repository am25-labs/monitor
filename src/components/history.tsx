import { useLocale } from "../lib/locale";
import { parseDateTime, utcDay } from "../shared/time";
import { DatePicker } from "./date-picker";
import { ConfirmDialog } from "./confirm-dialog";
import { useState } from "react";
import { useRefresh } from "../lib/api";
import { useMutation } from "../lib/mutations";
import type { Result, SafeMonitor, Stat } from "../shared/types";
import { FormField, Notice, Nothing, Panel } from "./common";
import { FieldGroup } from "./ui/field";
import { Input } from "./ui/input";
import { Button } from "./ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "./ui/table";

interface HistoryData {
  results: Result[];
  nextCursor: number | null;
  stats: Stat[];
}
export function History({ monitor }: { monitor: SafeMonitor }) {
  const mutation = useMutation();
  const { t, date, availability, timeZone, timeZoneLabel, language } = useLocale();
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [cursor, setCursor] = useState<number | null>(null),
    [trail, setTrail] = useState<(number | null)[]>([]);
  const params = new URLSearchParams();
  const fromTime = from ? parseDateTime(`${from}T00:00:00`, timeZone) : undefined;
  const toTime = to ? parseDateTime(`${to}T23:59:59`, timeZone) : undefined;
  const invalidRange = fromTime === null || toTime === null;
  if (fromTime != null)
    params.set(
      "from",
      String(fromTime)
    );
  if (toTime != null)
    params.set(
      "to",
      String(toTime)
    );
  if (cursor) params.set("cursor", String(cursor));
  const { data, error } = useRefresh<HistoryData>(
    invalidRange ? "" : `admin/monitors/${monitor.id}/results?${params}`
  );
  const [token, setToken] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmOpen, setConfirmOpen] = useState(false);
  async function regenerate() {
    setBusy(true);
    try {
      setToken(
        (
          await mutation.mutate<{ token: string }>(
            `admin/monitors/${monitor.id}/token`,
            "POST",
            {}
          )
        ).token
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : t("Falló la operación."));
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setCursor(null);
    setTrail([]);
  }
  return (
    <div className="flex flex-col gap-6">
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("¿Regenerar el token?")}
        description={t(
          "El token anterior dejará de funcionar. Actualiza el servicio que envía tus heartbeats con el token nuevo."
        )}
        action={t("Regenerar token")}
        onConfirm={regenerate}
      />

      {monitor.kind === "heartbeat" && (
        <Panel
          title={t("Reportar heartbeat")}
          description={t(
            "El token se muestra únicamente al crearlo o regenerarlo."
          )}
        >
          <div className="flex flex-col gap-3">
            <p className="break-all font-mono text-xs">
              POST {location.origin}/api/v1/heartbeats/{monitor.id}
            </p>
            <p>
              {t("Encabezados:")} Authorization: Bearer TOKEN · Content-Type:
              application/json
            </p>
            <p className="font-mono text-xs">{'{"ok":true}'}</p>
            <Button
              variant="outline"
              onClick={() => setConfirmOpen(true)}
              disabled={busy}
            >
              {t("Regenerar token")}
            </Button>
            {token && (
              <Input
                aria-label={t("Token nuevo de heartbeat")}
                readOnly
                value={token}
              />
            )}
            <Notice message={notice} />
          </div>
        </Panel>
      )}
      <Panel
        title={t("Historial completo")}
        description={t(
          "Comprobaciones individuales disponibles durante seis meses. Zona horaria: {zone}.", { zone: timeZoneLabel }
        )}
      >
        <div className="flex flex-col gap-4">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <FormField label={t("Desde")} id="history-from">
              <DatePicker
                id="history-from"
                value={from}
                onChange={(value) => {
                  setFrom(value);
                  reset();
                }}
              />
            </FormField>
            <FormField label={t("Hasta")} id="history-to">
              <DatePicker
                id="history-to"
                value={to}
                onChange={(value) => {
                  setTo(value);
                  reset();
                }}
              />
            </FormField>
          </FieldGroup>
          <Notice message={invalidRange ? t("La fecha u hora no existe en la zona horaria seleccionada.") : error} destructive />
          {data && (
            <>
              <p>
                {t("Disponibilidad del rango:")}{" "}
                <strong>{availability(data.stats)}</strong>
              </p>
              {data.results.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("Fecha")}</TableHead>
                      <TableHead>{t("Resultado")}</TableHead>
                      <TableHead>{t("Latencia")}</TableHead>
                      <TableHead>{t("Diagnóstico")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.results.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">
                          {date(r.checked_at)}
                        </TableCell>
                        <TableCell>
                          {r.ok ? r.degraded ? t("Degradado") : t("Éxito") : t("Fallo")}
                          {r.maintenance ? t(" · mantenimiento") : ""}
                        </TableCell>
                        <TableCell>
                          {r.latency === null ? "—" : `${r.latency} ms`}
                        </TableCell>
                        <TableCell>
                          {t(r.diagnostic)}
                          {r.code !== null ? ` (${r.code})` : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Nothing
                  description={t("No hay comprobaciones en este rango.")}
                />
              )}
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={!trail.length}
                  onClick={() => {
                    setCursor(trail[trail.length - 1]);
                    setTrail(trail.slice(0, -1));
                  }}
                >
                  {t("Anterior")}
                </Button>
                <Button
                  variant="outline"
                  disabled={!data.nextCursor}
                  onClick={() => {
                    setTrail([...trail, cursor]);
                    setCursor(data.nextCursor);
                  }}
                >
                  {t("Siguiente")}
                </Button>
              </div>
            </>
          )}
        </div>
      </Panel>
      {data?.stats.length !== 0 && (
        <Panel
          title={t("Resumen diario")}
          description={t(
            "Disponibilidad y latencia promedio de comprobaciones exitosas."
          )}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("Día (UTC)")}</TableHead>
                <TableHead>{t("Disponibilidad")}</TableHead>
                <TableHead>{t("Comprobaciones")}</TableHead>
                <TableHead>{t("Latencia media")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.stats
                .slice()
                .reverse()
                .map((s) => (
                  <TableRow key={s.day}>
                    <TableCell>{utcDay(s.day, language)}</TableCell>
                    <TableCell>{availability([s])}</TableCell>
                    <TableCell>{s.check_count}</TableCell>
                    <TableCell>
                      {s.latency_count
                        ? `${Math.round(s.latency_sum / s.latency_count)} ms`
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </Panel>
      )}
    </div>
  );
}
