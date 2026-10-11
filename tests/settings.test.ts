import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { first, statement } from "../src/worker/db";
import { notificationConfig, saveNotifications } from "../src/worker/settings";
import { deliverNotifications } from "../src/worker/mail";
import { createMonitor, createProject, setup } from "./setup";

const emailToken = "postmark-secret-for-testing";
const botToken = "12345:telegram_secret_for_testing";
const input = {
  channel: "email",
  email: {
    to: "owner@example.test",
    from: "monitor@example.test",
    stream: "outbound",
    token: emailToken,
  },
  telegram: { chatId: "123456789", token: botToken },
};
beforeEach(async () => {
  await setup();
  await createProject();
});
const settingsRequest = (value?: unknown) =>
  new Request("http://localhost/api/v1/admin/settings/notifications", {
    method: value === undefined ? "GET" : "PUT",
    headers: { "Content-Type": "application/json" },
    body: value === undefined ? undefined : JSON.stringify(value),
  });

it("encrypts tokens and never returns them through settings or the snapshot", async () => {
  const response = await worker.fetch(settingsRequest(input), env);
  expect(response.status).toBe(200);
  const safe = await response.text();
  expect(safe).not.toContain(emailToken);
  expect(safe).not.toContain(botToken);
  expect(JSON.parse(safe).email.hasToken).toBe(true);
  const stored = await first<{ value: string }>(
    env.DB,
    "SELECT value FROM app_settings",
  );
  expect(stored?.value).not.toContain(emailToken);
  expect(stored?.value).not.toContain(botToken);
  expect((await notificationConfig(env)).config.email.token).toBe(emailToken);
  expect((await notificationConfig(env)).config.telegram.token).toBe(botToken);
  const snapshot = await worker.fetch(
    new Request("http://localhost/api/v1/admin/snapshot"),
    env,
  );
  expect(await snapshot.text()).not.toContain(emailToken);
  const get = await worker.fetch(settingsRequest(), env);
  expect(await get.text()).not.toContain(botToken);
});
it("preserves saved credentials on blank edits", async () => {
  await saveNotifications(env, input);
  await saveNotifications(env, {
    ...input,
    channel: "telegram",
    email: { ...input.email, token: "" },
    telegram: { ...input.telegram, token: "" },
  });
  const saved = await notificationConfig(env);
  expect(saved.configured).toBe(true);
  expect(saved.config.channel).toBe("telegram");
  expect(saved.config.email.token).toBe(emailToken);
  expect(saved.config.telegram.token).toBe(botToken);
});
it("rejects incomplete channels and protects settings with Access", async () => {
  expect(
    (
      await worker.fetch(
        settingsRequest({ ...input, email: { ...input.email, from: "" } }),
        env,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await worker.fetch(
        settingsRequest({
          ...input,
          channel: "telegram",
          telegram: { chatId: "1234", token: "bad/token" },
        }),
        env,
      )
    ).status,
  ).toBe(400);
  expect(await first(env.DB, "SELECT * FROM app_settings")).toBeNull();
  expect(
    (
      await worker.fetch(settingsRequest(), {
        ...env,
        ENVIRONMENT: "production",
        APP_ORIGIN: "http://localhost",
      })
    ).status,
  ).toBe(401);
});
async function pending() {
  const m = await createMonitor({ name: "Private monitor" });
  await statement(
    env.DB,
    "INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES('settings-incident',?,1000,'timeout')",
    m.id,
  ).run();
  await statement(
    env.DB,
    "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) VALUES('settings-alert','settings-incident','opened','Private monitor',1000,1000)",
  ).run();
}
it("uses the selected Telegram chat and retries temporary failures without logging secrets", async () => {
  await saveNotifications(env, { ...input, channel: "telegram" });
  await pending();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("", { status: 429 }));
  const production = { ...env, ENVIRONMENT: "production" };
  await deliverNotifications(production, 1000, fetcher);
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe(`https://api.telegram.org/bot${botToken}/sendMessage`);
  const payload = JSON.parse(String(request?.body));
  expect(payload.chat_id).toBe("123456789");
  expect(payload.text).toContain("Caída detectada");
  expect(payload.text).not.toContain(emailToken);
  expect(payload.text).not.toContain(botToken);
  expect(payload.parse_mode).toBeUndefined();
  expect(
    (await first<{ state: string }>(env.DB, "SELECT state FROM notifications"))
      ?.state,
  ).toBe("pending");
  fetcher.mockResolvedValue(Response.json({ ok: true, result: {} }));
  await deliverNotifications(production, 1200, fetcher);
  expect(
    (await first<{ state: string }>(env.DB, "SELECT state FROM notifications"))
      ?.state,
  ).toBe("sent");
});
it("marks permanent Telegram failures and intercepts both channels locally", async () => {
  await saveNotifications(env, { ...input, channel: "telegram" });
  await pending();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      new Response("sensitive provider response", { status: 403 }),
    );
  await deliverNotifications(
    { ...env, ENVIRONMENT: "production" },
    1000,
    fetcher,
  );
  const failure = await first<{ state: string; error: string }>(
    env.DB,
    "SELECT state,error FROM notifications",
  );
  expect(failure?.state).toBe("failed");
  expect(failure?.error).not.toContain("sensitive");
  await statement(
    env.DB,
    "UPDATE notifications SET state='pending',next_attempt=1200",
  ).run();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    fetcher.mockClear();
    await deliverNotifications(env, 1200, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(botToken);
    expect(
      (
        await first<{ state: string }>(
          env.DB,
          "SELECT state FROM notifications",
        )
      )?.state,
    ).toBe("sent");
  } finally {
    log.mockRestore();
  }
});
it("uses dashboard Postmark credentials and the configured owner only", async () => {
  await saveNotifications(env, input);
  await pending();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ ErrorCode: 0 }));
  await deliverNotifications(
    { ...env, ENVIRONMENT: "production" },
    1000,
    fetcher,
  );
  const [url, request] = fetcher.mock.calls[0];
  expect(url).toBe("https://api.postmarkapp.com/email");
  expect(new Headers(request?.headers).get("X-Postmark-Server-Token")).toBe(
    emailToken,
  );
  const payload = JSON.parse(String(request?.body));
  expect(payload.To).toBe(input.email.to);
  expect(payload.From).toBe(input.email.from);
});

it("requires dashboard configuration before attempting production deliveries", async () => {
  const response = await worker.fetch(settingsRequest(), env);
  const settings = (await response.json()) as {
    configured: boolean;
    email: { to: string; from: string; hasToken: boolean };
  };
  expect(settings.configured).toBe(false);
  expect(settings.email).toMatchObject({ to: "", from: "", hasToken: false });
  await pending();
  const fetcher = vi.fn<typeof fetch>();
  await deliverNotifications(
    { ...env, ENVIRONMENT: "production" },
    1000,
    fetcher,
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(
    (await first<{ state: string }>(env.DB, "SELECT state FROM notifications"))
      ?.state,
  ).toBe("pending");
});
