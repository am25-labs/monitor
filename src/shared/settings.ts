import { z } from "zod";

const token = z.string().trim().max(512).optional();
export const notificationInput = z.object({
  channel: z.enum(["email", "telegram"]),
  email: z.object({
    to: z.union([z.email(), z.literal("")]),
    from: z.union([z.email(), z.literal("")]),
    stream: z.string().trim().min(1).max(100),
    token,
  }),
  telegram: z.object({
    chatId: z
      .string()
      .trim()
      .max(100)
      .refine(
        (value) => value === "" || /^-?\d+$/.test(value),
        "Usá el identificador numérico de tu chat personal.",
      ),
    token,
  }),
});
export type NotificationConfig = {
  channel: "email" | "telegram";
  email: { to: string; from: string; stream: string; token: string };
  telegram: { chatId: string; token: string };
};
export type SafeNotificationConfig = {
  channel: NotificationConfig["channel"];
  email: Omit<NotificationConfig["email"], "token"> & { hasToken: boolean };
  telegram: Omit<NotificationConfig["telegram"], "token"> & {
    hasToken: boolean;
  };
  configured: boolean;
};
