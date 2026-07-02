import type { EventEnvelope } from "@fairy/protocol";
import { mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";

export class EventLog {
  readonly #dataDir: string;
  readonly #writes = new Map<string, Promise<void>>();

  constructor(dataDir: string) {
    this.#dataDir = dataDir;
  }

  append(event: EventEnvelope): Promise<void> {
    const previous = this.#writes.get(event.sid) ?? Promise.resolve();
    const next = previous.then(async () => {
      const sessionDir = join(this.#dataDir, "sessions", event.sid);
      await mkdir(sessionDir, { recursive: true });
      await appendFile(join(sessionDir, "log.jsonl"), `${JSON.stringify(event)}\n`, "utf8");
    });

    this.#writes.set(event.sid, next.catch(() => undefined));
    return next;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.#writes.values()]);
  }
}
