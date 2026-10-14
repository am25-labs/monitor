import { z } from "zod";
import { defaultTimeZone, validTimeZone } from "./time";

export const languageInput = z.enum(["es", "en"]);
export type Language = z.infer<typeof languageInput>;
export const generalInput = z.object({
  language: languageInput.default("es"),
  testMode: z.boolean().default(false),
  timeZone: z.string().max(100).refine(validTimeZone, "Selecciona una zona horaria válida.").default(defaultTimeZone),
});
export type GeneralSettings = z.infer<typeof generalInput>;
export const channels = ["email", "telegram", "pushover", "ntfy"] as const;
export type NotificationChannel = (typeof channels)[number];
const token = z.string().trim().max(512).default("");
export const notificationInput = z.object({
  email: z.object({
    enabled: z.boolean().default(false),
    to: z.union([z.email(), z.literal("")]),
    from: z.union([z.email(), z.literal("")]),
    stream: z.string().trim().min(1).max(100),
    token,
  }),
  telegram: z.object({
    enabled: z.boolean().default(false),
    chatId: z
      .string()
      .trim()
      .max(100)
      .refine(
        (value) => value === "" || /^-?\d+$/.test(value),
        "Usa el identificador numérico de tu chat personal.",
      ),
    token,
  }),
  pushover: z
    .object({
      enabled: z.boolean().default(false),
      token,
      userKey: token,
      emergency: z.boolean().default(true),
      retrySeconds: z.number().int().min(30).max(3600).default(60),
      expireSeconds: z.number().int().min(60).max(10800).default(1800),
    })
    .default({
      enabled: false,
      token: "",
      userKey: "",
      emergency: true,
      retrySeconds: 60,
      expireSeconds: 1800,
    }),
  ntfy: z
    .object({
      enabled: z.boolean().default(false),
      server: z
        .url()
        .refine((value) => {
          const url = new URL(value);
          return (
            url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            url.pathname === "/" &&
            !url.search &&
            !url.hash
          );
        }, "Usa una URL HTTPS sin rutas ni credenciales.")
        .default("https://ntfy.sh"),
      topic: z
        .string()
        .trim()
        .max(128)
        .regex(
          /^[A-Za-z0-9_-]*$/,
          "Usa letras, números, guiones o guiones bajos.",
        ),
      token,
    })
    .default({
      enabled: false,
      server: "https://ntfy.sh",
      topic: "",
      token: "",
    }),
});
export type NotificationConfig = z.infer<typeof notificationInput>;
export type SafeNotificationConfig = {
  email: Omit<NotificationConfig["email"], "token"> & { hasToken: boolean };
  telegram: Omit<NotificationConfig["telegram"], "token"> & {
    hasToken: boolean;
  };
  pushover: Omit<NotificationConfig["pushover"], "token" | "userKey"> & {
    hasToken: boolean;
    hasUserKey: boolean;
  };
  ntfy: Omit<NotificationConfig["ntfy"], "token" | "topic"> & {
    hasToken: boolean;
    hasTopic: boolean;
  };
  configured: boolean;
};
export function defaultNotifications(): NotificationConfig {
  return notificationInput.parse({
    email: { to: "", from: "", stream: "outbound" },
    telegram: { chatId: "" },
  });
}
