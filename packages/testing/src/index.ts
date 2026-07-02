import { eventTypes } from "@fairy/protocol";

export {
  acceptIncomingEvent,
  assertM0TurnShape,
  assertMonotonicUlidsPerSession,
  assertSchemaValidStream,
  MockFairyClient
} from "./mock-client.js";
export type { MockClientOptions, TurnInputPayload } from "./mock-client.js";

export const protocolConformanceSuite = {
  package: "@fairy/testing",
  protocolVersion: 1,
  eventTypes
} as const;
