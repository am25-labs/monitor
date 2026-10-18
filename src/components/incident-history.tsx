import { useState } from "react";
import { Link } from "react-router-dom";
import { useRefresh } from "../lib/api";
import { useLocale } from "../lib/locale";
import type { IncidentHistory as HistoryData } from "../shared/types";
import { Notice, Nothing, Panel } from "./common";
import { Badge } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

export function IncidentHistory() {
  const { t, date } = useLocale();
  const [cursor, setCursor] = useState<HistoryData["nextCursor"]>(null);
  const [trail, setTrail] = useState<HistoryData["nextCursor"][]>([]);
  const params = new URLSearchParams();
  if (cursor) {
    params.set("before", String(cursor.opened_at));
    params.set("id", cursor.id);
  }
  const { data, error, loading } = useRefresh<HistoryData>(`admin/incident-history?${params}`);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Link to="/app/" className={buttonVariants({ variant: "outline", className: "self-start" })}>{t("Volver al resumen")}</Link>
      <Panel title={t("Historial de incidentes")} description={t("Todas las caídas y recuperaciones conservadas, de más recientes a más antiguas. Hasta 50 registros por página.")}>
        <div className="flex flex-col gap-4">
          <Notice message={error} destructive />
          {!data && !error && <Skeleton className="h-64 w-full" />}
          {data && (data.incidents.length ? <Table>
            <TableHeader><TableRow>
              <TableHead>{t("Monitor")}</TableHead><TableHead>{t("Estado")}</TableHead>
              <TableHead>{t("Inicio")}</TableHead><TableHead>{t("Recuperación")}</TableHead>
            </TableRow></TableHeader>
            <TableBody>{data.incidents.map((incident) => <TableRow key={incident.id}>
              <TableCell><Link className="font-medium hover:underline" to={`/app/monitors/${incident.monitor_id}`}>{incident.monitor_name}</Link></TableCell>
              <TableCell><Badge variant="outline" className={incident.closed_at !== null ? "text-success" : "text-destructive"}>{t(incident.closed_at !== null ? "Resuelto" : "Abierto")}</Badge></TableCell>
              <TableCell className="whitespace-nowrap">{date(incident.opened_at)}</TableCell>
              <TableCell className="whitespace-nowrap">{incident.closed_at !== null ? date(incident.closed_at) : t("En curso")}</TableCell>
            </TableRow>)}</TableBody>
          </Table> : <Nothing title={t("Sin incidentes")} description={t("Las caídas y recuperaciones aparecerán aquí.")} />)}
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" disabled={loading || !trail.length} onClick={() => {
              setCursor(trail[trail.length - 1]);
              setTrail(trail.slice(0, -1));
            }}>{t("Anterior")}</Button>
            <Button variant="outline" disabled={loading || !data?.nextCursor || Boolean(error)} onClick={() => {
              if (!data?.nextCursor) return;
              setTrail([...trail, cursor]);
              setCursor(data.nextCursor);
            }}>{t("Siguiente")}</Button>
          </div>
        </div>
      </Panel>
    </div>
  );
}
