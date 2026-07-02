import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

export interface MockOpenAIUsage {
  readonly prompt_tokens: number;
  readonly completion_tokens: number;
  readonly total_tokens?: number;
}

export interface MockOpenAIScript {
  readonly text?: readonly string[];
  readonly reasoning?: readonly string[];
  readonly delayMs?: number;
  readonly failStatusOnce?: number;
  readonly failBody?: unknown;
  readonly stallAfterChunks?: number;
  readonly stallMs?: number;
  readonly usage?: MockOpenAIUsage;
}

interface MutableScript {
  text: readonly string[];
  reasoning: readonly string[];
  delayMs: number;
  failStatusOnce?: number;
  failBody?: unknown;
  failServed: boolean;
  stallAfterChunks?: number;
  stallMs?: number;
  usage?: MockOpenAIUsage;
}

const toMutableScript = (script: MockOpenAIScript): MutableScript => ({
  delayMs: script.delayMs ?? 0,
  failServed: false,
  reasoning: script.reasoning ?? [],
  text: script.text ?? ["mock response"],
  ...(script.failBody !== undefined ? { failBody: script.failBody } : {}),
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
    await readBody(request);
    this.#requests += 1;

    const script = this.#queue[0] ?? this.#defaultScript;
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
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: script.usage ?? {
        completion_tokens: script.text.join("").length,
        prompt_tokens: 4,
        total_tokens: script.text.join("").length + 4
      }
    });
    response.write("data: [DONE]\n\n");
    response.end();
  }
}
