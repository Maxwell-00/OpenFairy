import { eventTypes } from "@fairy/protocol";

export { MockOpenAIChatServer } from "./mock-openai.js";
export type { MockOpenAIScript, MockOpenAIUsage } from "./mock-openai.js";
export {
  acceptIncomingEvent,
  assertM0TurnShape,
  assertMonotonicUlidsPerSession,
  assertM1TurnCompletes,
  assertSchemaValidStream,
  MockFairyClient
} from "./mock-client.js";
export type { MockClientOptions, TurnInputPayload } from "./mock-client.js";

export const protocolConformanceSuite = {
  package: "@fairy/testing",
  protocolVersion: 1,
  eventTypes
} as const;
