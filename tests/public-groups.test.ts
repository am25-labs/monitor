import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import worker from "../src/worker/index";
import { statement } from "../src/worker/db";
import { PublicMonitors } from "../src/pages/status";
import { LocaleProvider } from "../src/lib/locale";
import { TooltipProvider } from "../src/components/ui/tooltip";
import { createMonitor, createProject, projectId, setup } from "./setup";

type PublicGroups = Pick<Parameters<typeof PublicMonitors>[0], "monitors" | "groups">;

beforeEach(async () => {
  await setup();
  await createProject();
});

async function group(name: string) {
  const id = crypto.randomUUID();
  await statement(env.DB, "INSERT INTO groups(id,project_id,name) VALUES(?,?,?)", id, projectId, name).run();
  return { id, name };
}

async function page(groups: string[], included: string[]) {
  const response = await worker.fetch(new Request("http://localhost/api/v1/admin/pages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Status", slug: "status", project_id: projectId, group_ids: groups, included_ids: included, language: "en", published: true })
  }), env);
  expect(response.status).toBe(200);
  const publicResponse = await worker.fetch(new Request("http://localhost/api/v1/public/status"), env);
  expect(publicResponse.status).toBe(200);
  return await publicResponse.json() as PublicGroups;
}

function render(data: PublicGroups) {
  return renderToStaticMarkup(createElement(LocaleProvider, { language: "en", documentLanguage: false,
    children: createElement(TooltipProvider, {
      children: createElement(PublicMonitors, { ...data, range: "90d", updatedAt: 1000 })
    })
  }));
}

it("groups explicitly selected monitors under their configured group headings without publishing unselected members", async () => {
  const apps = await group("Aplicaciones");
  const sites = await group("Sitios");
  const empty = await group("Grupo vacío");
  const a = await createMonitor({ name: "Analytics", group_id: apps.id });
  const b = await createMonitor({ name: "Website", group_id: sites.id });
  const c = await createMonitor({ name: "Calendar", group_id: apps.id });
  await createMonitor({ name: "Hidden API", group_id: apps.id });
  const data = await page([sites.id, empty.id, apps.id], [a.id, b.id, c.id]);
  expect(data.groups).toEqual([apps, sites]);
  expect(data.monitors.map((monitor) => monitor.id)).toEqual([a.id, c.id, b.id]);
  expect(data.monitors.map((monitor) => monitor.groupId)).toEqual([apps.id, apps.id, sites.id]);
  const sections = render(data).match(/<section\b[\s\S]*?<\/section>/g)!;
  expect(sections).toHaveLength(2);
  expect(sections[0]).toContain(`id="monitor-group-${apps.id}"`);
  expect(sections[0]).toContain("Aplicaciones");
  expect(sections[0]).toContain("Analytics");
  expect(sections[0]).toContain("Calendar");
  expect(sections[0]).not.toContain("Website");
  expect(sections[1]).toContain("Sitios");
  expect(sections[1]).toContain("Website");
  expect(render(data)).not.toContain("Hidden API");
  expect(render(data)).not.toContain("Grupo vacío");
});

it("keeps the flat layout when no groups are activated even if individually selected monitors belong to groups", async () => {
  const apps = await group("Grupo privado");
  const a = await createMonitor({ name: "Analytics", group_id: apps.id });
  const b = await createMonitor({ name: "Website" });
  await createMonitor({ name: "Unselected", group_id: apps.id });
  const data = await page([], [a.id, b.id]);
  expect(data.groups).toEqual([]);
  expect(data.monitors.map((monitor) => monitor.groupId)).toEqual([null, null]);
  const html = render(data);
  expect(html).not.toContain("<section");
  expect(html).not.toContain("Grupo privado");
  expect(html).not.toContain("Unselected");
  expect(html).toContain("Analytics");
  expect(html).toContain("Website");
  expect(html).toContain("Current status");
});

it("does not reveal other project groups or configured groups without published monitors", async () => {
  const selected = await group("Público");
  const hidden = await group("Privado");
  const empty = await group("Vacío");
  const a = await createMonitor({ name: "Visible", group_id: selected.id });
  await createMonitor({ name: "Hidden", group_id: hidden.id });
  const otherProject = crypto.randomUUID();
  await statement(env.DB, "INSERT INTO projects(id,name,created_at) VALUES(?,'Other',1000)", otherProject).run();
  await statement(env.DB, "INSERT INTO groups(id,project_id,name) VALUES(?,?,'Foreign group')", crypto.randomUUID(), otherProject).run();
  const data = await page([selected.id, empty.id], [a.id]);
  expect(data.groups).toEqual([selected]);
  expect(JSON.stringify(data)).not.toContain("Foreign group");
  expect(JSON.stringify(data)).not.toContain("Privado");
  expect(render({ ...data, groups: [selected, empty] })).not.toContain("Vacío");
});
