import { first, rows, statement } from "./db";
import { createElement } from "react";
import { render } from "react-email";
import { MonitorAlertEmail } from "../templates/mail/monitor-alert";
import { reasons } from "./checks";

interface Notification {
  id: string;
  event: string;
  monitor_name: string;
  attempts: number;
  created_at: number;
  monitor_id: string | null;
  project_name: string | null;
  group_name: string | null;
  kind: string | null;
  opened_at: number | null;
  closed_at: number | null;
  reason: string | null;
}
function mailDate(timestamp: number) {
  return `${new Intl.DateTimeFormat("es-SV", {
    timeZone: "America/El_Salvador",
    dateStyle: "long",
    timeStyle: "short"
  }).format(new Date(timestamp * 1000))} (El Salvador, UTC−6)`;
}
function duration(seconds: number) {
  const days = Math.floor(seconds / 86400),
    hours = Math.floor((seconds % 86400) / 3600),
    minutes = Math.floor((seconds % 3600) / 60),
    remaining = seconds % 60;
  return (
    [
      [days, "d"],
      [hours, "h"],
      [minutes, "min"],
      [remaining, "s"]
    ]
      .filter(([value]) => value !== 0)
      .map(([value, unit]) => `${value} ${unit}`)
      .join(" ") || "0 s"
  );
}
export async function mailBody(n: Notification, origin: string) {
  const event =
    n.event === "opened" ? "Caída detectada" : "Servicio recuperado";
  const recovered = n.event === "recovered";
  const base = origin.replace(/\/+$/, "");
  const url = n.monitor_id
    ? `${base}/app/monitors/${encodeURIComponent(n.monitor_id)}`
    : `${base}/app/`;
  const fields = [
    {
      label: "Estado del evento",
      value: recovered ? "Recuperado" : "Caída detectada"
    },
    { label: "Proyecto", value: n.project_name ?? "Sin proyecto disponible" },
    { label: "Grupo", value: n.group_name ?? "Sin grupo" },
    {
      label: "Tipo",
      value:
        n.kind === "heartbeat"
          ? "Heartbeat"
          : (n.kind?.toUpperCase() ?? "Sin datos")
    },
    {
      label: "Inicio del incidente",
      value: mailDate(n.opened_at ?? n.created_at)
    },
    {
      label: "Motivo de la caída",
      value: reasons[n.reason ?? ""] ?? "El servicio no pasó la comprobación"
    }
  ];
  if (recovered) {
    const closed = n.closed_at ?? n.created_at;
    fields.push({ label: "Recuperación", value: mailDate(closed) });
    if (n.opened_at != null)
      fields.push({
        label: "Duración del incidente",
        value: duration(Math.max(0, closed - n.opened_at))
      });
  }
  const subject = `[Monitor] ${event}: ${n.monitor_name}`;
  return {
    Subject: subject,
    TextBody: `${event}: ${n.monitor_name}\n\n${fields.map(({ label, value }) => `${label}: ${value}`).join("\n")}\n\nVer monitor: ${url}`,
    HtmlBody: await render(
      createElement(MonitorAlertEmail, {
        title: event,
        subject,
        monitor: n.monitor_name,
        fields,
        url,
        fontUrl: `${base}/assets/fonts/MartianMono.ttf`,
        recovered
      })
    )
  };
}
export async function deliverNotifications(
  env: Env,
  now: number,
  fetcher: typeof fetch = fetch
) {
  const pending = await rows<Notification>(
    env.DB,
    "SELECT n.*,i.monitor_id,i.opened_at,i.closed_at,i.reason,m.kind,p.name AS project_name,g.name AS group_name FROM notifications n LEFT JOIN incidents i ON i.id=n.incident_id LEFT JOIN monitors m ON m.id=i.monitor_id LEFT JOIN projects p ON p.id=m.project_id LEFT JOIN groups g ON g.id=m.group_id WHERE (n.state='pending' AND n.next_attempt<=?) OR (n.state='sending' AND n.lease_until<?) LIMIT 20",
    now,
    now
  );
  for (const n of pending) {
    const lease = crypto.randomUUID();
    const claimed = await first<{ id: string }>(
      env.DB,
      "UPDATE notifications SET state='sending',lease_token=?,lease_until=? WHERE id=? AND ((state='pending' AND next_attempt<=?) OR (state='sending' AND lease_until<?)) RETURNING id",
      lease,
      now + 60,
      n.id,
      now,
      now
    );
    if (!claimed) continue;
    try {
      if (env.ENVIRONMENT !== "local") {
        if (!env.POSTMARK_TOKEN || !env.OWNER_EMAIL || !env.POSTMARK_FROM)
          throw new Error("unconfigured");
        const response = await fetcher("https://api.postmarkapp.com/email", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Postmark-Server-Token": env.POSTMARK_TOKEN
          },
          body: JSON.stringify({
            From: env.POSTMARK_FROM,
            To: env.OWNER_EMAIL,
            MessageStream: env.POSTMARK_STREAM,
            ...(await mailBody(n, env.APP_ORIGIN)),
            TrackOpens: false,
            TrackLinks: "None"
          }),
          signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(
            response.status >= 400 &&
              response.status < 500 &&
              response.status !== 429
              ? "permanent"
              : "temporary"
          );
        }
        const data = (await response.json()) as { ErrorCode: number };
        if (data.ErrorCode !== 0) throw new Error("permanent");
      } else
        console.info(
          JSON.stringify({ event: "mail_intercepted", notificationId: n.id })
        );
      await statement(
        env.DB,
        "UPDATE notifications SET state='sent',delivered_at=?,error=NULL,lease_until=NULL WHERE id=? AND lease_token=?",
        now,
        n.id,
        lease
      ).run();
    } catch (error) {
      const attempts = n.attempts + 1,
        final =
          attempts >= 8 ||
          (error instanceof Error && error.message === "permanent");
      await statement(
        env.DB,
        "UPDATE notifications SET state=?,attempts=?,next_attempt=?,error=?,lease_until=NULL WHERE id=? AND lease_token=?",
        final ? "failed" : "pending",
        attempts,
        now + Math.min(3600, 60 * 2 ** attempts),
        final
          ? "No se pudo entregar el correo."
          : "Entrega pendiente de reintento.",
        n.id,
        lease
      ).run();
    }
  }
}
