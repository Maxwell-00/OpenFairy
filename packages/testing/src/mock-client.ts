import {
  validateEvent,
  type EventEnvelope,
  type ValidationResult
} from "@fairy/protocol";
import WebSocket from "ws";

export interface MockClientOptions {
  readonly token: string;
  readonly url: string;
}

export interface TurnInputPayload {
  readonly content: readonly { readonly kind: "text"; readonly text: string }[];
  readonly channel?: string;
}

export class MockFairyClient {
  readonly #socket: WebSocket;
  readonly #events: EventEnvelope[] = [];
  readonly #waiters: ((event: EventEnvelope) => void)[] = [];

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    this.#socket.on("message", (data) => {
      const parsed = JSON.parse(data.toString()) as unknown;
      const accepted = acceptIncomingEvent(parsed);
      if (accepted.ok) {
        this.#events.push(accepted.event);
        for (const waiter of this.#waiters.splice(0)) {
          waiter(accepted.event);
        }
      }
    });
  }

  static connect(options: MockClientOptions): Promise<MockFairyClient> {
    const url = new URL(options.url);
    url.searchParams.set("token", options.token);

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.once("open", () => resolve(new MockFairyClient(socket)));
      socket.once("error", reject);
      socket.once("close", (code, reason) => {
        if (code !== 1000 && code !== 1001) {
          reject(new Error(`websocket closed before open: ${code} ${reason.toString()}`));
        }
      });
    });
  }

  events(): readonly EventEnvelope[] {
    return this.#events;
  }

  close(): void {
    this.#socket.close(1000, "mock client done");
  }

  async createSession(title = "M0 mock client"): Promise<EventEnvelope> {
    this.#socket.send(JSON.stringify({ op: "session.create", title }));
    return this.waitFor((event) => event.type === "session.created");
  }

  async sendTurnInput(sid: string, payload: TurnInputPayload): Promise<readonly EventEnvelope[]> {
    const before = this.#events.length;
    this.#socket.send(JSON.stringify({ op: "turn.input", payload, sid }));
    await this.waitFor((event) => event.sid === sid && event.type === "turn.final");
    return this.#events.slice(before);
  }

  waitFor(predicate: (event: EventEnvelope) => boolean, timeoutMs = 5000): Promise<EventEnvelope> {
    const existing = this.#events.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.#waiters.indexOf(onEvent);
        if (index >= 0) {
          this.#waiters.splice(index, 1);
        }
        reject(new Error(`timed out waiting for event after ${timeoutMs} ms`));
      }, timeoutMs);

      const onEvent = (event: EventEnvelope): void => {
        if (!predicate(event)) {
          this.#waiters.push(onEvent);
          return;
        }
        clearTimeout(timer);
        resolve(event);
      };

      this.#waiters.push(onEvent);
    });
  }
}

export const acceptIncomingEvent = (value: unknown): ValidationResult => validateEvent(value);

export const assertSchemaValidStream = (events: readonly EventEnvelope[]): void => {
  for (const event of events) {
    const result = validateEvent(event);
    if (!result.ok) {
      throw new Error(`invalid event ${event.type}: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    }
  }
};

export const assertMonotonicUlidsPerSession = (events: readonly EventEnvelope[]): void => {
  const bySession = new Map<string, string[]>();
  for (const event of events) {
    bySession.set(event.sid, [...(bySession.get(event.sid) ?? []), event.id]);
  }

  for (const [sid, ids] of bySession) {
    const sorted = [...ids].sort();
    if (ids.join("\n") !== sorted.join("\n")) {
      throw new Error(`event ids are not monotonic for ${sid}`);
    }
  }
};

export const assertM0TurnShape = (events: readonly EventEnvelope[]): void => {
  const types = events.map((event) => event.type);
  if (types.join(",") !== "turn.input,turn.delta,turn.delta,turn.final") {
    throw new Error(`unexpected M0 turn shape: ${types.join(",")}`);
  }

  const turns = new Set(events.map((event) => event.turn));
  if (turns.size !== 1 || !turns.has(1)) {
    throw new Error(`unexpected M0 turn numbers: ${[...turns].join(",")}`);
  }
};
