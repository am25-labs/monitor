import { useState } from "react";
import { api, availability, date, useRefresh } from "../lib/api";
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
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [cursor, setCursor] = useState<number | null>(null),
    [trail, setTrail] = useState<(number | null)[]>([]);
  const params = new URLSearchParams();
  if (from)
    params.set(
      "from",
      String(Math.floor(new Date(`${from}T00:00:00`).getTime() / 1000))
    );
  if (to)
    params.set(
      "to",
      String(Math.floor(new Date(`${to}T23:59:59`).getTime() / 1000))
    );
  if (cursor) params.set("cursor", String(cursor));
  const { data, error } = useRefresh<HistoryData>(
    `admin/monitors/${monitor.id}/results?${params}`
  );
  const [token, setToken] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function regenerate() {
    if (!confirm("Esto invalida el token anterior. ¿Regenerar?")) return;
    setBusy(true);
    try {
      setToken(
        (
          await api<{ token: string }>(
            `admin/monitors/${monitor.id}/token`,
            "POST",
            {}
          )
        ).token
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Falló la operación.");
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
      {monitor.kind === "heartbeat" && (
        <Panel
          title="Reportar heartbeat"
          description="El token se muestra únicamente al crearlo o regenerarlo."
        >
          <div className="flex flex-col gap-3">
            <p className="break-all font-mono text-xs">
              POST {location.origin}/api/v1/heartbeats/{monitor.id}
            </p>
            <p>
              Headers: Authorization: Bearer TOKEN · Content-Type:
              application/json
            </p>
            <p className="font-mono text-xs">{'{"ok":true}'}</p>
            <Button
              variant="outline"
              onClick={() => void regenerate()}
              disabled={busy}
            >
              Regenerar token
            </Button>
            {token && (
              <Input
                aria-label="Token nuevo de heartbeat"
                readOnly
                value={token}
              />
            )}
            <Notice message={notice} />
          </div>
        </Panel>
      )}
      <Panel
        title="Historial completo"
        description="Comprobaciones individuales disponibles durante seis meses. Fechas en tu hora local."
      >
        <div className="flex flex-col gap-4">
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <FormField label="Desde" id="history-from">
              <Input
                id="history-from"
                type="date"
                value={from}
                onChange={(e) => {
                  setFrom(e.target.value);
                  reset();
                }}
              />
            </FormField>
            <FormField label="Hasta" id="history-to">
              <Input
                id="history-to"
                type="date"
                value={to}
                onChange={(e) => {
                  setTo(e.target.value);
                  reset();
                }}
              />
            </FormField>
          </FieldGroup>
          <Notice message={error} destructive />
          {data && (
            <>
              <p>
                Disponibilidad del rango:{" "}
                <strong>{availability(data.stats)}</strong>
              </p>
              {data.results.length ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Resultado</TableHead>
                      <TableHead>Latencia</TableHead>
                      <TableHead>Diagnóstico</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.results.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="whitespace-nowrap">
                          {date(r.checked_at)}
                        </TableCell>
                        <TableCell>
                          {r.ok ? "Éxito" : "Fallo"}
                          {r.maintenance ? " · mantenimiento" : ""}
                        </TableCell>
                        <TableCell>
                          {r.latency === null ? "—" : `${r.latency} ms`}
                        </TableCell>
                        <TableCell>
                          {r.diagnostic}
                          {r.code !== null ? ` (${r.code})` : ""}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <Nothing description="No hay comprobaciones en este rango." />
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
                  Anterior
                </Button>
                <Button
                  variant="outline"
                  disabled={!data.nextCursor}
                  onClick={() => {
                    setTrail([...trail, cursor]);
                    setCursor(data.nextCursor);
                  }}
                >
                  Siguiente
                </Button>
              </div>
            </>
          )}
        </div>
      </Panel>
      {data?.stats.length !== 0 && (
        <Panel
          title="Resumen diario"
          description="Disponibilidad y latencia promedio de comprobaciones exitosas."
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Día</TableHead>
                <TableHead>Disponibilidad</TableHead>
                <TableHead>Comprobaciones</TableHead>
                <TableHead>Latencia media</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.stats
                .slice()
                .reverse()
                .map((s) => (
                  <TableRow key={s.day}>
                    <TableCell>{s.day}</TableCell>
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
