import { z } from "zod";
import type { Status } from "./types";

export const stages = [
  "investigating",
  "identified",
  "monitoring",
  "resolved"
] as const;
export const impacts = ["degraded", "down"] as const;
export const stageLabels = {
  investigating: "Investigando",
  identified: "Identificado",
  monitoring: "En observación",
  resolved: "Resuelto"
};
export type Stage = (typeof stages)[number];
export type Impact = (typeof impacts)[number];
const text = z.string().trim().max(4000).default("");
export const incidentInput = z
  .object({
    project_id: z.uuid(),
    monitor_ids: z
      .array(z.uuid())
      .min(1)
      .max(100)
      .refine((ids) => new Set(ids).size === ids.length),
    title_es: z.string().trim().max(200).default(""),
    title_en: z.string().trim().max(200).default(""),
    impact: z.enum(impacts),
    stage: z.enum(stages).default("investigating"),
    message_es: text,
    message_en: text
  })
  .refine(
    (v) => Boolean(v.title_es || v.title_en),
    "Escribe un título para el incidente."
  );
export const updateInput = z
  .object({
    stage: z.enum(stages),
    impact: z.enum(impacts),
    message_es: text,
    message_en: text
  })
  .refine(
    (v) => Boolean(v.message_es || v.message_en),
    "Escribe una actualización."
  );
export interface PublicIncident {
  id: string;
  project_id: string;
  origin: "manual" | "automatic";
  monitor_id: string | null;
  technical_id: string | null;
  impact: Impact;
  stage: Stage;
  title_es: string;
  title_en: string;
  published: number;
  opened_at: number;
  updated_at: number;
  closed_at: number | null;
}
export interface IncidentUpdate {
  id: string;
  incident_id: string;
  stage: Stage;
  impact: Impact;
  message_es: string;
  message_en: string;
  event: "detected" | "changed" | "recovered" | null;
  created_at: number;
}
export interface IncidentDetail extends PublicIncident {
  monitors: { id: string; name: string }[];
  updates: IncidentUpdate[];
}
export interface PublicIncidentView {
  id: string;
  title: string;
  origin: "manual" | "automatic";
  impact: Impact;
  stage: Stage;
  opened_at: number;
  closed_at: number | null;
  updated_at: number;
  monitors: { id: string; name: string }[];
  updates: {
    id: string;
    stage: Stage;
    impact: Impact;
    message: string;
    created_at: number;
  }[];
}
export function overallStatus(statuses: Status[]): Status {
  if (!statuses.length) return "pending";
  const evaluable = statuses.filter(
    (s) => s !== "paused" && s !== "maintenance"
  );
  if (!evaluable.length)
    return statuses.includes("maintenance") ? "maintenance" : "paused";
  if (evaluable.every((s) => s === "down")) return "down";
  if (evaluable.some((s) => s === "down" || s === "degraded"))
    return "degraded";
  if (evaluable.some((s) => s === "unknown" || s === "pending"))
    return "unknown";
  if (statuses.includes("maintenance")) return "maintenance";
  return "up";
}
export function publicStatus(status: Status, impacts: Impact[]): Status {
  if (status === "maintenance") return status;
  if (status === "down" || impacts.includes("down")) return "down";
  if (status === "unknown" || status === "pending" || status === "paused")
    return status;
  return impacts.includes("degraded") ? "degraded" : status;
}
export function historyStatus(stat?: {
  observed_seconds: number;
  up_seconds: number;
  degraded_count?: number;
}) {
  if (!stat?.observed_seconds) return "none";
  if (stat.up_seconds < stat.observed_seconds) return "down";
  return stat.degraded_count ? "degraded" : "up";
}
