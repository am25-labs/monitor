import { env, applyD1Migrations, type D1Migration } from "cloudflare:test";
import { first, statement } from "../src/worker/db";
import { seal } from "../src/worker/crypto";
import type { Monitor } from "../src/shared/types";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
export async function setup() {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  await env.DB.batch(
    [
      "notifications",
      "incidents",
      "results",
      "jobs",
      "daily_stats",
      "hourly_stats",
      "short_stats",
      "monitors",
      "pages",
      "maintenance",
      "groups",
      "projects"
    ].map((table) => env.DB.prepare(`DELETE FROM ${table}`))
  );
  await env.DB.prepare(
    "UPDATE engine SET last_started=NULL,last_finished=NULL,last_error=NULL WHERE id=1"
  ).run();
}
export const projectId = "00000000-0000-4000-8000-000000000001";
export async function createProject() {
  await statement(
    env.DB,
    "INSERT INTO projects(id,name,created_at) VALUES(?,?,?)",
    projectId,
    "Project",
    1000
  ).run();
}
export async function createMonitor(overrides: Partial<Monitor> = {}) {
  const id = overrides.id ?? crypto.randomUUID();
  const config = await seal(
    {
      url: "https://example.test/health",
      method: "GET",
      headers: { Authorization: "Bearer secret-value" },
      codes: "200-299",
      followRedirects: false,
      timeoutSeconds: 10,
      assertion: "none"
    },
    env.CONFIG_KEY,
    id
  );
  await statement(
    env.DB,
    "INSERT INTO monitors(id,project_id,name,kind,config,interval_seconds,next_due,created_at) VALUES(?,?,?,?,?,?,?,?)",
    id,
    projectId,
    "Monitor",
    "http",
    config,
    60,
    1000,
    1000
  ).run();
  for (const [field, value] of Object.entries(overrides))
    if (field !== "id")
      await statement(
        env.DB,
        `UPDATE monitors SET ${field}=? WHERE id=?`,
        value,
        id
      ).run();
  return (await first<Monitor>(
    env.DB,
    "SELECT * FROM monitors WHERE id=?",
    id
  ))!;
}
