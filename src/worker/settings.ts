import { first, statement, nowSeconds } from "./db";
import { seal, unseal } from "./crypto";
import {
  notificationInput,
  defaultNotifications,
  channels,
  generalInput,
  type GeneralSettings,
  type NotificationConfig,
  type SafeNotificationConfig,
} from "../shared/settings";

const context = "settings:notifications";
export async function generalSettings(env: Env): Promise<GeneralSettings> {
  const stored = await first<{ value: string }>(
    env.DB,
    "SELECT value FROM app_settings WHERE id='general'",
  );
  return generalInput.parse(stored ? JSON.parse(stored.value) : {});
}
export async function saveGeneralSettings(env: Env, input: unknown) {
  const settings = generalInput.parse(input);
  await statement(
    env.DB,
    "INSERT INTO app_settings(id,value,updated_at) VALUES('general',?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    JSON.stringify(settings),
    nowSeconds(),
  ).run();
  return settings;
}
export async function notificationConfig(env: Env): Promise<{
  config: NotificationConfig;
  configured: boolean;
}> {
  const stored = await first<{ value: string }>(
    env.DB,
    "SELECT value FROM app_settings WHERE id='notifications'",
  );
  if (stored) {
    const saved = await unseal<
      NotificationConfig & { channel?: "email" | "telegram" }
    >(stored.value, env.CONFIG_KEY, context);
    return {
      config: notificationInput.parse({
        ...saved,
        email: {
          ...saved.email,
          enabled: saved.email.enabled ?? saved.channel === "email",
        },
        telegram: {
          ...saved.telegram,
          enabled: saved.telegram.enabled ?? saved.channel === "telegram",
        },
      }),
      configured: true,
    };
  }
  return { configured: false, config: defaultNotifications() };
}
export async function safeNotifications(
  env: Env,
): Promise<SafeNotificationConfig> {
  const { config, configured } = await notificationConfig(env);
  const { token: emailToken, ...email } = config.email;
  const { token: telegramToken, ...telegram } = config.telegram;
  const { token: pushoverToken, userKey, ...pushover } = config.pushover;
  const { token: ntfyToken, topic, ...ntfy } = config.ntfy;
  return {
    configured,
    email: { ...email, hasToken: Boolean(emailToken) },
    telegram: { ...telegram, hasToken: Boolean(telegramToken) },
    pushover: {
      ...pushover,
      hasToken: Boolean(pushoverToken),
      hasUserKey: Boolean(userKey),
    },
    ntfy: { ...ntfy, hasToken: Boolean(ntfyToken), hasTopic: Boolean(topic) },
  };
}
export async function saveNotifications(env: Env, input: unknown) {
  const value = notificationInput.parse(input);
  const { config: old } = await notificationConfig(env);
  for (const channel of channels) value[channel].token ||= old[channel].token;
  value.pushover.userKey ||= old.pushover.userKey;
  value.ntfy.topic ||= old.ntfy.topic;
  if (
    value.email.enabled &&
    (!value.email.to || !value.email.from || !value.email.token)
  )
    throw new Response(
      "Completa destinatario, remitente y token de Postmark.",
      { status: 400 },
    );
  if (
    value.telegram.enabled &&
    (!value.telegram.chatId ||
      !/^\d+:[A-Za-z0-9_-]+$/.test(value.telegram.token))
  )
    throw new Response(
      "Completa el identificador de chat y un token válido del bot de Telegram.",
      { status: 400 },
    );
  if (
    value.pushover.enabled &&
    (!/^[A-Za-z0-9]{30}$/.test(value.pushover.token) ||
      !/^[A-Za-z0-9]{30}$/.test(value.pushover.userKey) ||
      value.pushover.expireSeconds < value.pushover.retrySeconds)
  )
    throw new Response(
      "Completa las claves de Pushover y usa una duración igual o mayor al intervalo.",
      { status: 400 },
    );
  if (value.ntfy.enabled && !value.ntfy.topic)
    throw new Response("Completa el tema de ntfy.", { status: 400 });
  await statement(
    env.DB,
    "INSERT INTO app_settings(id,value,updated_at) VALUES('notifications',?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    await seal(value, env.CONFIG_KEY, context),
    nowSeconds(),
  ).run();
  return safeNotifications(env);
}
