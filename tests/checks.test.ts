import { describe, it, expect, vi } from "vitest";
import {
  equalJson,
  httpCheck,
  jsonPointer,
  matchesCode,
  readBounded,
  tcpCheck
} from "../src/worker/checks";
import { httpInput, monitorInput } from "../src/shared/schema";
import { seal, unseal } from "../src/worker/crypto";
import { env } from "cloudflare:test";
import type { HttpConfig } from "../src/shared/types";

const config: HttpConfig = {
  url: "https://example.test/health",
  method: "GET",
  headers: {},
  codes: "200-299",
  followRedirects: false,
  timeoutSeconds: 1,
  assertion: "none"
};
describe("HTTP checks", () => {
  it("accepts configured ranges and rejects unexpected responses", async () => {
    expect(matchesCode(204, "200-299,401")).toBe(true);
    expect(matchesCode(503, "200-299")).toBe(false);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("", { status: 503 }));
    expect((await httpCheck(config, fetcher)).reason).toBe("http_status");
    expect(fetcher.mock.calls[0][1]?.redirect).toBe("manual");
  });
  it("checks text and JSON without retaining response contents", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('{"database":{"ok":true},"password":"private"}')
      );
    expect(
      (
        await httpCheck(
          {
            ...config,
            assertion: "json",
            pointer: "/database/ok",
            expected: true
          },
          fetcher
        )
      ).ok
    ).toBe(true);
    expect(
      (
        await httpCheck(
          { ...config, assertion: "text", text: "missing" },
          vi.fn<typeof fetch>().mockResolvedValue(new Response("private"))
        )
      ).diagnostic
    ).not.toContain("private");
  });
  it("enforces the body limit and cancels the stream", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new Uint8Array(262145));
      },
      cancel
    });
    await expect(readBounded(new Response(stream))).rejects.toThrow(
      "body_limit"
    );
    expect(cancel).toHaveBeenCalled();
  });
  it("distinguishes timeouts from connection failures", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async (_url, options) =>
          new Promise((_resolve, reject) =>
            options?.signal?.addEventListener("abort", () =>
              reject(new Error("abort"))
            )
          )
      );
    expect((await httpCheck(config, fetcher)).reason).toBe("timeout");
    expect(
      (
        await httpCheck(
          config,
          vi
            .fn<typeof fetch>()
            .mockRejectedValue(new Error("credential secret"))
        )
      ).diagnostic
    ).not.toContain("secret");
  });
  it("validates JSON Pointer escaping and compares object values without key order", () => {
    expect(jsonPointer({ "a/b": { "~x": false } }, "/a~1b/~0x")).toBe(false);
    expect(jsonPointer({}, "/toString")).toBeUndefined();
    expect(equalJson({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
    expect(equalJson([1], { "0": 1 })).toBe(false);
  });
  it("rejects invalid status ranges, HEAD assertions and URL credentials", () => {
    expect(httpInput.safeParse({ ...config, codes: "299-200" }).success).toBe(
      false
    );
    expect(
      httpInput.safeParse({
        ...config,
        method: "HEAD",
        assertion: "text",
        text: "ok"
      }).success
    ).toBe(false);
    expect(
      httpInput.safeParse({
        ...config,
        url: "https://user:password@example.test"
      }).success
    ).toBe(false);
    expect(
      monitorInput.safeParse({
        name: "X",
        project_id: "not-a-uuid",
        kind: "http",
        config
      }).success
    ).toBe(false);
  });
  it("encrypts configuration and binds ciphertext to its monitor", async () => {
    const encrypted = await seal(
      { Authorization: "secret-value" },
      env.CONFIG_KEY,
      "a"
    );
    expect(encrypted).not.toContain("secret-value");
    expect(await unseal(encrypted, env.CONFIG_KEY, "a")).toEqual({
      Authorization: "secret-value"
    });
    await expect(unseal(encrypted, env.CONFIG_KEY, "b")).rejects.toThrow();
  });
});

it("handles TCP connection success, timeout and rejected connections without exposing errors", async () => {
  const close = vi.fn().mockResolvedValue(undefined);
  const socket = (opened: Promise<SocketInfo>): Socket => ({
    upgraded: false,
    secureTransport: "off",
    opened,
    closed: Promise.resolve(),
    close,
    readable: new ReadableStream(),
    writable: new WritableStream(),
    startTls() {
      return this;
    }
  });
  const config = { host: "service.test", port: 443, timeoutSeconds: 1 };
  expect(
    (
      await tcpCheck(config, () =>
        socket(
          Promise.resolve({
            remoteAddress: "service.test",
            localAddress: "local"
          })
        )
      )
    ).ok
  ).toBe(true);
  expect(close).toHaveBeenCalledOnce();
  expect(
    (await tcpCheck(config, () => socket(new Promise(() => {})))).reason
  ).toBe("timeout");
  const result = await tcpCheck(config, () => {
    throw new Error("private destination");
  });
  expect(result.reason).toBe("connection");
  expect(result.diagnostic).not.toContain("private destination");
});
