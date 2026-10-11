import { first, rows, statement } from "./db";

interface Notification {
  id: string;
  event: string;
  monitor_name: string;
  attempts: number;
  created_at: number;
}
function escape(value: string) {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!
  );
}
export function mailBody(n: Notification, origin: string) {
  const event =
    n.event === "opened" ? "Caída detectada" : "Servicio recuperado";
  const text = `${event}: ${n.monitor_name}\nFecha: ${new Date(n.created_at * 1000).toISOString()}\nDashboard: ${origin}/app/`;
  return {
    Subject: `[Monitor] ${event}: ${n.monitor_name}`,
    TextBody: text,
    HtmlBody: `<h2>${event}</h2><p>${escape(n.monitor_name)}</p><p>${new Date(n.created_at * 1000).toISOString()}</p><p><a href="${escape(origin)}/app/">Abrir dashboard</a></p>`
  };
}
export async function deliverNotifications(
  env: Env,
  now: number,
  fetcher: typeof fetch = fetch
) {
  const pending = await rows<Notification>(
    env.DB,
    "SELECT * FROM notifications WHERE (state='pending' AND next_attempt<=?) OR (state='sending' AND lease_until<?) LIMIT 20",
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
            ...mailBody(n, env.APP_ORIGIN),
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
