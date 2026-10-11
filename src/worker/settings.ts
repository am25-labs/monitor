import { first, statement, nowSeconds } from "./db";
import { seal, unseal } from "./crypto";
import {
  notificationInput,
  type NotificationConfig,
  type SafeNotificationConfig,
} from "../shared/settings";

const context = "settings:notifications";
export async function notificationConfig(env: Env): Promise<{
  config: NotificationConfig;
  configured: boolean;
}> {
  const stored = await first<{ value: string }>(
    env.DB,
    "SELECT value FROM app_settings WHERE id='notifications'",
  );
  if (stored)
    return {
      config: await unseal<NotificationConfig>(
        stored.value,
        env.CONFIG_KEY,
        context,
      ),
      configured: true,
    };
  return {
    configured: false,
    config: {
      channel: "email",
      email: {
        to: "",
        from: "",
        stream: "outbound",
        token: "",
      },
      telegram: { chatId: "", token: "" },
    },
  };
}
export async function safeNotifications(
  env: Env,
): Promise<SafeNotificationConfig> {
  const { config, configured } = await notificationConfig(env);
  return {
    channel: config.channel,
    configured,
    email: {
      to: config.email.to,
      from: config.email.from,
      stream: config.email.stream,
      hasToken: Boolean(config.email.token),
    },
    telegram: {
      chatId: config.telegram.chatId,
      hasToken: Boolean(config.telegram.token),
    },
  };
}
export async function saveNotifications(env: Env, input: unknown) {
  const value = notificationInput.parse(input);
  const { config: old } = await notificationConfig(env);
  const config: NotificationConfig = {
    channel: value.channel,
    email: { ...value.email, token: value.email.token || old.email.token },
    telegram: {
      ...value.telegram,
      token: value.telegram.token || old.telegram.token,
    },
  };
  if (
    config.channel === "email" &&
    (!config.email.to || !config.email.from || !config.email.token)
  )
    throw new Response(
      "Completá destinatario, remitente y token de Postmark.",
      { status: 400 },
    );
  if (
    config.channel === "telegram" &&
    (!config.telegram.chatId ||
      !/^\d+:[A-Za-z0-9_-]+$/.test(config.telegram.token))
  )
    throw new Response(
      "Completá el identificador de chat y un token válido del bot de Telegram.",
      { status: 400 },
    );
  await statement(
    env.DB,
    "INSERT INTO app_settings(id,value,updated_at) VALUES('notifications',?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at",
    await seal(config, env.CONFIG_KEY, context),
    nowSeconds(),
  ).run();
  return safeNotifications(env);
}
