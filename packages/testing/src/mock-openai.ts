import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface MockOpenAIUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens?: number;
}

export interface MockOpenAIScript {
  readonly text?: readonly string[];
  readonly reasoning?: readonly string[];
  readonly toolCalls?: readonly MockToolCall[];
  readonly delayMs?: number;
  readonly failStatus?: number;
  readonly failStatusOnce?: number;
  readonly failBody?: unknown;
  readonly finishReason?: string;
  readonly omitUsage?: boolean;
  readonly stallAfterChunks?: number;
  readonly stallMs?: number;
  readonly usage?: MockOpenAIUsage;
}

export interface MockToolCall {
  readonly id?: string;
  readonly name: string;
  readonly args?: Record<string, unknown>;
  readonly fragments?: readonly string[];
  readonly malformedArguments?: string;
}

interface MutableScript {
  text: readonly string[];
  reasoning: readonly string[];
  toolCalls: readonly MockToolCall[];
  delayMs: number;
  failStatus?: number;
  failStatusOnce?: number;
  failBody?: unknown;
  failServed: boolean;
  finishReason: string;
  omitUsage: boolean;
  stallAfterChunks?: number;
  stallMs?: number;
  usage?: MockOpenAIUsage;
}

const toMutableScript = (script: MockOpenAIScript): MutableScript => ({
  delayMs: script.delayMs ?? 0,
  failServed: false,
  finishReason: script.finishReason ?? "stop",
  omitUsage: script.omitUsage ?? false,
  reasoning: script.reasoning ?? [],
  text: script.text ?? ["mock response"],
  toolCalls: script.toolCalls ?? [],
  ...(script.failBody !== undefined ? { failBody: script.failBody } : {}),
  ...(script.failStatus !== undefined ? { failStatus: script.failStatus } : {}),
  ...(script.failStatusOnce !== undefined ? { failStatusOnce: script.failStatusOnce } : {}),
  ...(script.stallAfterChunks !== undefined ? { stallAfterChunks: script.stallAfterChunks } : {}),
  ...(script.stallMs !== undefined ? { stallMs: script.stallMs } : {}),
  ...(script.usage ? { usage: script.usage } : {})
});

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const writeJson = (response: ServerResponse, status: number, body: unknown): void => {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "content-length": Buffer.byteLength(encoded),
    "content-type": "application/json; charset=utf-8"
  });
  response.end(encoded);
};

const readBody = async (request: IncomingMessage): Promise<string> => {
  let body = "";
  for await (const chunk of request) {
    body += chunk.toString();
  }
  return body;
};

export class MockOpenAIChatServer {
  readonly #server: Server;
  readonly #queue: MutableScript[] = [];
  #defaultScript = toMutableScript({});
  #url: string | undefined;
  #requests = 0;
  readonly requestBodies: unknown[] = [];

  private constructor() {
    this.#server = createServer((request, response) => {
      void this.#handle(request, response).catch((error: unknown) => {
        writeJson(response, 500, { error: { message: (error as Error).message } });
      });
    });
  }

  static async start(script: MockOpenAIScript = {}): Promise<MockOpenAIChatServer> {
    const server = new MockOpenAIChatServer();
    server.setDefaultScript(script);
    await new Promise<void>((resolve, reject) => {
      server.#server.once("error", reject);
      server.#server.listen(0, "127.0.0.1", () => {
        server.#server.off("error", reject);
        resolve();
      });
    });
    const address = server.#server.address();
    if (!address || typeof address !== "object") {
      throw new Error("mock server did not bind a TCP port");
    }
    server.#url = `http://127.0.0.1:${address.port}`;
    return server;
  }

  get url(): string {
    if (!this.#url) {
      throw new Error("mock server is not started");
    }
    return this.#url;
  }

  get requests(): number {
    return this.#requests;
  }

  setDefaultScript(script: MockOpenAIScript): void {
    this.#defaultScript = toMutableScript(script);
  }

  enqueueScript(script: MockOpenAIScript): void {
    this.#queue.push(toMutableScript(script));
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
  }

  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      writeJson(response, 404, { error: { message: "not found" } });
      return;
    }
    const rawBody = await readBody(request);
    const parsedBody = JSON.parse(rawBody) as unknown;
    this.requestBodies.push(parsedBody);
    this.#requests += 1;

    // Parity with real providers (DeepSeek/OpenAI): function names must match
    // ^[a-zA-Z0-9_-]+$. Enforcing it here means the mock rejects dotted tool names
    // exactly as a real provider would — the gap that let a wire-name bug reach prod.
    const toolNames = ((parsedBody as { tools?: readonly { function?: { name?: unknown } }[] }).tools ?? [])
      .map((tool) => tool.function?.name)
      .filter((name): name is string => typeof name === "string");
    const badName = toolNames.find((name) => !/^[a-zA-Z0-9_-]+$/.test(name));
    if (badName !== undefined) {
      writeJson(response, 400, {
        error: {
          code: "invalid_request_error",
          message: `Invalid 'tools[].function.name': '${badName}' does not match pattern '^[a-zA-Z0-9_-]+$'.`,
          type: "invalid_request_error"
        }
      });
      return;
    }

    const script = this.#queue[0] ?? this.#defaultScript;
    if (script.failStatus) {
      writeJson(response, script.failStatus, script.failBody ?? { error: { message: "provider failure" } });
      return;
    }
    if (script.failStatusOnce && !script.failServed) {
      script.failServed = true;
      writeJson(response, script.failStatusOnce, script.failBody ?? { error: { message: "temporary failure" } });
      return;
    }
    if (this.#queue[0] === script) {
      this.#queue.shift();
    }

    response.writeHead(200, {
      "cache-control": "no-cache",
      "content-type": "text/event-stream; charset=utf-8"
    });

    let sentChunks = 0;
    const writeData = async (value: unknown): Promise<void> => {
      if (script.delayMs > 0) {
        await sleep(script.delayMs);
      }
      if (script.stallAfterChunks !== undefined && sentChunks >= script.stallAfterChunks) {
        await sleep(script.stallMs ?? 120_000);
      }
      response.write(`data: ${JSON.stringify(value)}\n\n`);
      sentChunks += 1;
    };

    if (script.toolCalls.length > 0) {
      const wholeCalls = script.toolCalls.filter((call) => !call.fragments);
      if (wholeCalls.length > 0) {
        await writeData({
          choices: [{
            delta: {
              tool_calls: wholeCalls.map((call, index) => ({
                function: {
                  arguments: call.malformedArguments ?? JSON.stringify(call.args ?? {}),
                  name: call.name
                },
                id: call.id ?? `call_${index}`,
                index,
                type: "function"
              }))
            },
            finish_reason: null
          }]
        });
      }

      for (const [index, call] of script.toolCalls.entries()) {
        if (!call.fragments) {
          continue;
        }
        for (const [fragmentIndex, fragment] of call.fragments.entries()) {
          await writeData({
            choices: [{
              delta: {
                tool_calls: [{
                  function: {
                    arguments: fragment,
                    ...(fragmentIndex === 0 ? { name: call.name } : {})
                  },
                  ...(fragmentIndex === 0 ? { id: call.id ?? `call_${index}`, type: "function" } : {}),
                  index
                }]
              },
              finish_reason: null
            }]
          });
        }
      }

      await writeData({
        choices: [{ delta: {}, finish_reason: "tool_calls" }],
        ...(script.omitUsage ? {} : { usage: script.usage ?? { completion_tokens: 0, prompt_tokens: 4, total_tokens: 4 } })
      });
      response.write("data: [DONE]\n\n");
      response.end();
      return;
    }

    const max = Math.max(script.reasoning.length, script.text.length);
    for (let index = 0; index < max; index += 1) {
      const reasoning = script.reasoning[index];
      if (reasoning) {
        await writeData({ choices: [{ delta: { reasoning_content: reasoning }, finish_reason: null }] });
      }
      const text = script.text[index];
      if (text) {
        await writeData({ choices: [{ delta: { content: text }, finish_reason: null }] });
      }
    }

    await writeData({
      choices: [{ delta: {}, finish_reason: script.finishReason }],
      ...(script.omitUsage
        ? {}
        : {
            usage: script.usage ?? {
              completion_tokens: script.text.join("").length,
              prompt_tokens: 4,
              total_tokens: script.text.join("").length + 4
            }
          })
    });
    response.write("data: [DONE]\n\n");
    response.end();
  }
}
