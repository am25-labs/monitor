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
  email: {
    enabled: true,
    to: "owner@example.test",
    from: "monitor@example.test",
    stream: "outbound",
    token: emailToken,
  },
  telegram: { enabled: false, chatId: "123456789", token: botToken },
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
    email: { ...input.email, enabled: false, token: "" },
    telegram: { ...input.telegram, enabled: true, token: "" },
  });
  const saved = await notificationConfig(env);
  expect(saved.configured).toBe(true);
  expect(saved.config.telegram.enabled).toBe(true);
  expect(saved.config.email.enabled).toBe(false);
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
          telegram: { enabled: true, chatId: "1234", token: "bad/token" },
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
  await saveNotifications(env, {
    ...input,
    email: { ...input.email, enabled: false },
    telegram: { ...input.telegram, enabled: true },
  });
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
  await saveNotifications(env, {
    ...input,
    email: { ...input.email, enabled: false },
    telegram: { ...input.telegram, enabled: true },
  });
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
  await statement(
    env.DB,
    "UPDATE notification_deliveries SET state='pending',next_attempt=1200",
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

const pushInput = {
  ...input,
  pushover: {
    enabled: true,
    token: "a".repeat(30),
    userKey: "b".repeat(30),
    emergency: true,
    retrySeconds: 60,
    expireSeconds: 1800,
  },
  ntfy: {
    enabled: true,
    server: "https://ntfy.sh",
    topic: "private-random-topic",
    token: "ntfy-private-token",
  },
};
it("delivers independently and retries only the failed channel", async () => {
  await saveNotifications(env, pushInput);
  await pending();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).includes("postmark"))
      return Response.json({ ErrorCode: 0 });
    if (String(url).includes("pushover"))
      return Response.json({ status: 1, receipt: "receipt-123" });
    return new Response("private error", { status: 503 });
  });
  await deliverNotifications(
    { ...env, ENVIRONMENT: "production" },
    1000,
    fetcher,
  );
  expect(fetcher).toHaveBeenCalledTimes(3);
  const pushCall = fetcher.mock.calls.find(([url]) =>
    String(url).includes("pushover"),
  )!;
  const pushover = JSON.parse(String(pushCall[1]?.body));
  expect(pushover).toMatchObject({ priority: 2, retry: 60, expire: 1800 });
  const { rows } = await import("../src/worker/db");
  expect(
    await rows(
      env.DB,
      "SELECT channel,state FROM notification_deliveries ORDER BY channel",
    ),
  ).toEqual([
    { channel: "email", state: "sent" },
    { channel: "ntfy", state: "pending" },
    { channel: "pushover", state: "sent" },
  ]);
  fetcher.mockClear().mockResolvedValue(Response.json({ id: "ntfy-message" }));
  await deliverNotifications(
    { ...env, ENVIRONMENT: "production" },
    1200,
    fetcher,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("https://ntfy.sh");
  expect(
    (await first<{ state: string }>(env.DB, "SELECT state FROM notifications"))
      ?.state,
  ).toBe("sent");
  fetcher.mockClear();
  await deliverNotifications(
    { ...env, ENVIRONMENT: "production" },
    1300,
    fetcher,
  );
  expect(fetcher).not.toHaveBeenCalled();
});
it("cancels emergency repeats on recovery even after disabling Pushover or changing its token", async () => {
  await saveNotifications(env, {
    ...pushInput,
    email: { ...input.email, enabled: false },
    ntfy: { ...pushInput.ntfy, enabled: false },
  });
  await pending();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ status: 1, receipt: "receipt-123" }));
  const production = { ...env, ENVIRONMENT: "production" };
  await deliverNotifications(production, 1000, fetcher);
  const stored = await first<{ receipt_token: string }>(
    env.DB,
    "SELECT receipt_token FROM notification_deliveries",
  );
  expect(stored?.receipt_token).not.toContain(pushInput.pushover.token);
  await statement(
    env.DB,
    "UPDATE incidents SET closed_at=1060 WHERE id='settings-incident'",
  ).run();
  await statement(
    env.DB,
    "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) VALUES('recovery-alert','settings-incident','recovered','Private monitor',1060,1060)",
  ).run();
  await saveNotifications(env, {
    ...pushInput,
    email: { ...input.email, enabled: false },
    ntfy: { ...pushInput.ntfy, enabled: false },
    pushover: { ...pushInput.pushover, enabled: false, token: "c".repeat(30) },
  });
  fetcher.mockClear().mockResolvedValue(Response.json({ status: 1 }));
  await deliverNotifications(production, 1060, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(String(fetcher.mock.calls[0][0])).toContain(
    "/receipts/receipt-123/cancel.json",
  );
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).token).toBe(
    pushInput.pushover.token,
  );
  expect(
    (
      await first<{ cancelled_at: number }>(
        env.DB,
        "SELECT cancelled_at FROM notification_deliveries WHERE notification_id='settings-alert'",
      )
    )?.cancelled_at,
  ).toBe(1060);
});
it("does not make a delayed opening alert urgent after recovery", async () => {
  await saveNotifications(env, {
    ...pushInput,
    email: { ...input.email, enabled: false },
  });
  await pending();
  await statement(
    env.DB,
    "UPDATE incidents SET closed_at=1060 WHERE id='settings-incident'",
  ).run();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      Response.json(
        String(url).includes("pushover")
          ? { status: 1 }
          : { id: "ntfy-message" },
      ),
    );
  await deliverNotifications(
    { ...env, ENVIRONMENT: "production" },
    1100,
    fetcher,
  );
  const payloads = fetcher.mock.calls.map(([, request]) =>
    JSON.parse(String(request?.body)),
  );
  expect(payloads.map((payload) => payload.priority).sort()).toEqual([0, 3]);
  expect(payloads[0].retry).toBeUndefined();
});
it("redacts all push credentials and preserves them on blank edits", async () => {
  const response = await worker.fetch(settingsRequest(pushInput), env);
  const body = await response.text();
  for (const secret of [
    pushInput.pushover.token,
    pushInput.pushover.userKey,
    pushInput.ntfy.topic,
    pushInput.ntfy.token,
  ])
    expect(body).not.toContain(secret);
  expect(JSON.parse(body).ntfy.hasTopic).toBe(true);
  await saveNotifications(env, {
    ...pushInput,
    pushover: { ...pushInput.pushover, token: "", userKey: "" },
    ntfy: { ...pushInput.ntfy, topic: "", token: "" },
  });
  expect((await notificationConfig(env)).config.pushover.userKey).toBe(
    pushInput.pushover.userKey,
  );
  expect((await notificationConfig(env)).config.ntfy.topic).toBe(
    pushInput.ntfy.topic,
  );
});
it("retains the enabled legacy channel when reading encrypted existing settings", async () => {
  const { seal } = await import("../src/worker/crypto");
  const legacy = {
    channel: "telegram",
    email: {
      to: input.email.to,
      from: input.email.from,
      stream: "outbound",
      token: emailToken,
    },
    telegram: { chatId: "123456789", token: botToken },
  };
  await statement(
    env.DB,
    "INSERT INTO app_settings(id,value,updated_at) VALUES('notifications',?,1000)",
    await seal(legacy, env.CONFIG_KEY, "settings:notifications"),
  ).run();
  const { config } = await notificationConfig(env);
  expect(config.telegram.enabled).toBe(true);
  expect(config.email.enabled).toBe(false);
  expect(config.pushover.enabled).toBe(false);
});
it("intercepts all four channels locally and supports disabling all channels", async () => {
  await saveNotifications(env, {
    ...pushInput,
    telegram: { ...input.telegram, enabled: true },
  });
  await pending();
  const fetcher = vi.fn<typeof fetch>();
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  try {
    await deliverNotifications(env, 1000, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(log.mock.calls)).not.toContain(pushInput.ntfy.topic);
  } finally {
    log.mockRestore();
  }
  await saveNotifications(env, {
    ...pushInput,
    email: { ...input.email, enabled: false },
    pushover: { ...pushInput.pushover, enabled: false },
    ntfy: { ...pushInput.ntfy, enabled: false },
  });
  const { config } = await notificationConfig(env);
  expect(Object.values(config).every((channel) => !channel.enabled)).toBe(true);
});
it("rejects invalid Pushover credentials and ntfy servers", async () => {
  expect(
    (
      await worker.fetch(
        settingsRequest({
          ...pushInput,
          pushover: { ...pushInput.pushover, token: "bad" },
        }),
        env,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await worker.fetch(
        settingsRequest({
          ...pushInput,
          ntfy: { ...pushInput.ntfy, server: "http://ntfy.sh" },
        }),
        env,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await worker.fetch(
        settingsRequest({
          ...pushInput,
          ntfy: { ...pushInput.ntfy, server: "https://user:pass@ntfy.sh" },
        }),
        env,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await worker.fetch(
        settingsRequest({
          ...pushInput,
          pushover: {
            ...pushInput.pushover,
            retrySeconds: 120,
            expireSeconds: 60,
          },
        }),
        env,
      )
    ).status,
  ).toBe(400);
});

it("claims events once during overlapping delivery cycles", async () => {
  await saveNotifications(env, pushInput);
  await pending();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async (url) => {
    if (String(url).includes("postmark"))
      return Response.json({ ErrorCode: 0 });
    if (String(url).includes("pushover"))
      return Response.json({ status: 1, receipt: "receipt-123" });
    return Response.json({ id: "ntfy-message" });
  });
  const production = { ...env, ENVIRONMENT: "production" };
  await Promise.all([
    deliverNotifications(production, 1000, fetcher),
    deliverNotifications(production, 1000, fetcher),
  ]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});
it("exposes failures by channel and manually retries without repeating successful deliveries", async () => {
  await saveNotifications(env, {
    ...pushInput,
    pushover: { ...pushInput.pushover, enabled: false },
  });
  await pending();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).includes("postmark")
        ? Response.json({ ErrorCode: 0 })
        : new Response("private error", { status: 403 }),
    );
  const production = { ...env, ENVIRONMENT: "production" };
  await deliverNotifications(production, 1000, fetcher);
  const snapshot = await worker.fetch(
    new Request("http://localhost/api/v1/admin/snapshot"),
    env,
  );
  const body = await snapshot.text();
  expect(JSON.parse(body).notifications).toMatchObject([
    { channel: "ntfy", state: "failed" },
  ]);
  expect(body).not.toContain(pushInput.ntfy.topic);
  expect(body).not.toContain("private error");
  await worker.fetch(
    new Request(
      "http://localhost/api/v1/admin/notifications/settings-alert/retry",
      { method: "POST" },
    ),
    env,
  );
  fetcher.mockClear().mockResolvedValue(Response.json({ id: "ntfy-message" }));
  await deliverNotifications(
    production,
    Math.floor(Date.now() / 1000),
    fetcher,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][0]).toBe("https://ntfy.sh");
});
it("retries emergency cancellation independently from already-delivered recovery channels", async () => {
  await saveNotifications(env, {
    ...pushInput,
    ntfy: { ...pushInput.ntfy, enabled: false },
  });
  await pending();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(async (url) =>
      String(url).includes("postmark")
        ? Response.json({ ErrorCode: 0 })
        : Response.json({ status: 1, receipt: "receipt-123" }),
    );
  const production = { ...env, ENVIRONMENT: "production" };
  await deliverNotifications(production, 1000, fetcher);
  await statement(
    env.DB,
    "UPDATE incidents SET closed_at=1060 WHERE id='settings-incident'",
  ).run();
  await statement(
    env.DB,
    "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) VALUES('recovery-alert','settings-incident','recovered','Private monitor',1060,1060)",
  ).run();
  fetcher.mockImplementation(async (url) =>
    String(url).includes("postmark")
      ? Response.json({ ErrorCode: 0 })
      : new Response("", { status: 503 }),
  );
  await deliverNotifications(production, 1060, fetcher);
  fetcher.mockClear().mockResolvedValue(Response.json({ status: 1 }));
  await deliverNotifications(production, 1200, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(String(fetcher.mock.calls[0][0])).toContain("cancel.json");
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).priority).toBe(0);
});

it("keeps recovery cancellation pending while an emergency send is in flight", async () => {
  await saveNotifications(env, {
    ...pushInput,
    email: { ...input.email, enabled: false },
    ntfy: { ...pushInput.ntfy, enabled: false },
  });
  await pending();
  let release!: (response: Response) => void;
  let started!: () => void;
  const sending = new Promise<void>((resolve) => {
    started = resolve;
  });
  const response = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const openingFetch = vi.fn<typeof fetch>().mockImplementation(() => {
    started();
    return response;
  });
  const production = { ...env, ENVIRONMENT: "production" };
  const opening = deliverNotifications(production, 1000, openingFetch);
  await sending;
  await statement(
    env.DB,
    "UPDATE incidents SET closed_at=1060 WHERE id='settings-incident'",
  ).run();
  await statement(
    env.DB,
    "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) VALUES('recovery-alert','settings-incident','recovered','Private monitor',1060,1060)",
  ).run();
  await saveNotifications(env, {
    ...pushInput,
    email: { ...input.email, enabled: false },
    ntfy: { ...pushInput.ntfy, enabled: false },
    pushover: { ...pushInput.pushover, enabled: false },
  });
  const recoveryFetch = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ status: 1 }));
  try {
    await deliverNotifications(production, 1060, recoveryFetch);
    expect(recoveryFetch).not.toHaveBeenCalled();
    expect(
      (
        await first<{ state: string }>(
          env.DB,
          "SELECT state FROM notifications WHERE id='recovery-alert'",
        )
      )?.state,
    ).toBe("pending");
  } finally {
    release(Response.json({ status: 1, receipt: "receipt-123" }));
    await opening;
  }
  await deliverNotifications(production, 1200, recoveryFetch);
  expect(recoveryFetch).toHaveBeenCalledTimes(1);
  expect(String(recoveryFetch.mock.calls[0][0])).toContain("cancel.json");
});
