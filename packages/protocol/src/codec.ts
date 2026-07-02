import { stableStringify } from "./json.js";
import { assertValidEvent } from "./validation.js";
import type { EventEnvelope } from "./types.js";

export const parseEvent = (source: string): EventEnvelope => assertValidEvent(JSON.parse(source));

export const serializeEvent = (event: EventEnvelope): string => stableStringify(assertValidEvent(event));
