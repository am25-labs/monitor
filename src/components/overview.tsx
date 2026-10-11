import { Link } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  TriangleAlert,
  Clock,
  Mail,
  Server
} from "lucide-react";
import { availability, date, type Snapshot } from "../lib/api";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "./ui/table";
import { Notice, Nothing, Panel } from "./common";
import { cn } from "../lib/utils";

export function Overview({
  data,
  busy,
  onRetry
}: {
  data: Snapshot;
  busy: boolean;
  onRetry: (id: string) => Promise<void>;
}) {
  const up = data.monitors.filter((m) => m.display_status === "up").length;
  const down = data.monitors.filter((m) => m.display_status === "down").length;
  const open = data.incidents.filter((i) => !i.closed_at).length;
  const allUp = data.monitors.length > 0 && up === data.monitors.length;
  const needsAttention = data.monitors.length > 0 && !allUp && down === 0;
  const failed = data.notifications.filter((n) => n.state === "failed").length;
  const states = [
    {
      title: "Monitores",
      value: data.monitors.length,
      description: `${data.projects.length} proyectos · ${data.groups.length} grupos`,
      icon: Activity
    },
    {
      title: "Operativos",
      value: up,
      description: down
        ? `${down} con fallos`
        : `${data.monitors.length - up} en otros estados`,
      icon: CheckCircle2
    },
    {
      title: "Incidentes abiertos",
      value: open,
      description: "Según los umbrales de cada monitor",
      icon: TriangleAlert
    },
    {
      title: "Disponibilidad · 30 días",
      value: availability(data.stats),
      description: "Calculada sobre el tiempo observado",
      icon: Clock
    }
  ];
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            <Activity
              className={cn(
                "size-4",
                allUp && "text-success",
                needsAttention && "text-warning",
                down > 0 && "text-destructive"
              )}
            />
            {!data.monitors.length
              ? "Comenzá a monitorear tu infraestructura"
              : down
                ? "Hay servicios que requieren atención"
                : allUp
                  ? "Todos los servicios están operativos"
                  : "Monitoreo en curso"}
          </CardTitle>
          <CardDescription>
            Estado actual de tus servicios. La disponibilidad incluye las
            comprobaciones anteriores.
          </CardDescription>
          <CardAction className="col-start-1 row-start-3 justify-self-start sm:col-start-2 sm:row-start-1 sm:justify-self-end">
            <Badge
              variant={down > 0 ? "destructive" : "outline"}
              className={cn(
                allUp && "text-success",
                needsAttention && "text-warning"
              )}
            >
              {up} de {data.monitors.length} operativos
            </Badge>
          </CardAction>
        </CardHeader>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {states.map((stat) => (
          <Card key={stat.title} size="sm">
            <CardHeader>
              <CardTitle>{stat.title}</CardTitle>
              <CardAction>
                <stat.icon className="size-4 text-muted-foreground" />
              </CardAction>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold tracking-tight tabular-nums">
                {stat.value}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                {stat.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <EngineHealth data={data} />
        <Panel
          title="Incidentes recientes"
          description="Caídas y recuperaciones de tus servicios."
        >
          {data.incidents.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Monitor</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Inicio</TableHead>
                  <TableHead>Recuperación</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.incidents.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>
                      <Link
                        className="font-medium hover:underline"
                        to={`/app/monitors/${i.monitor_id}`}
                      >
                        {i.monitor_name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          i.closed_at ? "text-success" : "text-destructive"
                        }
                      >
                        {i.closed_at ? "Resuelto" : "Abierto"}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {date(i.opened_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {i.closed_at ? date(i.closed_at) : "En curso"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Nothing
              title="Sin incidentes"
              description="Las caídas y recuperaciones aparecerán aquí."
            />
          )}
        </Panel>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="size-4" />
            Alertas personales
          </CardTitle>
          <CardDescription>
            Notificaciones de apertura y recuperación, solo para vos.
          </CardDescription>
          <CardAction>
            <Badge
              variant="outline"
              className={failed ? "text-destructive" : undefined}
            >
              {failed
                ? `${failed} fallidas`
                : data.notifications.length
                  ? `${data.notifications.length} pendientes`
                  : "Sin pendientes"}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs text-muted-foreground">Destinatario</dt>
                <dd className="break-all">{data.settings.ownerEmail}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Remitente</dt>
                <dd className="break-all">{data.settings.from}</dd>
              </div>
            </dl>
            {data.notifications.length ? (
              <div className="flex flex-col gap-3 border-t pt-4">
                {data.notifications.map((n) => (
                  <div
                    key={n.id}
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <div>
                      <p className="font-medium">{n.monitor_name}</p>
                      <p className="text-xs text-muted-foreground">
                        {n.state === "failed" ? "Entrega fallida" : "Pendiente"}{" "}
                        · {n.attempts} intentos
                      </p>
                      {n.error && (
                        <p className="text-xs text-muted-foreground">
                          {n.error}
                        </p>
                      )}
                    </div>
                    {n.state === "failed" && (
                      <Button
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void onRetry(n.id).catch(() => undefined)
                        }
                      >
                        Reintentar
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No hay correos pendientes o fallidos.
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
function EngineHealth({ data }: { data: Snapshot }) {
  const stale = Boolean(
    data.engine.last_finished &&
    Date.now() / 1000 - data.engine.last_finished > 180
  );
  const unhealthy = stale || Boolean(data.engine.last_error);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="size-4" />
          Salud del motor
        </CardTitle>
        <CardAction>
          <Badge
            variant="outline"
            className={
              unhealthy
                ? "text-destructive"
                : data.engine.last_finished
                  ? "text-success"
                  : undefined
            }
          >
            {unhealthy
              ? "Revisar"
              : data.engine.last_finished
                ? "Activo"
                : "En espera"}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <dl className="flex flex-col gap-4">
            <div>
              <dt className="text-xs text-muted-foreground">
                Último ciclo completado
              </dt>
              <dd>{date(data.engine.last_finished)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                Trabajos pendientes
              </dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {data.backlog.total}
              </dd>
              {data.backlog.total > 0 && (
                <dd className="text-xs text-muted-foreground">
                  Más antiguo: {date(data.backlog.oldest)}
                </dd>
              )}
            </div>
          </dl>
          <Notice message={data.engine.last_error ?? ""} destructive />
          {stale && (
            <Notice
              message="El motor no ha completado un ciclo recientemente. Los estados pueden estar desactualizados."
              destructive
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
