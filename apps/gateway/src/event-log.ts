import { validateEvent, type EventEnvelope } from "@fairy/protocol";
import { mkdir, appendFile, readFile, readdir } from "node:fs/promises";
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

  async listSessionIds(): Promise<`ses_${string}`[]> {
    const sessionsDir = join(this.#dataDir, "sessions");
    try {
      const entries = await readdir(sessionsDir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isDirectory() && /^ses_[0-9A-HJKMNP-TV-Z]{26}$/.test(entry.name))
        .map((entry) => entry.name as `ses_${string}`)
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  async readSessionEvents(sid: `ses_${string}`): Promise<EventEnvelope[]> {
    const path = join(this.#dataDir, "sessions", sid, "log.jsonl");
    let content = "";
    try {
      content = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const events: EventEnvelope[] = [];
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const [index, line] of lines.entries()) {
      const parsed = JSON.parse(line) as unknown;
      const result = validateEvent(parsed);
      if (!result.ok) {
        throw new Error(`invalid event in ${path}:${index + 1}: ${result.issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
      }
      events.push(result.event);
    }
    return events;
  }

  async flush(): Promise<void> {
    await Promise.all([...this.#writes.values()]);
  }
}
