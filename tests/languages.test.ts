import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { statement } from "../src/worker/db";
import { saveNotifications, notificationConfig } from "../src/worker/settings";
import { translate } from "../src/shared/i18n";
import { english } from "../src/shared/translations";
import { date, availability } from "../src/lib/api";
import { mailBody, deliverNotifications } from "../src/worker/mail";
import { defaultNotifications } from "../src/shared/settings";
import { enUS, es } from "react-day-picker/locale";
import { vi } from "vitest";
import { createMonitor, createProject, projectId, setup } from "./setup";

beforeEach(async () => {
  await setup();
  await createProject();
});
const request = (path: string, method = "GET", body?: unknown) =>
  new Request(`http://localhost/api/v1/${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

it("defaults the dashboard to Spanish and persists its language without altering encrypted notifications", async () => {
  expect(
    await (await worker.fetch(request("admin/settings/general"), env)).json(),
  ).toEqual({ language: "es", testMode: false, timeZone: "UTC" });
  await saveNotifications(env, {
    email: {
      enabled: true,
      to: "owner@example.test",
      from: "monitor@example.test",
      stream: "outbound",
      token: "private-token",
    },
    telegram: { chatId: "", token: "" },
  });
  for (const language of ["en", "es"]) {
    const saved = await worker.fetch(
      request("admin/settings/general", "PUT", { language }),
      env,
    );
    expect(saved.status).toBe(200);
    expect(
      await (await worker.fetch(request("admin/settings/general"), env)).json(),
    ).toEqual({ language, testMode: false, timeZone: "UTC" });
    const snapshot = (await (
      await worker.fetch(request("admin/snapshot"), env)
    ).json()) as { settings: { general: { language: string } } };
    expect(snapshot.settings.general.language).toBe(language);
    expect((await notificationConfig(env)).config.email.token).toBe(
      "private-token",
    );
  }
});

it("protects general settings with Access and rejects unsupported languages", async () => {
  expect(
    (
      await worker.fetch(
        request("admin/settings/general", "PUT", { language: "fr" }),
        env,
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await worker.fetch(request("admin/settings/general"), {
        ...env,
        ENVIRONMENT: "production",
        APP_ORIGIN: "http://localhost",
      })
    ).status,
  ).toBe(401);
  expect(
    await (await worker.fetch(request("admin/settings/general"), env)).json(),
  ).toEqual({ language: "es", testMode: false, timeZone: "UTC" });
  expect(
    (
      await worker.fetch(
        request("admin/pages", "POST", {
          title: "Page",
          slug: "page",
          project_id: projectId,
          language: "fr",
        }),
        env,
      )
    ).status,
  ).toBe(400);
});

it("keeps public page languages independent and localizes sanitized incidents", async () => {
  await worker.fetch(
    request("admin/settings/general", "PUT", { language: "en" }),
    env,
  );
  const monitor = await createMonitor({ name: "Nombre personalizado" });
  await statement(
    env.DB,
    "INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES('language-incident',?,1000,'private diagnostic')",
    monitor.id,
  ).run();
  const input = {
    title: "Mi proyecto",
    description: "Mi descripción",
    slug: "spanish",
    project_id: projectId,
    included_ids: [monitor.id],
    published: true,
  };
  const created = await worker.fetch(
    request("admin/pages", "POST", input),
    env,
  );
  const { id } = (await created.json()) as { id: string };
  await worker.fetch(
    request("admin/pages", "POST", {
      ...input,
      slug: "english",
      language: "en",
    }),
    env,
  );
  const spanish = (await (
    await worker.fetch(request("public/spanish"), env)
  ).json()) as {
    language: string;
    monitors: { incidents: { message: string }[] }[];
  };
  expect(spanish.language).toBe("es");
  expect(spanish.monitors[0].incidents[0].message).toBe(
    "Interrupción del servicio",
  );
  const englishResponse = await worker.fetch(request("public/english"), env);
  const text = await englishResponse.text();
  expect(text).not.toContain("private diagnostic");
  expect(text).not.toContain("secret-value");
  expect(text).not.toContain("settings");
  const english = JSON.parse(text);
  expect(english.language).toBe("en");
  expect(english.title).toBe(input.title);
  expect(english.description).toBe(input.description);
  expect(english.monitors[0].name).toBe(monitor.name);
  expect(english.monitors[0].incidents[0].message).toBe("Service interruption");
  await worker.fetch(
    request(`admin/pages/${id}`, "PUT", { ...input, language: "en" }),
    env,
  );
  expect(
    (
      (await (await worker.fetch(request("public/spanish"), env)).json()) as {
        language: string;
      }
    ).language,
  ).toBe("en");
  await worker.fetch(
    request(`admin/pages/${id}`, "PUT", { ...input, language: "es" }),
    env,
  );
  expect(
    (
      (await (await worker.fetch(request("public/spanish"), env)).json()) as {
        language: string;
      }
    ).language,
  ).toBe("es");
});

it("translates UI labels and interpolated counts without modifying custom content", () => {
  expect(translate("es", "Monitores")).toBe("Monitores");
  expect(translate("en", "Monitores")).toBe("Monitors");
  expect(translate("en", "Operativo")).toBe("Operational");
  expect(translate("en", "Últimas 24 horas")).toBe("Last 24 hours");
  expect(
    translate("en", "{up} de {total} operativos", { up: 15, total: 16 }),
  ).toBe("15 of 16 operational");
  expect(
    translate("es", "{up} de {total} operativos", { up: 15, total: 16 }),
  ).toBe("15 de 16 operativos");
  expect(translate("en", "Mi API personalizada")).toBe("Mi API personalizada");
  expect(
    translate("en", "Borrar historial de {name}", {
      name: "Mi API personalizada",
    }),
  ).toBe("Delete history for Mi API personalizada");
  expect(
    translate("es", "Borrar historial de {name}", {
      name: "Mi API personalizada",
    }),
  ).toBe("Borrar historial de Mi API personalizada");
  expect(
    translate("en", "Activa el modo de pruebas para borrar el historial."),
  ).toBe("Enable test mode to delete history.");
});

it("keeps interpolation fields consistent in every translation", () => {
  const fields = (text: string) =>
    [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [source, translated] of Object.entries(english)) {
    expect(translated.trim(), source).not.toBe("");
    expect(fields(translated), source).toEqual(fields(source));
  }
});

it("localizes export controls, errors, and history tooltip details", () => {
  expect(translate("en", "Proyectos")).toBe("Projects");
  expect(translate("en", "Exportar")).toBe("Export");
  expect(translate("en", "Seleccionar todos")).toBe("Select all");
  expect(translate("en", "Descargar JSON")).toBe("Download JSON");
  expect(translate("en", "No se pudo exportar la información.")).toBe("The data could not be exported.");
  expect(translate("es", "No se pudo exportar la información.")).toBe("No se pudo exportar la información.");
  expect(translate("en", "Cobertura parcial: {coverage}%", { coverage: "25.0" })).toBe("Partial coverage: 25.0%");
  expect(translate("en", "{outage} s de interrupción / {observed} s observados", { outage: 60, observed: 300 })).toBe("60 s interrupted / 300 s observed");
});

it("formats dates and empty availability in the selected language", () => {
  expect(date(null, "es")).toBe("Sin datos");
  expect(date(null, "en")).toBe("No data");
  expect(availability([], "en")).toBe("No data");
  expect(availability([{ observed_seconds: 60, up_seconds: 30 }], "en")).toBe(
    "50.00%",
  );
  expect(date(1700000000, "en")).toBe(
    "11/14/2023, 22:13:20 (UTC)",
  );
  expect(date(1700000000, "es")).toBe(
    "14/11/2023, 22:13:20 (UTC)",
  );
});

it("formats HTML and plain-text alerts in English while preserving custom content and the selected time zone", async () => {
  const timestamp = Date.parse("2026-10-14T05:00:00Z") / 1000;
  const alert = {
    id: "alert", event: "recovered", monitor_name: "Mi API personalizada", attempts: 0,
    created_at: timestamp + 60, monitor_id: "monitor", project_name: "Mi proyecto", group_name: null,
    kind: "http", opened_at: timestamp, closed_at: timestamp + 60, reason: "timeout"
  };
  const content = await mailBody(alert, "https://monitor.example.test", true, "America/El_Salvador", "en");
  expect(content.Subject).toBe("[Monitor] Service recovered: Mi API personalizada");
  expect(content.TextBody).toContain("Project: Mi proyecto");
  expect(content.TextBody).toContain("Group: No group");
  expect(content.TextBody).toContain("Incident duration: 1 min");
  expect(content.TextBody).toContain("23:00 (UTC-6)");
  expect(content.TextBody).toContain("Outage reason: Service timed out");
  expect(content.HtmlBody).toContain('lang="en"');
  expect(content.HtmlBody).toContain("View monitor");
  expect(content.HtmlBody).toContain("No notifications were sent to your clients.");
  expect(content.HtmlBody).not.toContain("Ver monitor");
  const opening = await mailBody({ ...alert, event: "opened" }, "https://monitor.example.test", true, "UTC", "en");
  expect(opening.Subject).toContain("Service down");
  expect(opening.HtmlBody).toContain("The monitor reached its failure threshold");
});

it("uses the instance language for delivered push alerts", async () => {
  await worker.fetch(request("admin/settings/general", "PUT", { language: "en", timeZone: "America/El_Salvador" }), env);
  await saveNotifications(env, { ...defaultNotifications(), telegram: { enabled: true, chatId: "12345", token: "12345:testing" } });
  const monitor = await createMonitor({ name: "Mi monitor" });
  await statement(env.DB, "INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES('english-incident',?,1000,'timeout')", monitor.id).run();
  await statement(env.DB, "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) VALUES('english-alert','english-incident','opened','Mi monitor',1000,1000)").run();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => Response.json({ ok: true }));
  await deliverNotifications({ ...env, ENVIRONMENT: "production" }, 1000, fetcher);
  const text = JSON.parse(String(fetcher.mock.calls[0][1]?.body)).text;
  expect(text).toContain("Service down: Mi monitor");
  expect(text).toContain("UTC-6");
  expect(text).not.toContain("Caída detectada");
});

it("localizes default and custom validation errors per instance without changing validation rules", async () => {
  const messages = [];
  for (const language of ["es", "en"] as const) {
    await worker.fetch(request("admin/settings/general", "PUT", { language }), env);
    const invalid = await worker.fetch(request("admin/projects", "POST", { name: "" }), env);
    expect(invalid.status).toBe(400);
    messages.push((await invalid.json() as { error: string }).error);
    const custom = await worker.fetch(request("admin/settings/general", "PUT", { language, timeZone: "invalid" }), env);
    expect(custom.status).toBe(400);
    expect((await custom.json() as { error: string }).error).toBe(translate(language, "Selecciona una zona horaria válida."));
  }
  expect(messages[0]).not.toBe(messages[1]);
  expect(messages[0]).not.toContain("Too small");
  expect(messages[1]).toContain("Too small");
});

it("provides translated calendar navigation and recent interface labels", () => {
  expect(es.labels?.labelNext).toBe("Ir al mes siguiente");
  expect(enUS.labels?.labelNext).toBe("Go to the Next Month");
  expect(translate("en", "Inicio:")).toBe("Started:");
  expect(translate("en", "mi-proyecto")).toBe("my-project");
  expect(translate("en", "{count} minuto", { count: 1 })).toBe("1 minute");
});
