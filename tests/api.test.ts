import { beforeEach, it, expect, vi } from "vitest";
import { env } from "cloudflare:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import worker from "../src/worker/index";
import { setup, createProject, createMonitor, projectId } from "./setup";
import { digest } from "../src/worker/crypto";
import { statement, first } from "../src/worker/db";
import { deliverNotifications } from "../src/worker/mail";

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
    JSON.stringify([hidden.id])
  ).run();
  const privateResponse = await worker.fetch(
    new Request("http://localhost/api/v1/admin/snapshot"),
    env
  );
  const privateBody = await privateResponse.text();
  expect(privateBody).not.toContain("secret-value");
  expect(privateBody).toContain("hasCredentials");
  const response = await worker.fetch(
    new Request("http://localhost/api/v1/public/project"),
    env
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
        env
      )
    ).status
  ).toBe(404);
  expect(
    (
      await worker.fetch(
        new Request("http://localhost/api/v1/public/monitors"),
        env
      )
    ).status
  ).toBe(404);
  expect(
    (
      await worker.fetch(
        new Request("http://localhost/api/v1/admin/snapshot"),
        { ...env, ENVIRONMENT: "production", APP_ORIGIN: "http://localhost" }
      )
    ).status
  ).toBe(401);
});
it("rejects invalid heartbeat tokens and accepts report tokens independently of Access", async () => {
  const secret = "a".repeat(64),
    m = await createMonitor({
      kind: "heartbeat",
      heartbeat_hash: await digest(secret)
    });
  const report = (t: string) =>
    new Request(`http://localhost/api/v1/heartbeats/${m.id}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${t}`,
        "Content-Type": "application/json"
      },
      body: '{"ok":true}'
    });
  expect((await worker.fetch(report("b".repeat(64)), env)).status).toBe(401);
  expect((await worker.fetch(report(secret), env)).status).toBe(200);
  await statement(
    env.DB,
    "UPDATE monitors SET heartbeat_hash=? WHERE id=?",
    await digest("c".repeat(64)),
    m.id
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
    ACCESS_EMAIL: "owner@example.test"
  };
  const sign = async (
    claims: {
      aud?: string;
      issuer?: string;
      email?: string;
      expired?: boolean;
    } = {}
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
      headers: { "Cf-Access-Jwt-Assertion": jwt }
    });
  try {
    expect((await worker.fetch(request(await sign()), production)).status).toBe(
      200
    );
    for (const claims of [
      { aud: "other" },
      { issuer: "https://other.test" },
      { email: "stranger@example.test" },
      { expired: true }
    ])
      expect(
        (await worker.fetch(request(await sign(claims)), production)).status
      ).toBe(401);
    expect((await worker.fetch(request("invalid"), production)).status).toBe(
      401
    );
    const forged = new Request(
      "https://alternate.workers.dev/api/v1/admin/snapshot",
      { headers: { "Cf-Access-Jwt-Assertion": await sign() } }
    );
    expect((await worker.fetch(forged, production)).status).toBe(404);
  } finally {
    fetchMock.mockRestore();
  }
});
it("delivers only to the owner and retries temporary provider failures", async () => {
  const m = await createMonitor();
  await statement(
    env.DB,
    "INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES(?,?,?,?)",
    "incident",
    m.id,
    1000,
    "timeout"
  ).run();
  await statement(
    env.DB,
    "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) VALUES('mail','incident','opened','Monitor',1000,1000)"
  ).run();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("", { status: 503 }));
  const production = {
    ...env,
    ENVIRONMENT: "production",
    OWNER_EMAIL: "support@am25.work",
    POSTMARK_FROM: "noreply@am25.work",
    POSTMARK_TOKEN: "test-token"
  };
  await deliverNotifications(production, 1000, fetcher);
  expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body)).To).toBe(
    "support@am25.work"
  );
  expect(
    (
      await first<{ state: string }>(
        env.DB,
        "SELECT * FROM notifications WHERE id='mail'"
      )
    )?.state
  ).toBe("pending");
  fetcher.mockResolvedValue(Response.json({ ErrorCode: 0 }));
  await deliverNotifications(production, 1200, fetcher);
  expect(
    (
      await first<{ state: string }>(
        env.DB,
        "SELECT * FROM notifications WHERE id='mail'"
      )
    )?.state
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
        1000 + i
      )
    )
  );
  const response = await worker.fetch(
    new Request(
      `http://localhost/api/v1/admin/monitors/${m.id}/results?from=1000&to=1100`
    ),
    env
  );
  const page = (await response.json()) as {
    results: unknown[];
    nextCursor: number;
  };
  expect(page.results).toHaveLength(50);
  expect(page.nextCursor).toBeTypeOf("number");
  const next = await worker.fetch(
    new Request(
      `http://localhost/api/v1/admin/monitors/${m.id}/results?from=1000&to=1100&cursor=${page.nextCursor}`
    ),
    env
  );
  expect(((await next.json()) as { results: unknown[] }).results).toHaveLength(
    1
  );
  await statement(
    env.DB,
    "INSERT INTO incidents(id,monitor_id,opened_at,reason) VALUES('i',?,1000,'timeout')",
    m.id
  ).run();
  await statement(
    env.DB,
    "INSERT INTO notifications(id,incident_id,event,monitor_name,created_at,next_attempt) VALUES('n','i','opened','Monitor',1000,1000)"
  ).run();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("", { status: 422 }));
  await deliverNotifications(
    { ...env, ENVIRONMENT: "production", POSTMARK_TOKEN: "token" },
    1000,
    fetcher
  );
  expect(
    (
      await first<{ state: string }>(
        env.DB,
        "SELECT state FROM notifications WHERE id='n'"
      )
    )?.state
  ).toBe("failed");
});
