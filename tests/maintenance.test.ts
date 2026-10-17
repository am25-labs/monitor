import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { first, rows, statement } from "../src/worker/db";
import { displayStatus, historyMaintenance, isMaintenance, observation } from "../src/worker/state";
import type { MonitorHistory, Window } from "../src/shared/types";
import { createMonitor, createProject, projectId, setup } from "./setup";

beforeEach(async () => {
  await setup();
  await createProject();
});

const request = (body: unknown, id = "", method = "POST") =>
  new Request(
    `http://localhost/api/v1/admin/maintenance${id ? `/${id}` : ""}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  );

it("limits manual maintenance to the selected monitor", async () => {
  const selected = await createMonitor({ status: "up" });
  const other = await createMonitor({ status: "up" });
  const response = await worker.fetch(
    request({
      scope: "monitor",
      target_id: selected.id,
      title: "Deploy",
      starts_at: 1000,
      ends_at: null
    }),
    env
  );
  expect(response.status).toBe(200);
  const windows = await rows<Window>(env.DB, "SELECT * FROM maintenance");
  expect(displayStatus(selected, windows, 1000)).toBe("maintenance");
  expect(displayStatus(other, windows, 1000)).toBe("up");
  expect(isMaintenance(selected, windows, 1000000)).toBe(true);
  expect(isMaintenance(selected, windows, 999)).toBe(false);
});

it("applies global maintenance to every project and preserves overlapping individual windows when ended", async () => {
  const selected = await createMonitor({ status: "up" });
  const otherProject = crypto.randomUUID();
  await statement(
    env.DB,
    "INSERT INTO projects(id,name,created_at) VALUES(?,?,?)",
    otherProject,
    "Other",
    1000
  ).run();
  const other = await createMonitor({ project_id: otherProject, paused: 1 });
  const global = {
    scope: "global",
    target_id: null,
    title: "Global",
    starts_at: 1000,
    ends_at: null
  };
  const response = await worker.fetch(request(global), env);
  expect(response.status).toBe(200);
  const { id } = (await response.json()) as { id: string };
  await worker.fetch(
    request({ ...global, scope: "monitor", target_id: selected.id }),
    env
  );
  let windows = await rows<Window>(env.DB, "SELECT * FROM maintenance");
  expect(displayStatus(selected, windows, 1020)).toBe("maintenance");
  expect(displayStatus(other, windows, 1020)).toBe("maintenance");
  expect(
    (await worker.fetch(request({ ...global, ends_at: 1050 }, id, "PUT"), env))
      .status
  ).toBe(200);
  windows = await rows<Window>(env.DB, "SELECT * FROM maintenance");
  expect(displayStatus(selected, windows, 1050)).toBe("maintenance");
  expect(displayStatus(other, windows, 1050)).toBe("paused");
  expect(
    (await first<Window>(env.DB, "SELECT * FROM maintenance WHERE id=?", id))
      ?.ends_at
  ).toBe(1050);
});

it("validates targets and dates and retains Access protection for global maintenance", async () => {
  const base = {
    scope: "global",
    target_id: null,
    title: "Global",
    starts_at: 1000,
    ends_at: null
  };
  for (const input of [
    { ...base, target_id: projectId },
    { ...base, scope: "monitor" },
    { ...base, ends_at: 999 }
  ])
    expect((await worker.fetch(request(input), env)).status).toBe(400);
  expect(
    (
      await worker.fetch(
        request({ ...base, scope: "monitor", target_id: crypto.randomUUID() }),
        env
      )
    ).status
  ).toBe(404);
  expect(
    (
      await worker.fetch(request(base), {
        ...env,
        ENVIRONMENT: "production",
        APP_ORIGIN: "http://localhost"
      })
    ).status
  ).toBe(401);
  expect(await rows(env.DB, "SELECT * FROM maintenance")).toHaveLength(0);
});

it("excludes open-ended and overlapping maintenance from observed uptime", async () => {
  const monitor = await createMonitor({ last_checked: 1000, last_ok: 1 });
  const global: Window = {
    id: "global",
    scope: "global",
    target_id: null,
    title: "Global",
    starts_at: 1020,
    ends_at: null
  };
  const individual: Window = {
    ...global,
    id: "individual",
    scope: "monitor",
    target_id: monitor.id,
    starts_at: 1010,
    ends_at: 1030
  };
  expect(observation(monitor, [global, individual], 1060, false)).toEqual([
    { day: "1970-01-01", seconds: 10, up: 10 }
  ]);
  expect(
    observation(monitor, [{ ...global, ends_at: 1050 }], 1060, false)
  ).toEqual([{ day: "1970-01-01", seconds: 30, up: 30 }]);
});

it("returns scoped maintenance periods in detail, dashboard and public histories without exposing window metadata", async () => {
  const selected = await createMonitor();
  const other = await createMonitor();
  const now = Math.floor(Date.now() / 1000);
  const starts_at = now - 120, ends_at = now - 60;
  await worker.fetch(request({ scope: "monitor", target_id: selected.id, title: "Private deployment notes", starts_at, ends_at }), env);
  const get = async (path: string) => (await worker.fetch(new Request(`http://localhost/api/v1/${path}`), env)).json();
  const detail = await get(`admin/monitors/${selected.id}/history`) as MonitorHistory;
  expect(detail.maintenance).toEqual([{ starts_at, ends_at }]);
  expect((await get(`admin/monitors/${other.id}/history`) as MonitorHistory).maintenance).toEqual([]);
  const recent = await get("admin/monitor-history") as { maintenance: Record<string, MonitorHistory["maintenance"]> };
  expect(recent.maintenance[selected.id]).toEqual(detail.maintenance);
  expect(recent.maintenance[other.id]).toEqual([]);
  await statement(env.DB, "INSERT INTO pages(id,slug,title,project_id,group_ids,excluded_ids,published) VALUES(?,'history','History',?,'[]','[]',1)", crypto.randomUUID(), projectId).run();
  const page = await get("public/history") as { monitors: ({ id: string } & MonitorHistory)[] };
  expect(page.monitors.find((monitor) => monitor.id === selected.id)?.maintenance).toEqual(detail.maintenance);
  expect(page.monitors.find((monitor) => monitor.id === other.id)?.maintenance).toEqual([]);
  expect(JSON.stringify(page)).not.toContain("Private deployment notes");
});

it("bounds history maintenance to monitor lifetime, requested range and matching scopes", async () => {
  const monitor = await createMonitor({ group_id: null });
  const base: Window = { id: "window", scope: "global", target_id: null, title: "Maintenance", starts_at: 900, ends_at: null };
  const windows: Window[] = [
    base,
    { ...base, scope: "project", target_id: monitor.project_id, starts_at: 1100, ends_at: 1200 },
    { ...base, scope: "monitor", target_id: monitor.id, starts_at: 1200, ends_at: 1400 },
    { ...base, scope: "group", target_id: "unrelated-group" },
    { ...base, scope: "project", target_id: "unrelated-project" },
    { ...base, starts_at: 1500 },
    { ...base, ends_at: 900 }
  ];
  expect(historyMaintenance(monitor, windows, 950, 1300)).toEqual([
    { starts_at: 1000, ends_at: 1300 },
    { starts_at: 1100, ends_at: 1200 },
    { starts_at: 1200, ends_at: 1300 }
  ]);
  expect(historyMaintenance({ ...monitor, group_id: "unrelated-group" }, windows.slice(3, 4), 1100, 1300)).toEqual([{ starts_at: 1100, ends_at: 1300 }]);
});
