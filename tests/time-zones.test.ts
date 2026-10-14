import { beforeEach, expect, it, vi } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { formatDate, localDateTime, parseDateTime, utcDay, validTimeZone, zoneOffset } from "../src/shared/time";
import { generalSettings, saveGeneralSettings, saveNotifications } from "../src/worker/settings";
import { defaultNotifications } from "../src/shared/settings";
import { deliverNotifications } from "../src/worker/mail";
import { first, statement } from "../src/worker/db";
import { translate } from "../src/shared/i18n";
import { createMonitor, createProject, projectId, setup } from "./setup";

beforeEach(async () => {
  await setup();
  await createProject();
});

const request = (path: string, body?: unknown) => new Request(`http://localhost/api/v1/${path}`, {
  method: body === undefined ? "GET" : "PUT",
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body)
});

it("defaults legacy settings to UTC and persists the selected zone", async () => {
  await statement(env.DB, "INSERT INTO app_settings(id,value,updated_at) VALUES('general',?,1000)", JSON.stringify({ language: "en", testMode: true })).run();
  expect((await generalSettings(env)).timeZone).toBe("UTC");
  const response = await worker.fetch(request("admin/settings/general", { language: "en", testMode: true, timeZone: "America/El_Salvador" }), env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ language: "en", testMode: true, timeZone: "America/El_Salvador" });
  expect((await generalSettings(env)).timeZone).toBe("America/El_Salvador");
});

it("rejects invalid zones without replacing saved settings", async () => {
  await saveGeneralSettings(env, { timeZone: "America/El_Salvador" });
  for (const timeZone of ["Mars/Monitor", "UTC-6", "", "+06:00"])
    expect((await worker.fetch(request("admin/settings/general", { timeZone }), env)).status).toBe(400);
  expect((await generalSettings(env)).timeZone).toBe("America/El_Salvador");
  expect(validTimeZone("Asia/Kathmandu")).toBe(true);
});

it("formats instants in the selected zone with explicit offsets and 24-hour time", () => {
  const timestamp = Date.parse("2026-10-14T05:00:00Z") / 1000;
  expect(formatDate(timestamp, "es", "America/El_Salvador")).toBe("13/10/2026, 23:00:00 (UTC-6)");
  expect(formatDate(timestamp, "es", "UTC")).toBe("14/10/2026, 05:00:00 (UTC)");
  expect(formatDate(timestamp, "en", "America/El_Salvador")).toBe("10/13/2026, 23:00:00 (UTC-6)");
  expect(formatDate(0, "es", "UTC")).toContain("01/01/1970");
  expect(formatDate(null, "en", "UTC")).toBe("No data");
});

it("uses the offset of the displayed instant, including daylight saving and fractional offsets", () => {
  const winter = Date.parse("2026-01-15T12:00:00Z") / 1000;
  const summer = Date.parse("2026-07-15T12:00:00Z") / 1000;
  expect(zoneOffset("America/New_York", winter)).toBe("UTC-5");
  expect(zoneOffset("America/New_York", summer)).toBe("UTC-4");
  expect(zoneOffset("Asia/Kathmandu", winter)).toBe("UTC+5:45");
});

it("converts form dates and history boundaries to UTC independently of the browser zone", () => {
  const timestamp = Date.parse("2026-10-14T05:00:00Z") / 1000;
  expect(localDateTime(timestamp, "America/El_Salvador")).toBe("2026-10-13T23:00:00");
  expect(parseDateTime("2026-10-13T23:00", "America/El_Salvador")).toBe(timestamp);
  expect(parseDateTime("2026-10-13T00:00:00", "America/El_Salvador")).toBe(Date.parse("2026-10-13T06:00:00Z") / 1000);
  expect(parseDateTime("2026-10-13T23:59:59", "America/El_Salvador")).toBe(Date.parse("2026-10-14T05:59:59Z") / 1000);
  expect(parseDateTime("2026-10-13T12:00", "Asia/Kathmandu")).toBe(Date.parse("2026-10-13T06:15:00Z") / 1000);
});

it("rejects nonexistent wall times and consistently chooses the first occurrence of repeated times", () => {
  expect(parseDateTime("2026-03-08T02:30", "America/New_York")).toBeNull();
  expect(parseDateTime("2026-11-01T01:30", "America/New_York")).toBe(Date.parse("2026-11-01T05:30:00Z") / 1000);
  expect(parseDateTime("2026-02-30T12:00", "UTC")).toBeNull();
  expect(parseDateTime("invalid", "UTC")).toBeNull();
});

it("keeps daily aggregate labels explicitly in UTC", () => {
  expect(utcDay("2026-10-14", "en")).toBe("Oct 14, 2026 (UTC)");
  expect(utcDay("2026-10-14", "es", true)).toContain("UTC");
});

it("exposes only the instance zone to public pages while retaining their language", async () => {
  await saveGeneralSettings(env, { language: "es", timeZone: "America/El_Salvador" });
  await statement(env.DB, "INSERT INTO pages(id,slug,title,project_id,language,published) VALUES('page','status','Status',?,'en',1)", projectId).run();
  const response = await worker.fetch(request("public/status"), env);
  const data = await response.json() as { timeZone: string; language: string };
  expect(data.timeZone).toBe("America/El_Salvador");
  expect(data.language).toBe("en");
  expect(data).not.toHaveProperty("settings");
});

it("uses the instance time zone for delivered alerts", async () => {
  await saveGeneralSettings(env, { timeZone: "America/El_Salvador" });
  await saveNotifications(env, { ...defaultNotifications(), telegram: { enabled: true, chatId: "12345", token: "12345:testing" } });
  const m = await createMonitor();
  const timestamp = Date.parse("2026-10-14T05:00:00Z") / 1000;
  await statement(env.DB, "INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES('incident',?,?,'timeout')", m.id, timestamp).run();
  await statement(env.DB, "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) VALUES('alert','incident','opened','API',?,?)", timestamp, timestamp).run();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ok: true }));
  await deliverNotifications({ ...env, ENVIRONMENT: "production" }, timestamp, fetcher);
  const text = JSON.parse(String(fetcher.mock.calls[0][1]?.body)).text;
  expect(text).toContain("23:00");
  expect(text).toContain("UTC-6");
  expect(await first(env.DB, "SELECT opened_at FROM incidents WHERE id='incident'")).toEqual({ opened_at: timestamp });
});

it("localizes the time zone controls and validation messages", () => {
  expect(translate("en", "Zona horaria de la instancia")).toBe("Instance time zone");
  expect(translate("en", "Selecciona una zona horaria válida.")).toBe("Select a valid time zone.");
  expect(translate("en", "Inicio ({zone})", { zone: "UTC-6" })).toBe("Start (UTC-6)");
});
