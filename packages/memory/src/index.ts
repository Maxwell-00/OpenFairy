import { createHash } from "node:crypto";

export interface MemoryLabels {
  readonly sensitivity: "public" | "internal" | "personal" | "secret";
  readonly residency: "local-only" | "region-restricted" | "global-ok";
}

export interface MemoryCandidate {
  readonly text: string;
  readonly source: {
    readonly sid: string;
    readonly turn: number;
    readonly event_id?: string;
  };
  readonly labels: MemoryLabels;
  readonly reason: string;
  readonly category: "preference" | "fact" | "note" | "secret";
}

export type MemoryGateDecision = "allow" | "deny" | "hold";

export interface MemoryGateResult {
  readonly candidate: MemoryCandidate;
  readonly decision: MemoryGateDecision;
  readonly memory_id: string;
  readonly reason: string;
}

export interface MemoryGateOptions {
  readonly internalDefault?: Extract<MemoryGateDecision, "allow" | "hold">;
  readonly personalDefault?: Extract<MemoryGateDecision, "allow" | "hold">;
}

const hashText = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 20);

export class MemoryGate {
  readonly #internalDefault: Extract<MemoryGateDecision, "allow" | "hold">;
  readonly #personalDefault: Extract<MemoryGateDecision, "allow" | "hold">;

  constructor(options: MemoryGateOptions = {}) {
    this.#internalDefault = options.internalDefault ?? "allow";
    this.#personalDefault = options.personalDefault ?? "hold";
  }

  evaluate(candidate: MemoryCandidate): MemoryGateResult {
    const memoryId = `mem_${hashText(`${candidate.source.sid}:${candidate.source.turn}:${candidate.text}`)}`;

    if (candidate.labels.sensitivity === "secret" || candidate.category === "secret") {
      return {
        candidate,
        decision: "deny",
        memory_id: memoryId,
        reason: "secret_denied"
      };
    }

    if (candidate.labels.sensitivity === "personal") {
      return {
        candidate,
        decision: this.#personalDefault,
        memory_id: memoryId,
        reason: this.#personalDefault === "allow" ? "personal_default_allow" : "personal_default_hold"
      };
    }

    return {
      candidate,
      decision: this.#internalDefault,
      memory_id: memoryId,
      reason: this.#internalDefault === "allow" ? "explicit_remember" : "internal_default_hold"
    };
  }
}

const rememberPatterns: readonly RegExp[] = [
  /\bremember(?:\s+that)?\s+(?<text>.+)$/i,
  /\bplease remember\s+(?<text>.+)$/i,
  /(?:\u8bf7)?\u8bb0\u4f4f(?<text>.+)$/
];

export const proposeMemoryCandidate = (input: {
  readonly labels: MemoryLabels;
  readonly sid: string;
  readonly text: string;
  readonly turn: number;
  readonly event_id?: string;
}): MemoryCandidate | undefined => {
  for (const pattern of rememberPatterns) {
    const match = pattern.exec(input.text.trim());
    const text = match?.groups?.text?.trim();
    if (!text) {
      continue;
    }
    return {
      category: input.labels.sensitivity === "secret" ? "secret" : "preference",
      labels: input.labels,
      reason: "explicit_user_remember",
      source: {
        ...(input.event_id ? { event_id: input.event_id } : {}),
        sid: input.sid,
        turn: input.turn
      },
      text
    };
  }
  return undefined;
};
