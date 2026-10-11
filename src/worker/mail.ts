import { notificationConfig } from "./settings";
import {
  channels,
  type NotificationChannel,
  type NotificationConfig
} from "../shared/settings";
import { seal, unseal } from "./crypto";
import { first, rows, statement } from "./db";
import { createElement } from "react";
import { render } from "react-email";
import { MonitorAlertEmail } from "../templates/mail/monitor-alert";
import { reasons, readBounded } from "./checks";

interface Notification {
  id: string;
  incident_id: string;
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
export async function mailBody(
  n: Omit<Notification, "incident_id">,
  origin: string,
  includeHtml = true
) {
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
    HtmlBody: includeHtml
      ? await render(
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
      : ""
  };
}
async function providerResponse(response: Response) {
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      response.status >= 400 && response.status < 500 && response.status !== 429
        ? "permanent"
        : "temporary"
    );
  }
  return JSON.parse(await readBounded(response, 65536)) as {
    ErrorCode?: number;
    ok?: boolean;
    error_code?: number;
    status?: number;
    receipt?: string;
    id?: string;
  };
}
async function cancelEmergency(
  env: Env,
  n: Notification,
  fetcher: typeof fetch
) {
  const opening = await first(
    env.DB,
    "SELECT n.id FROM notifications n LEFT JOIN notification_deliveries d ON d.notification_id=n.id AND d.channel='pushover' WHERE n.incident_id=? AND n.event='opened' AND (n.state='sending' OR d.state='pending')",
    n.incident_id
  );
  if (opening) throw new Error("temporary");
  const active = await first<{
    notification_id: string;
    receipt: string;
    receipt_token: string;
  }>(
    env.DB,
    "SELECT d.notification_id,d.receipt,d.receipt_token FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.incident_id=? AND n.event='opened' AND d.receipt IS NOT NULL AND d.cancelled_at IS NULL",
    n.incident_id
  );
  if (!active) return;
  const token = await unseal<string>(
    active.receipt_token,
    env.CONFIG_KEY,
    `receipt:${active.notification_id}`
  );
  const data = await providerResponse(
    await fetcher(
      `https://api.pushover.net/1/receipts/${encodeURIComponent(active.receipt)}/cancel.json`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(10000)
      }
    )
  );
  if (data.status !== 1) throw new Error("temporary");
  await statement(
    env.DB,
    "UPDATE notification_deliveries SET cancelled_at=? WHERE notification_id=? AND channel='pushover'",
    n.created_at,
    active.notification_id
  ).run();
}
async function sendNotification(
  env: Env,
  config: NotificationConfig,
  channel: NotificationChannel,
  n: Notification,
  fetcher: typeof fetch
) {
  if (env.ENVIRONMENT === "local") {
    console.info(
      JSON.stringify({
        event: "notification_intercepted",
        channel,
        notificationId: n.id
      })
    );
    return {};
  }
  if (channel === "pushover" && n.event === "recovered")
    await cancelEmergency(env, n, fetcher);
  if (!config[channel].enabled) return {};
  if (n.event === "opened") {
    const incident = await first<{ closed_at: number | null }>(
      env.DB,
      "SELECT closed_at FROM incidents WHERE id=?",
      n.incident_id
    );
    n.closed_at = incident?.closed_at ?? n.closed_at;
  }
  const content = await mailBody(n, env.APP_ORIGIN, channel === "email");
  const url = `${env.APP_ORIGIN.replace(/\/+$/, "")}/app/monitors/${encodeURIComponent(n.monitor_id ?? "")}`;
  let response: Response;
  if (channel === "email") {
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
  } else if (channel === "telegram") {
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
  } else if (channel === "pushover") {
    const emergency =
      n.event === "opened" && n.closed_at === null && config.pushover.emergency;
    response = await fetcher("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: config.pushover.token,
        user: config.pushover.userKey,
        title: content.Subject.slice(0, 250),
        message: content.TextBody.slice(0, 1024),
        url,
        priority: emergency ? 2 : 0,
        ...(emergency
          ? {
              retry: config.pushover.retrySeconds,
              expire: config.pushover.expireSeconds
            }
          : {})
      }),
      signal: AbortSignal.timeout(10000)
    });
  } else {
    response = await fetcher(config.ntfy.server.replace(/\/+$/, ""), {
      method: "POST",
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        ...(config.ntfy.token
          ? { Authorization: `Bearer ${config.ntfy.token}` }
          : {})
      },
      body: JSON.stringify({
        topic: config.ntfy.topic,
        title: content.Subject.slice(0, 250),
        message: content.TextBody.slice(0, 4096),
        priority: n.event === "opened" && n.closed_at === null ? 5 : 3,
        click: url
      }),
      signal: AbortSignal.timeout(10000)
    });
  }
  const data = await providerResponse(response);
  const success =
    channel === "email"
      ? data.ErrorCode === 0
      : channel === "telegram"
        ? data.ok === true
        : channel === "pushover"
          ? data.status === 1
          : typeof data.id === "string";
  if (!success)
    throw new Error(
      data.error_code === 429 || (data.error_code ?? 0) >= 500
        ? "temporary"
        : "permanent"
    );
  if (
    channel === "pushover" &&
    n.event === "opened" &&
    !n.closed_at &&
    config.pushover.emergency &&
    !data.receipt
  )
    throw new Error("temporary");
  return channel === "pushover" && data.receipt
    ? {
        receipt: data.receipt,
        receiptToken: await seal(
          config.pushover.token,
          env.CONFIG_KEY,
          `receipt:${n.id}`
        )
      }
    : {};
}
interface Delivery {
  channel: NotificationChannel;
  state: string;
  attempts: number;
  next_attempt: number;
}
async function deliverChannel(
  env: Env,
  config: NotificationConfig,
  n: Notification,
  delivery: Delivery,
  now: number,
  fetcher: typeof fetch
) {
  try {
    const result = await sendNotification(
      env,
      config,
      delivery.channel,
      n,
      fetcher
    );
    await statement(
      env.DB,
      "UPDATE notification_deliveries SET state='sent',delivered_at=?,error=NULL,receipt=?,receipt_token=? WHERE notification_id=? AND channel=?",
      now,
      result.receipt ?? null,
      result.receiptToken ?? null,
      n.id,
      delivery.channel
    ).run();
  } catch (error) {
    const attempts = delivery.attempts + 1;
    const final =
      attempts >= 8 ||
      (error instanceof Error && error.message === "permanent");
    await statement(
      env.DB,
      "UPDATE notification_deliveries SET state=?,attempts=?,next_attempt=?,error=? WHERE notification_id=? AND channel=?",
      final ? "failed" : "pending",
      attempts,
      now + Math.min(3600, 60 * 2 ** attempts),
      final
        ? "No se pudo entregar la notificación."
        : "Entrega pendiente de reintento.",
      n.id,
      delivery.channel
    ).run();
  }
}
async function pendingDeliveries(
  env: Env,
  config: NotificationConfig,
  configured: boolean,
  n: Notification,
  now: number
) {
  let deliveries = await rows<Delivery>(
    env.DB,
    "SELECT channel,state,attempts,next_attempt FROM notification_deliveries WHERE notification_id=?",
    n.id
  );
  if (!deliveries.length && (configured || env.ENVIRONMENT === "local")) {
    const enabled = channels.filter((channel) => config[channel].enabled);
    if (!configured && env.ENVIRONMENT === "local") enabled.push("email");
    const active =
      n.event === "recovered" &&
      (await first(
        env.DB,
        "SELECT d.receipt FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.incident_id=? AND n.event='opened' AND (n.state='sending' OR (d.channel='pushover' AND (d.state='pending' OR (d.receipt IS NOT NULL AND d.cancelled_at IS NULL))))",
        n.incident_id
      ));
    if (active && !enabled.includes("pushover")) enabled.push("pushover");
    if (enabled.length)
      await env.DB.batch(
        enabled.map((channel) =>
          statement(
            env.DB,
            "INSERT OR IGNORE INTO notification_deliveries(notification_id,channel,next_attempt) VALUES(?,?,?)",
            n.id,
            channel,
            now
          )
        )
      );
    deliveries = await rows<Delivery>(
      env.DB,
      "SELECT channel,state,attempts,next_attempt FROM notification_deliveries WHERE notification_id=?",
      n.id
    );
  }
  return deliveries;
}
async function finishNotification(
  env: Env,
  n: Notification,
  now: number,
  lease: string,
  configured: boolean
) {
  const totals = await rows<Delivery>(
    env.DB,
    "SELECT channel,state,attempts,next_attempt FROM notification_deliveries WHERE notification_id=?",
    n.id
  );
  const waiting = totals.filter((d) => d.state === "pending");
  const failed = totals.some((d) => d.state === "failed");
  const unconfigured = !totals.length && !configured;
  const attempts = unconfigured
    ? n.attempts + 1
    : Math.max(0, ...totals.map((d) => d.attempts));
  const state =
    waiting.length || (unconfigured && attempts < 8)
      ? "pending"
      : failed || unconfigured
        ? "failed"
        : "sent";
  await statement(
    env.DB,
    "UPDATE notifications SET state=?,attempts=?,next_attempt=?,delivered_at=?,error=?,lease_until=NULL WHERE id=? AND lease_token=?",
    state,
    attempts,
    waiting.length
      ? Math.min(...waiting.map((d) => d.next_attempt))
      : now + Math.min(3600, 60 * 2 ** attempts),
    state === "sent" ? now : null,
    state === "sent"
      ? null
      : state === "failed"
        ? "No se pudo entregar la notificación."
        : "Entrega pendiente de reintento.",
    n.id,
    lease
  ).run();
}
export async function deliverNotifications(
  env: Env,
  now: number,
  fetcher: typeof fetch = fetch
) {
  const started = Date.now();
  const { config, configured } = await notificationConfig(env);
  const pending = await rows<Notification>(
    env.DB,
    "SELECT n.*,i.monitor_id,i.opened_at,i.closed_at,i.reason,m.kind,p.name AS project_name,g.name AS group_name FROM notifications n LEFT JOIN incidents i ON i.id=n.incident_id LEFT JOIN monitors m ON m.id=i.monitor_id LEFT JOIN projects p ON p.id=m.project_id LEFT JOIN groups g ON g.id=m.group_id WHERE (n.state='pending' AND n.next_attempt<=?) OR (n.state='sending' AND n.lease_until<?) ORDER BY n.created_at,n.event LIMIT 20",
    now,
    now
  );
  for (const n of pending) {
    const lease = crypto.randomUUID();
    const claimed = await first<{ id: string }>(
      env.DB,
      "UPDATE notifications SET state='sending',lease_token=?,lease_until=? WHERE id=? AND ((state='pending' AND next_attempt<=?) OR (state='sending' AND lease_until<?)) RETURNING id",
      lease,
      now + Math.floor((Date.now() - started) / 1000) + 180,
      n.id,
      now,
      now
    );
    if (!claimed) continue;
    const deliveries = await pendingDeliveries(env, config, configured, n, now);
    const results = await Promise.allSettled(
      deliveries
        .filter(
          (delivery) =>
            delivery.state === "pending" && delivery.next_attempt <= now
        )
        .map((delivery) =>
          deliverChannel(env, config, n, delivery, now, fetcher)
        )
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    await finishNotification(env, n, now, lease, configured);
  }
}
