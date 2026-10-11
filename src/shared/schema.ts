import { z } from "zod";
import type { CheckConfig } from "./types";

const name = z.string().trim().min(1).max(120);
const id = z.string().uuid();
export const projectInput = z.object({
  name,
  description: z.string().max(1000).default("")
});
export const groupInput = z.object({ name, project_id: id });
export const httpInput = z
  .object({
    url: z
      .url()
      .max(2048)
      .refine((value) => {
        const u = new URL(value);
        return (
          ["http:", "https:"].includes(u.protocol) && !u.username && !u.password
        );
      }, "Usá HTTP o HTTPS sin credenciales en la URL."),
    method: z.enum(["GET", "HEAD"]).default("GET"),
    headers: z
      .record(
        z.string().regex(/^[\w-]+$/),
        z
          .string()
          .max(4096)
          .refine((v) => !/[\r\n]/.test(v))
      )
      .refine((v) => Object.keys(v).length <= 20)
      .default({}),
    codes: z
      .string()
      .default("200-299")
      .refine(
        (v) =>
          v
            .split(",")
            .every(
              (item) =>
                /^\s*[1-5]\d\d(?:-[1-5]\d\d)?\s*$/.test(item) &&
                Number(item.split("-")[0]) <=
                  Number(item.split("-")[1] ?? item.split("-")[0])
            ),
        "Indicá códigos o rangos válidos."
      ),
    followRedirects: z.boolean().default(false),
    timeoutSeconds: z.number().int().min(1).max(30).default(10),
    assertion: z.enum(["none", "text", "json"]).default("none"),
    text: z.string().max(4096).optional(),
    pointer: z.string().max(1024).optional(),
    expected: z.unknown().optional()
  })
  .superRefine((v, ctx) => {
    if (v.method === "HEAD" && v.assertion !== "none")
      ctx.addIssue({
        code: "custom",
        message: "HEAD no admite validaciones de contenido."
      });
    if (v.assertion === "text" && !v.text)
      ctx.addIssue({ code: "custom", message: "Indicá el texto esperado." });
    if (
      v.assertion === "json" &&
      (v.pointer === undefined ||
        (v.pointer !== "" && !/^\/(?:[^~]|~[01])*$/.test(v.pointer)))
    )
      ctx.addIssue({
        code: "custom",
        message: "Indicá un JSON Pointer válido."
      });
    if (v.assertion === "json" && !Object.hasOwn(v, "expected"))
      ctx.addIssue({
        code: "custom",
        message: "Indicá el valor JSON esperado."
      });
  });
export const tcpInput = z.object({
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[a-zA-Z0-9.:[\]-]+$/),
  port: z.number().int().min(1).max(65535),
  timeoutSeconds: z.number().int().min(1).max(30).default(10)
});
export const monitorInput = z
  .object({
    name,
    project_id: id,
    group_id: id.nullable().default(null),
    kind: z.enum(["http", "tcp", "heartbeat"]),
    config: z.unknown(),
    interval_seconds: z.number().int().min(60).max(604800).default(60),
    grace_seconds: z.number().int().min(0).max(86400).default(60),
    failure_threshold: z.number().int().min(1).max(20).default(2),
    recovery_threshold: z.number().int().min(1).max(20).default(1),
    paused: z.boolean().default(false),
    keepCredentials: z.boolean().default(true)
  })
  .transform((v, ctx) => {
    let config: CheckConfig;
    try {
      config =
        v.kind === "http"
          ? httpInput.parse(v.config)
          : v.kind === "tcp"
            ? tcpInput.parse(v.config)
            : {};
    } catch (error) {
      if (error instanceof z.ZodError)
        for (const issue of error.issues)
          ctx.addIssue({ ...issue, path: ["config", ...issue.path] });
      return z.NEVER;
    }
    return { ...v, config };
  });
export const maintenanceInput = z
  .object({
    scope: z.enum(["project", "group", "monitor"]),
    target_id: id,
    title: name,
    starts_at: z.number().int(),
    ends_at: z.number().int()
  })
  .refine(
    (v) => v.ends_at > v.starts_at,
    "El fin debe ser posterior al inicio."
  );
export const pageInput = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(80),
  title: name,
  description: z.string().max(1000).default(""),
  project_id: id,
  group_ids: z.array(id).max(100).default([]),
  excluded_ids: z.array(id).max(100).default([]),
  published: z.boolean().default(false)
});
export type MonitorInput = z.output<typeof monitorInput>;
