import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("stdio bridge forwards tool discovery, credentials and structured results", async () => {
  let authenticatedRequests = 0;
  const http = createServer(async (request, response) => {
    assert.equal(request.url, "/mcp");
    assert.equal(request.headers.authorization, "Bearer bridge-test-token");
    authenticatedRequests++;
    if (request.method !== "POST") { response.writeHead(405).end(); return; }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString());
    if (message.id === undefined) { response.writeHead(202).end(); return; }
    const result = message.method === "initialize" ? {
      protocolVersion: message.params.protocolVersion,
      serverInfo: { name: "test-monitor", version: "1.0.0" }, capabilities: { tools: {} }
    } : message.method === "tools/list" ? {
      tools: [{ name: "get_data_policy", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } }]
    } : { content: [{ type: "text", text: '{"timezone":"UTC"}' }], structuredContent: { timezone: "UTC" } };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
  });
  await new Promise((resolve) => http.listen(0, "127.0.0.1", resolve));
  const client = new Client({ name: "stdio-test", version: "1.0.0" });
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../scripts/mcp.mjs", import.meta.url))],
      env: { MONITOR_ORIGIN: `http://127.0.0.1:${http.address().port}`, MONITOR_ANALYTICS_TOKEN: "bridge-test-token" }
    }));
    const tools = await client.listTools();
    assert.equal(tools.tools[0].annotations.readOnlyHint, true);
    const result = await client.callTool({ name: "get_data_policy", arguments: {} });
    assert.deepEqual(result.structuredContent, { timezone: "UTC" });
    assert.ok(authenticatedRequests >= 4);
  } finally {
    await client.close();
    http.closeAllConnections();
    await new Promise((resolve) => http.close(resolve));
  }
});
