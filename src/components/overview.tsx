import { useLocale } from "../lib/locale";
import { Link } from "react-router-dom";
import {
  Activity,
  CheckCircle2,
  TriangleAlert,
  Clock,
  Mail,
  Server
} from "lucide-react";
import { type Snapshot } from "../lib/api";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "./ui/card";
import { Badge } from "./ui/badge";
import { Button, buttonVariants } from "./ui/button";
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
import { MetricCharts } from "./metric-charts";

export function Overview({
  data,
  busy,
  onRetry
}: {
  data: Snapshot;
  busy: boolean;
  onRetry: (id: string) => Promise<void>;
}) {
  const { t, date, availability } = useLocale();
  const up = data.monitors.filter((m) => m.display_status === "up").length;
  const down = data.monitors.filter((m) => m.display_status === "down").length;
  const unknown = data.monitors.filter((m) => m.display_status === "unknown").length;
  const degraded = data.monitors.filter((m) => m.display_status === "degraded").length;
  const open = data.incidents.filter((i) => !i.closed_at).length;
  const allUp = data.monitors.length > 0 && up === data.monitors.length;
  const needsAttention = data.monitors.length > 0 && !allUp && down === 0;
  const failed = data.notifications.filter((n) => n.state === "failed").length;
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.parse(`${end}T00:00:00Z`) - 29 * 86400000).toISOString().slice(0, 10);
  const stats = data.stats.filter((stat) => stat.day >= start && stat.day <= end);
  const states = [
    {
      title: t("Monitores"),
      value: data.monitors.length,
      description: t("{projects} proyectos · {groups} grupos", {
        projects: data.projects.length,
        groups: data.groups.length
      }),
      icon: Activity
    },
    {
      title: t("Operativos"),
      value: up,
      description: down
        ? t("{count} con fallos", { count: down })
        : t("{count} en otros estados", { count: data.monitors.length - up }),
      icon: CheckCircle2
    },
    {
      title: t("Incidentes abiertos"),
      value: open,
      description: t("Según los umbrales de cada monitor"),
      icon: TriangleAlert
    },
    {
      title: t("Disponibilidad · 30 días"),
      value: availability(stats),
      description: t("Calculada sobre el tiempo observado"),
      icon: Clock
    }
  ];
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-2">
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
                ? t("Comienza a monitorear tu infraestructura")
                : down
                  ? t("Hay servicios que requieren atención")
                  : degraded
                    ? t("Hay servicios degradados")
                    : unknown
                      ? t("Hay monitores sin datos recientes")
                      : allUp
                        ? t("Todos los servicios están operativos")
                        : t("Monitoreo en curso")}
            </CardTitle>
            <CardDescription>
              {t(
                "Estado actual de tus servicios. La disponibilidad incluye las comprobaciones anteriores."
              )}
            </CardDescription>
            <CardAction className="col-start-1 row-start-3 justify-self-start sm:col-start-2 sm:row-start-1 sm:justify-self-end">
              <Badge
                variant={down > 0 ? "destructive" : "outline"}
                className={cn(
                  allUp && "text-success",
                  needsAttention && "text-warning"
                )}
              >
                {t("{up} de {total} operativos", {
                  up,
                  total: data.monitors.length
                })}
              </Badge>
            </CardAction>
          </CardHeader>
        </Card>
        <EngineHealth data={data} />
      </div>
      {unknown > 0 && <Notice message={t("{count} monitores no tienen comprobaciones recientes. Su estado actual no está confirmado; esto no indica una degradación del servicio.", { count: unknown })} />}
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
      <div className="flex min-w-0 flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("Últimos 30 días en UTC. El día actual está en curso.")}</p>
        <MetricCharts stats={stats} start={start} end={end} />
        <Link to="/app/metrics" className={buttonVariants({ variant: "outline", className: "self-end" })}>{t("Ver todas las métricas")}</Link>
      </div>
      <div className="grid items-stretch gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          title={t("Incidentes recientes")}
          description={t("Las 10 caídas más recientes y su recuperación.")}
        >
          {data.incidents.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("Monitor")}</TableHead>
                  <TableHead>{t("Estado")}</TableHead>
                  <TableHead>{t("Inicio")}</TableHead>
                  <TableHead>{t("Recuperación")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.incidents.slice(0, 10).map((i) => (
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
                        {i.closed_at ? t("Resuelto") : t("Abierto")}
                      </Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {date(i.opened_at)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {i.closed_at ? date(i.closed_at) : t("En curso")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Nothing
              title={t("Sin incidentes")}
              description={t("Las caídas y recuperaciones aparecerán aquí.")}
            />
          )}
          <div className="mt-4 flex justify-end">
            <Link to="/app/incident-history" className={buttonVariants({ variant: "outline" })}>{t("Ver todos los incidentes")}</Link>
          </div>
        </Panel>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="size-4" />
              {t("Alertas personales")}
            </CardTitle>
            <CardDescription>
              {t("Notificaciones de apertura y recuperación, solo para ti.")}
            </CardDescription>
            <CardAction>
              <Badge
                variant="outline"
                className={failed ? "text-destructive" : undefined}
              >
                {failed
                  ? t("{count} fallidas", { count: failed })
                  : data.notifications.length
                    ? t("{count} pendientes", {
                        count: data.notifications.length
                      })
                    : t("Sin pendientes")}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                {(["email", "telegram", "pushover", "ntfy"] as const)
                  .filter(
                    (channel) => data.settings.notifications[channel].enabled
                  )
                  .map((channel) => (
                    <Badge key={channel} variant="outline">
                      {channel === "email"
                        ? t("Correo · Postmark")
                        : channel === "telegram"
                          ? "Telegram"
                          : channel === "pushover"
                            ? "Pushover"
                            : "ntfy"}
                    </Badge>
                  ))}
                {!Object.values(data.settings.notifications).some(
                  (value) => typeof value === "object" && value.enabled
                ) && (
                  <span className="text-sm text-muted-foreground">
                    {t("Sin canales activos")}
                  </span>
                )}
              </div>
              {data.notifications.length ? (
                <div className="flex flex-col gap-3 border-t pt-4">
                  {data.notifications.map((n) => (
                    <div
                      key={`${n.id}:${n.channel ?? "unconfigured"}`}
                      className="flex flex-wrap items-center justify-between gap-3"
                    >
                      <div>
                        <p className="font-medium">{n.monitor_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {n.state === "failed"
                            ? t("Entrega fallida")
                            : t("Pendiente")}{" "}
                          · {n.channel ?? t("Sin canal")} · {n.attempts}{" "}
                          {t("intentos")}
                        </p>
                        {n.error && (
                          <p className="text-xs text-muted-foreground">
                            {t(n.error)}
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
                          {t("Reintentar")}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {t("No hay notificaciones pendientes o fallidas.")}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
function EngineHealth({ data }: { data: Snapshot }) {
  const { t, date, availability } = useLocale();
  const stale = Boolean(
    data.engine.last_finished &&
      Date.now() / 1000 - data.engine.last_finished > 180
  );
  const unhealthy = stale || Boolean(data.engine.last_error);
  const delayed = data.monitors.some((monitor) => monitor.display_status === "unknown" && monitor.last_checked !== null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Server className="size-4" />
          {t("Salud del motor")}
        </CardTitle>
        <CardAction>
          <Badge
            variant="outline"
            className={
              unhealthy
                ? "text-destructive"
                : delayed
                  ? "text-warning"
                  : data.engine.last_finished
                    ? "text-success"
                    : undefined
            }
          >
            {unhealthy
              ? t("Revisar")
              : delayed
                ? t("Comprobaciones atrasadas")
                : data.engine.last_finished
                  ? t("Activo")
                  : t("En espera")}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <dl className="flex flex-col gap-4">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("Último ciclo completado")}
              </dt>
              <dd>{date(data.engine.last_finished)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("Trabajos pendientes")}
              </dt>
              <dd className="text-2xl font-semibold tabular-nums">
                {data.backlog.total}
              </dd>
              {data.backlog.total > 0 && (
                <dd className="text-xs text-muted-foreground">
                  {t("Más antiguo:")} {date(data.backlog.oldest)}
                </dd>
              )}
            </div>
          </dl>
          <Notice message={data.engine.last_error ?? ""} destructive />
          {stale && (
            <Notice
              message={t(
                "El motor no ha completado un ciclo recientemente. Los estados pueden estar desactualizados."
              )}
              destructive
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
