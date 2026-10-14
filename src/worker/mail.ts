import { generalSettings, notificationConfig } from "./settings";
import { defaultTimeZone, formatDate } from "../shared/time";
import { translate } from "../shared/i18n";
import {
  channels,
  type NotificationChannel,
  type NotificationConfig,
  type Language
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
function mailDate(timestamp: number, timeZone: string, language: Language) {
  return formatDate(timestamp, language, timeZone, { dateStyle: "long", timeStyle: "short", hourCycle: "h23" });
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
  includeHtml = true,
  timeZone = defaultTimeZone,
  language: Language = "es"
) {
  const t = (text: string) => translate(language, text);
  const event =
    t(n.event === "opened" ? "Caída detectada" : "Servicio recuperado");
  const recovered = n.event === "recovered";
  const base = origin.replace(/\/+$/, "");
  const url = n.monitor_id
    ? `${base}/app/monitors/${encodeURIComponent(n.monitor_id)}`
    : `${base}/app/`;
  const fields = [
    {
      label: t("Estado del evento"),
      value: t(recovered ? "Recuperado" : "Caída detectada")
    },
    { label: t("Proyecto"), value: n.project_name ?? t("Sin proyecto disponible") },
    { label: t("Grupo"), value: n.group_name ?? t("Sin grupo") },
    {
      label: t("Tipo"),
      value:
        n.kind === "heartbeat"
          ? "Heartbeat"
          : (n.kind?.toUpperCase() ?? t("Sin datos"))
    },
    {
      label: t("Inicio del incidente"),
      value: mailDate(n.opened_at ?? n.created_at, timeZone, language)
    },
    {
      label: t("Motivo de la caída"),
      value: t(reasons[n.reason ?? ""] ?? "El servicio no pasó la comprobación")
    }
  ];
  if (recovered) {
    const closed = n.closed_at ?? n.created_at;
    fields.push({ label: t("Recuperación"), value: mailDate(closed, timeZone, language) });
    if (n.opened_at != null)
      fields.push({
        label: t("Duración del incidente"),
        value: duration(Math.max(0, closed - n.opened_at))
      });
  }
  const subject = `[Monitor] ${event}: ${n.monitor_name}`;
  return {
    Subject: subject,
    TextBody: `${event}: ${n.monitor_name}\n\n${fields.map(({ label, value }) => `${label}: ${value}`).join("\n")}\n\n${t("Ver monitor")}: ${url}`,
    HtmlBody: includeHtml
      ? await render(
          createElement(MonitorAlertEmail, {
            title: event,
            subject,
            monitor: n.monitor_name,
            fields,
            url,
            fontUrl: `${base}/assets/fonts/MartianMono.ttf`,
            recovered,
            language
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
const silencedMonitor = `m.paused=1 OR EXISTS(SELECT 1 FROM maintenance w WHERE w.starts_at<=? AND (w.ends_at IS NULL OR w.ends_at>?) AND (w.scope='global' OR (w.scope='monitor' AND w.target_id=m.id) OR (w.scope='project' AND w.target_id=m.project_id) OR (w.scope='group' AND w.target_id=m.group_id)))`;

async function notificationSuppressed(env: Env, id: string, now: number) {
  return Boolean(await first(
    env.DB,
    `SELECT n.id FROM notifications n LEFT JOIN incidents i ON i.id=n.incident_id LEFT JOIN monitors m ON m.id=i.monitor_id WHERE n.id=? AND (n.state='cancelled' OR ${silencedMonitor})`,
    id,
    now,
    now
  ));
}

async function cancelNotification(env: Env, id: string) {
  await env.DB.batch([
    statement(
      env.DB,
      "UPDATE notifications SET state='cancelled',error=NULL,lease_token=NULL,lease_until=NULL WHERE id=?",
      id
    ),
    statement(
      env.DB,
      "UPDATE notification_deliveries SET state='cancelled',error=NULL WHERE notification_id=? AND state IN ('pending','failed')",
      id
    )
  ]);
}

interface EmergencyReceipt {
  notification_id: string;
  receipt: string;
  receipt_token: string;
}

async function cancelReceipt(
  env: Env,
  active: EmergencyReceipt,
  now: number,
  fetcher: typeof fetch
) {
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
    now,
    active.notification_id
  ).run();
}

export async function suppressNotifications(
  env: Env,
  now: number,
  fetcher: typeof fetch = fetch
) {
  const selected = await rows<{ id: string }>(
    env.DB,
    `SELECT n.id FROM notifications n JOIN incidents i ON i.id=n.incident_id JOIN monitors m ON m.id=i.monitor_id WHERE n.state IN ('pending','sending','failed') AND (${silencedMonitor})`,
    now,
    now
  );
  for (const n of selected) await cancelNotification(env, n.id);
  const active = await rows<EmergencyReceipt>(
    env.DB,
    `SELECT d.notification_id,d.receipt,d.receipt_token FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id JOIN incidents i ON i.id=n.incident_id JOIN monitors m ON m.id=i.monitor_id WHERE d.channel='pushover' AND d.receipt IS NOT NULL AND d.cancelled_at IS NULL AND (n.state='cancelled' OR ${silencedMonitor})`,
    now,
    now
  );
  for (const receipt of active) {
    await cancelNotification(env, receipt.notification_id);
    if (env.ENVIRONMENT === "local") continue;
    try {
      await cancelReceipt(env, receipt, now, fetcher);
    } catch {
      console.error(JSON.stringify({
        event: "emergency_cancellation_pending",
        notificationId: receipt.notification_id
      }));
    }
  }
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
  const active = await first<EmergencyReceipt>(
    env.DB,
    "SELECT d.notification_id,d.receipt,d.receipt_token FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.incident_id=? AND n.event='opened' AND d.receipt IS NOT NULL AND d.cancelled_at IS NULL",
    n.incident_id
  );
  if (!active) return;
  await cancelReceipt(env, active, n.created_at, fetcher);
}
async function sendNotification(
  env: Env,
  config: NotificationConfig,
  channel: NotificationChannel,
  n: Notification,
  fetcher: typeof fetch,
  now: number
) {
  if (await notificationSuppressed(env, n.id, now)) throw new Error("suppressed");
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
  const general = await generalSettings(env);
  const content = await mailBody(n, env.APP_ORIGIN, channel === "email", general.timeZone, general.language);
  if (await notificationSuppressed(env, n.id, now)) throw new Error("suppressed");
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
      fetcher,
      now
    );
    await statement(
      env.DB,
      "UPDATE notification_deliveries SET state=CASE WHEN state='cancelled' THEN state ELSE 'sent' END,delivered_at=?,error=NULL,receipt=?,receipt_token=? WHERE notification_id=? AND channel=?",
      now,
      result.receipt ?? null,
      result.receiptToken ?? null,
      n.id,
      delivery.channel
    ).run();
    if (result.receipt && await notificationSuppressed(env, n.id, now))
      await suppressNotifications(env, now, fetcher);
  } catch (error) {
    if (await notificationSuppressed(env, n.id, now)) {
      await cancelNotification(env, n.id);
      return;
    }
    const attempts = delivery.attempts + 1;
    const final =
      attempts >= 8 ||
      (error instanceof Error && error.message === "permanent");
    await statement(
      env.DB,
      "UPDATE notification_deliveries SET state=?,attempts=?,next_attempt=?,error=? WHERE notification_id=? AND channel=? AND state='pending'",
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
  if (await notificationSuppressed(env, n.id, now)) {
    await cancelNotification(env, n.id);
    return;
  }
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
    "UPDATE notifications SET state=?,attempts=?,next_attempt=?,delivered_at=?,error=?,lease_until=NULL WHERE id=? AND lease_token=? AND state='sending'",
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
  await suppressNotifications(env, now, fetcher);
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
