import { saveNotifications } from "../src/worker/settings";
import { beforeEach, it, expect, vi } from "vitest";
import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../src/worker/index";
import { setup, createProject, createMonitor, projectId } from "./setup";
import { digest } from "../src/worker/crypto";
import { statement, first } from "../src/worker/db";
import { pageMonitors } from "../src/shared/page-scope";
import { deliverNotifications, mailBody } from "../src/worker/mail";

beforeEach(async () => {
  await setup();
  await createProject();
});
it("redacts credentials in administrative responses and exposes only selected public monitors", async () => {
  const visible = await createMonitor({ name: "Visible" }),
    hidden = await createMonitor({ name: "Private" });
  await statement(
    env.DB,
    "INSERT INTO pages(id,slug,title,project_id,excluded_ids,published) VALUES(?,?,?,?,?,1)",
    "page",
    "project",
    "Project",
    projectId,
    JSON.stringify([hidden.id]),
  ).run();
  const privateResponse = await worker.fetch(
    new Request("http://localhost/api/v1/admin/snapshot"),
    env,
  );
  const privateBody = await privateResponse.text();
  expect(privateBody).not.toContain("secret-value");
  expect(privateBody).toContain("hasCredentials");
  const snapshot = JSON.parse(privateBody);
  expect(snapshot.pages[0].included_ids).toEqual([visible.id]);
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/public/project"),
    env,
  );
  const body = await response.text();
  expect(body).toContain(visible.id);
  expect(body).not.toContain(hidden.id);
  expect(body).not.toContain("example.test");
  expect(body).not.toContain("config");
  expect(body).not.toContain("diagnostic");
});
it("does not expose unpublished pages or administrative routes through public API", async () => {
  expect(
    (
      await worker.fetch(
        new Request("http://localhost/api/v1/public/no-page"),
        env,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await worker.fetch(
        new Request("http://localhost/api/v1/public/monitors"),
        env,
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await worker.fetch(
        new Request("http://localhost/api/v1/admin/snapshot"),
        { ...env, ENVIRONMENT: "production", APP_ORIGIN: "http://localhost" },
      )
    ).status,
  ).toBe(401);
});
it("rejects invalid heartbeat tokens and accepts report tokens independently of Access", async () => {
  const secret = "a".repeat(64),
    m = await createMonitor({
      kind: "heartbeat",
      heartbeat_hash: await digest(secret),
    });
  const report = (t: string) =>
    new Request(`http://localhost/api/v1/heartbeats/${m.id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/json",
      },
      body: '{"ok":true}',
    });
  expect((await worker.fetch(report("b".repeat(64)), env)).status).toBe(401);
  expect((await worker.fetch(report(secret), env)).status).toBe(200);
  await statement(
    env.DB,
    "UPDATE monitors SET heartbeat_hash=? WHERE id=?",
    await digest("c".repeat(64)),
    m.id,
  ).run();
  expect((await worker.fetch(report(secret), env)).status).toBe(401);
});
it("validates Access signature, issuer, audience, expiration and owner identity", async () => {
  const keys = await generateKeyPair("RS256", { extractable: true }),
    jwk = await exportJWK(keys.publicKey);
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () => Response.json({ keys: [jwk] }));
  const production = {
    ...env,
    ENVIRONMENT: "production",
    APP_ORIGIN: "https://monitor.example.com",
    ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com",
    ACCESS_AUDIENCES: "aud",
    ACCESS_EMAIL: "owner@example.test",
  };
  const sign = async (
    claims: {
      aud?: string;
      issuer?: string;
      email?: string;
      expired?: boolean;
    } = {},
  ) =>
    new SignJWT({ email: claims.email ?? "owner@example.test" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(claims.issuer ?? production.ACCESS_TEAM_DOMAIN)
      .setAudience(claims.aud ?? "aud")
      .setSubject("owner")
      .setExpirationTime(claims.expired ? 1 : "1h")
      .sign(keys.privateKey);
  const request = (jwt: string) =>
    new Request("https://monitor.example.com/api/v1/admin/snapshot", {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    });
  try {
    expect((await worker.fetch(request(await sign()), production)).status).toBe(
      200,
    );
    const jwt = await sign();
    for (const path of ["/app", "/app/", "/app/monitors"]) {
      const response = await worker.fetch(
        new Request(`https://monitor.example.com${path}`, {
          redirect: "manual",
          headers: { Cookie: `CF_Authorization=${jwt}` },
        }),
        production,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Location")).toBeNull();
      expect(await response.text()).toContain("Monitor test shell");
    }
    for (const claims of [
      { aud: "other" },
      { issuer: "https://other.test" },
      { email: "stranger@example.test" },
      { expired: true },
    ])
      expect(
        (await worker.fetch(request(await sign(claims)), production)).status,
      ).toBe(401);
    expect((await worker.fetch(request("invalid"), production)).status).toBe(
      401,
    );
    const forged = new Request(
      "https://alternate.workers.dev/api/v1/admin/snapshot",
      { headers: { "Cf-Access-Jwt-Assertion": await sign() } },
    );
    expect((await worker.fetch(forged, production)).status).toBe(404);
  } finally {
    fetchMock.mockRestore();
  }
});
it("renders event details with local dates, incident duration and escaped monitor names", async () => {
  const details = {
    id: "mail",
    event: "recovered",
    monitor_name: '<script>alert("x")</script>',
    attempts: 0,
    created_at: 2000,
    monitor_id: "monitor",
    project_name: "AM25",
    group_name: null,
    kind: "http",
    opened_at: 1000,
    closed_at: 1900,
    reason: "timeout",
  };
  const recovered = await mailBody(details, "https://monitor.example.com/");
  expect(recovered.HtmlBody).not.toContain('<script>alert("x")</script>');
  expect(recovered.HtmlBody).toContain("&lt;script&gt;");
  expect(recovered.HtmlBody).not.toContain("#0000f2");
  expect(recovered.HtmlBody).not.toContain("am25-logo.svg");
  expect(recovered.HtmlBody).toContain("AM25 Monitor");
  expect(recovered.TextBody).toContain("Duración del incidente: 15 min");
  expect(recovered.TextBody).toContain("El Salvador, UTC−6");
  expect(recovered.TextBody).toContain("El servicio no respondió a tiempo");
  expect(recovered.TextBody).toContain(
    "https://monitor.example.com/app/monitors/monitor",
  );
  const opened = await mailBody(
    { ...details, event: "opened" },
    "https://monitor.example.com",
  );
  expect(opened.TextBody).not.toContain("Recuperación:");
  expect(opened.TextBody).not.toContain("Duración del incidente:");
});
it("delivers only to the owner and retries temporary provider failures", async () => {
  const m = await createMonitor();
  await statement(
    env.DB,
    "INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES(?,?,?,?)",
    "incident",
    m.id,
    1000,
    "timeout",
  ).run();
  await statement(
    env.DB,
    "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) VALUES('mail','incident','opened','Monitor',1000,1000)",
  ).run();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("", { status: 503 }));
  await saveNotifications(env, {
    channel: "email",
    email: {
      to: "support@am25.work",
      from: "noreply@am25.work",
      stream: "outbound",
      token: "test-token",
    },
    telegram: { chatId: "", token: "" },
  });
  const production = { ...env, ENVIRONMENT: "production" };
  await deliverNotifications(production, 1000, fetcher);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).To).toBe(
    "support@am25.work",
  );
  expect(
    (
      await first<{ state: string }>(
        env.DB,
        "SELECT * FROM notifications WHERE id='mail'",
      )
    )?.state,
  ).toBe("pending");
  fetcher.mockResolvedValue(Response.json({ ErrorCode: 0 }));
  await deliverNotifications(production, 1200, fetcher);
  expect(
    (
      await first<{ state: string }>(
        env.DB,
        "SELECT * FROM notifications WHERE id='mail'",
      )
    )?.state,
  ).toBe("sent");
});

it("paginates filtered history and exposes permanent notification failures", async () => {
  const m = await createMonitor();
  await env.DB.batch(
    Array.from({ length: 51 }, (_, i) =>
      statement(
        env.DB,
        "INSERT INTO results(job_id,monitor_id,checked_at,ok,reason,diagnostic) VALUES(?,?,?,1,'ok','Comprobación exitosa')",
        String(i),
        m.id,
        1000 + i,
      ),
    ),
  );
  const response = await worker.fetch(
    new Request(
      `http://localhost/api/v1/admin/monitors/${m.id}/results?from=1000&to=1100`,
    ),
    env,
  );
  const page = (await response.json()) as {
    results: unknown[];
    nextCursor: number;
  };
  expect(page.results).toHaveLength(50);
  expect(page.nextCursor).toBeTypeOf("number");
  const next = await worker.fetch(
    new Request(
      `http://localhost/api/v1/admin/monitors/${m.id}/results?from=1000&to=1100&cursor=${page.nextCursor}`,
    ),
    env,
  );
  expect(((await next.json()) as { results: unknown[] }).results).toHaveLength(
    1,
  );
  await statement(
    env.DB,
    "INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES('i',?,1000,'timeout')",
    m.id,
  ).run();
  await statement(
    env.DB,
    "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) VALUES('n','i','opened','Monitor',1000,1000)",
  ).run();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("", { status: 422 }));
  await saveNotifications(env, {
    channel: "email",
    email: {
      to: "owner@example.test",
      from: "monitor@example.test",
      stream: "outbound",
      token: "test-token",
    },
    telegram: { chatId: "", token: "" },
  });
  await deliverNotifications(
    { ...env, ENVIRONMENT: "production" },
    1000,
    fetcher,
  );
  expect(
    (
      await first<{ state: string }>(
        env.DB,
        "SELECT state FROM notifications WHERE id='n'",
      )
    )?.state,
  ).toBe("failed");
});

it("serves public status HTML without redirecting to the private dashboard", async () => {
  const production = {
    ...env,
    ENVIRONMENT: "production",
    APP_ORIGIN: "https://monitor.example.com",
  };
  const response = await worker.fetch(
    new Request("https://monitor.example.com/status/project", {
      redirect: "manual",
    }),
    production,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Location")).toBeNull();
  expect(await response.text()).toContain("Monitor test shell");
  const privateResponse = await worker.fetch(
    new Request("https://monitor.example.com/app/"),
    production,
  );
  expect(privateResponse.status).toBe(401);
});
it("reproduces asset canonicalization and preserves the single root redirect", async () => {
  const asset = await env.ASSETS.fetch(
    new Request("https://monitor.example.com/index.html", { redirect: "manual" }),
  );
  expect(asset.status).toBe(307);
  expect(asset.headers.get("Location")).toBe("/");
  const production = {
    ...env,
    ENVIRONMENT: "production",
    APP_ORIGIN: "https://monitor.example.com",
  };
  const root = await worker.fetch(
    new Request("https://monitor.example.com/"),
    production,
  );
  expect(root.status).toBe(302);
  expect(root.headers.get("Location")).toBe("https://monitor.example.com/app/");
});

it("publishes only explicitly included monitors within the selected groups", async () => {
  const group = crypto.randomUUID();
  await statement(
    env.DB,
    "INSERT INTO groups(id,project_id,name) VALUES(?,?,?)",
    group,
    projectId,
    "Public",
  ).run();
  const visible = await createMonitor({ group_id: group });
  const hidden = await createMonitor();
  const payload = {
    title: "Project",
    slug: "selected",
    project_id: projectId,
    group_ids: [group],
    included_ids: [visible.id],
    published: true,
  };
  const save = (value: unknown, id = "") =>
    worker.fetch(
      new Request(`http://localhost/api/v1/admin/pages${id ? `/${id}` : ""}`, {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      }),
      env,
    );
  expect((await save({ ...payload, included_ids: [hidden.id] })).status).toBe(
    400,
  );
  const otherProject = crypto.randomUUID();
  await statement(
    env.DB,
    "INSERT INTO projects(id,name,created_at) VALUES(?,?,?)",
    otherProject,
    "Other",
    1000,
  ).run();
  const foreign = await createMonitor({ project_id: otherProject });
  expect(
    (await save({ ...payload, group_ids: [], included_ids: [foreign.id] }))
      .status,
  ).toBe(400);
  const response = await save(payload);
  expect(response.status).toBe(200);
  const { id } = (await response.json()) as { id: string };
  await createMonitor({ group_id: group });
  const read = async () =>
    (await (
      await worker.fetch(
        new Request("http://localhost/api/v1/public/selected"),
        env,
      )
    ).json()) as {
      monitors: { id: string; hourly: unknown[]; short: unknown[] }[];
    };
  expect((await read()).monitors.map((m) => m.id)).toEqual([visible.id]);
  const hour = new Date().toISOString().slice(0, 13);
  await statement(
    env.DB,
    "INSERT INTO hourly_stats VALUES(?,?,?,?)",
    visible.id,
    hour,
    60,
    60,
  ).run();
  const slot = new Date(Math.floor(Date.now() / 300000) * 300000)
    .toISOString()
    .slice(0, 16);
  await statement(
    env.DB,
    "INSERT INTO short_stats VALUES(?,?,?,?)",
    visible.id,
    slot,
    300,
    240,
  ).run();
  expect((await read()).monitors[0].short).toEqual([
    { slot, observed_seconds: 300, up_seconds: 240 },
  ]);
  expect((await read()).monitors[0].hourly).toEqual([
    { hour, observed_seconds: 60, up_seconds: 60 },
  ]);
  expect(
    pageMonitors([visible, hidden, foreign], projectId, [group]).map(
      (m) => m.id,
    ),
  ).toEqual([visible.id]);
  expect((await save({ ...payload, included_ids: [] }, id)).status).toBe(200);
  expect((await read()).monitors).toEqual([]);
  await save(payload, id);
  await statement(
    env.DB,
    "UPDATE monitors SET group_id=NULL WHERE id=?",
    visible.id,
  ).run();
  expect((await read()).monitors).toEqual([]);
});
