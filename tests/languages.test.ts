import { beforeEach, expect, it } from "vitest";
import { env } from "cloudflare:test";
import worker from "../src/worker/index";
import { statement } from "../src/worker/db";
import { saveNotifications, notificationConfig } from "../src/worker/settings";
import { translate } from "../src/shared/i18n";
import { english } from "../src/shared/translations";
import { date, availability } from "../src/lib/api";
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
  ).toEqual({ language: "es", testMode: false });
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
    ).toEqual({ language, testMode: false });
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
  ).toEqual({ language: "es", testMode: false });
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

it("formats dates and empty availability in the selected language", () => {
  expect(date(null, "es")).toBe("Sin datos");
  expect(date(null, "en")).toBe("No data");
  expect(availability([], "en")).toBe("No data");
  expect(availability([{ observed_seconds: 60, up_seconds: 30 }], "en")).toBe(
    "50.00%",
  );
  expect(date(1700000000, "en")).toBe(
    new Date(1700000000000).toLocaleString("en-US"),
  );
  expect(date(1700000000, "es")).toBe(
    new Date(1700000000000).toLocaleString("es-SV"),
  );
});
