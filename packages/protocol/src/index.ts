export { parseEvent, serializeEvent } from "./codec.js";
export { createEventId, createSessionId } from "./ids.js";
export { stableStringify } from "./json.js";
export { fixturesDir, protocolRoot, schemasDir } from "./paths.js";
export {
  eventRegistry,
  eventTypes,
  getSchemaPath,
  isRegisteredEventType,
  protocolVersion
} from "./registry.js";
export { assertValidEvent, validateEvent } from "./validation.js";
export type {
  Actor,
  EventEnvelope,
  EventRegistryEntry,
  Labels,
  Provenance,
  Residency,
  Sensitivity,
  ValidationIssue,
  ValidationResult
} from "./types.js";
