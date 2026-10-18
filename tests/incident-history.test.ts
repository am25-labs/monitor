import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { statement } from "../src/worker/db";
import type { IncidentHistory } from "../src/shared/types";
import { createMonitor, createProject, setup } from "./setup";

beforeEach(async () => { await setup(); await createProject(); });

const get = (params = "", overrides: Partial<Env> = {}) => worker.fetch(
  new Request(`http://localhost/api/v1/admin/incident-history?${params}`), { ...env, ...overrides }
);

it("paginates all retained incidents beyond 100 without gaps or duplicates when timestamps match", async () => {
  const monitor = await createMonitor();
  const ids = Array.from({ length: 125 }, (_, index) => `incident-${String(index).padStart(3, "0")}`);
  await env.DB.batch(ids.map((id, index) => statement(env.DB,
    "INSERT INTO incidents(id,monitor_id,opened_at,closed_at,reason) VALUES(?,?,?,?, 'timeout')",
    id, monitor.id, index === 0 ? 900 : 1000, index === 124 ? null : 1060
  )));
  const snapshot = await (await worker.fetch(new Request("http://localhost/api/v1/admin/snapshot"), env)).json() as { incidents: { id: string }[] };
  expect(snapshot.incidents).toHaveLength(100);
  expect(snapshot.incidents.slice(0, 10).map((incident) => incident.id)).toEqual([...ids].reverse().slice(0, 10));
  let page = await (await get()).json() as IncidentHistory;
  expect(page.incidents).toHaveLength(50);
  expect(page.incidents[0]).toMatchObject({ monitor_id: monitor.id, monitor_name: monitor.name, closed_at: null });
  const collected = page.incidents.map((incident) => incident.id);
  await statement(env.DB, "INSERT INTO incidents(id,monitor_id,opened_at,closed_at,reason) VALUES('new',?,1100,1160,'timeout')", monitor.id).run();
  while (page.nextCursor) {
    const params = new URLSearchParams({ before: String(page.nextCursor.opened_at), id: page.nextCursor.id });
    page = await (await get(String(params))).json() as IncidentHistory;
    expect(page.incidents.length).toBeLessThanOrEqual(50);
    collected.push(...page.incidents.map((incident) => incident.id));
  }
  expect(collected).toEqual([...ids].reverse());
  expect(new Set(collected).size).toBe(125);
});

it("returns an empty history and terminates pagination on exact page boundaries", async () => {
  expect(await (await get()).json()).toEqual({ incidents: [], nextCursor: null });
  const monitor = await createMonitor();
  await env.DB.batch(Array.from({ length: 50 }, (_, index) => statement(env.DB,
    "INSERT INTO incidents(id,monitor_id,opened_at,closed_at,reason) VALUES(?,?,1000,1060,'timeout')", `incident-${index}`, monitor.id
  )));
  const history = await (await get()).json() as IncidentHistory;
  expect(history.incidents).toHaveLength(50);
  expect(history.nextCursor).toBeNull();
});

it("validates paired cursors and protects the history endpoint with Access", async () => {
  for (const params of ["before=1000", "id=incident", "before=nope&id=incident", "before=1.5&id=incident", "before=-1&id=incident", "before=9007199254740992&id=incident", "before=1000&id=", `before=1000&id=${"a".repeat(251)}`])
    expect((await get(params)).status).toBe(400);
  expect((await get("", { ENVIRONMENT: "production", APP_ORIGIN: "http://localhost" })).status).toBe(401);
});
