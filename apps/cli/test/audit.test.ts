import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runAudit } from "../src/index.js";

let server: Server | undefined;

afterEach(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
  server = undefined;
  vi.restoreAllMocks();
});

const startAuditServer = async (body: unknown): Promise<string> => {
  server = createServer((request, response) => {
    if (!request.url?.startsWith("/audit")) {
      response.writeHead(404).end();
      return;
    }
    const encoded = JSON.stringify(body);
    response.writeHead(200, {
      "content-length": Buffer.byteLength(encoded),
      "content-type": "application/json; charset=utf-8"
    });
    response.end(encoded);
  });
  await new Promise<void>((resolve, reject) => {
    server?.once("error", reject);
    server?.listen(0, "127.0.0.1", () => {
      server?.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address !== "object") {
    throw new Error("audit test server did not bind");
  }
  return `http://127.0.0.1:${address.port}`;
};

describe("fairy audit", () => {
  it("prints redacted egress denial details in text and JSON modes", async () => {
    const rawSecret = "sk_test_1234567890abcdef";
    const body = {
      entries: [{
        actor: null,
        decision: "deny",
        details: "{\"reason_code\":\"api_key\",\"args\":{\"url\":\"https://example.test/?token=[REDACTED:api_key:sha256:abc123]\"}}",
        id: 1,
        op: "egress.denied",
        sid: "ses_01J00000000000000000000000",
        tool: "web.fetch",
        ts: "2026-07-02T10:00:00.000Z",
        turn: 1
      }]
    };
    const gateway = await startAuditServer(body);
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line = "") => {
      lines.push(String(line));
    });

    await runAudit(["--gateway", gateway, "--token", "dev-token"]);
    await runAudit(["--gateway", gateway, "--token", "dev-token", "--json"]);

    const output = lines.join("\n");
    expect(output).toContain("egress.denied web.fetch deny");
    expect(output).toContain("[REDACTED:api_key:sha256:abc123]");
    expect(output).toContain("\"entries\"");
    expect(output).not.toContain(rawSecret);
  });
});
