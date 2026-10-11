import { notificationConfig } from "./settings";
import type { NotificationConfig } from "../shared/settings";
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
async function sendNotification(
  env: Env,
  config: NotificationConfig,
  n: Notification,
  fetcher: typeof fetch
) {
  if (env.ENVIRONMENT === "local") {
    console.info(
      JSON.stringify({
        event: "notification_intercepted",
        channel: config.channel,
        notificationId: n.id
      })
    );
    return;
  }
  const content = await mailBody(n, env.APP_ORIGIN);
  let response: Response;
  if (config.channel === "email") {
    if (!config.email.token || !config.email.to || !config.email.from)
      throw new Error("unconfigured");
    response = await fetcher("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": config.email.token
      },
      body: JSON.stringify({
        From: config.email.from,
        To: config.email.to,
        MessageStream: config.email.stream,
        ...content,
        TrackOpens: false,
        TrackLinks: "None"
      }),
      signal: AbortSignal.timeout(10000)
    });
  } else {
    if (
      !/^\d+:[A-Za-z0-9_-]+$/.test(config.telegram.token) ||
      !config.telegram.chatId
    )
      throw new Error("unconfigured");
    response = await fetcher(
      `https://api.telegram.org/bot${config.telegram.token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.telegram.chatId,
          text: content.TextBody.slice(0, 4096),
          link_preview_options: { is_disabled: true }
        }),
        signal: AbortSignal.timeout(10000)
      }
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status >= 400 && response.status < 500 && response.status !== 429
        ? "permanent"
        : "temporary"
    );
  }
  const data = (await response.json()) as {
    ErrorCode?: number;
    ok?: boolean;
    error_code?: number;
  };
  if (config.channel === "email" ? data.ErrorCode !== 0 : data.ok !== true)
    throw new Error(
      data.error_code === 429 || (data.error_code ?? 0) >= 500
        ? "temporary"
        : "permanent"
    );
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
      const { config } = await notificationConfig(env);
      await sendNotification(env, config, n, fetcher);
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
          ? "No se pudo entregar la notificación."
          : "Entrega pendiente de reintento.",
        n.id,
        lease
      ).run();
    }
  }
}
