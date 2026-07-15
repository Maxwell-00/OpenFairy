import type { EventEnvelope } from "@fairy/protocol";

export type GatewaySocketSurface = "default" | "web-v0";

const webOps = new Set(["session.create", "session.attach", "voice.asr"]);
const webAckFields = [
  "kind",
  "op",
  "sid",
  "turn",
  "cancelled",
  "error_status",
  "error_category",
  "transcript_text",
  "assistant_final_text",
  "asr_final_count",
  "turn_input_count",
  "model_request_count",
  "tts_chunk_count",
  "tts_audio_ref",
  "event_counts"
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const bounded = (value: unknown, maximum = 700): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  return value.length <= maximum ? value : `${value.slice(0, maximum)}...`;
};

const contentText = (payload: Record<string, unknown>): string =>
  (Array.isArray(payload.content) ? payload.content : [])
    .flatMap((part): string[] => isRecord(part) && part.kind === "text" && typeof part.text === "string" ? [part.text] : [])
    .join("\n");

const common = (event: EventEnvelope): Record<string, unknown> => ({
  id: event.id,
  labels: event.labels,
  sid: event.sid,
  turn: event.turn,
  type: event.type
});

export const socketSurfaceFromUrl = (url: string | undefined): GatewaySocketSurface => {
  const parsed = new URL(url ?? "/", "http://127.0.0.1");
  return parsed.searchParams.get("surface") === "web-v0" ? "web-v0" : "default";
};

export const isWebSocketOpAllowed = (op: string): boolean => webOps.has(op);

export const projectEventForWeb = (event: EventEnvelope): Record<string, unknown> | undefined => {
  const payload = isRecord(event.payload) ? event.payload : {};
  const base = common(event);
  if (event.type === "session.created") {
    return { ...base, payload: { created_at: bounded(payload.created_at), title: bounded(payload.title, 200) } };
  }
  if (event.type === "session.resumed") {
    return { ...base, payload: { resumed_at: bounded(payload.resumed_at) } };
  }
  if (event.type === "speech.asr.final") {
    return {
      ...base,
      payload: {
        audio_ref: bounded(payload.audio_ref, 80),
        text: bounded(payload.text, 20_000),
        utterance_id: bounded(payload.utterance_id, 160)
      }
    };
  }
  if (event.type === "speech.tts.chunk") {
    return {
      ...base,
      payload: {
        audio_ref: bounded(payload.audio_ref, 80),
        chunk_id: bounded(payload.chunk_id, 160),
        text: bounded(payload.text, 3_000)
      }
    };
  }
  if (event.type === "turn.input" || event.type === "turn.delta" || event.type === "turn.final") {
    return { ...base, payload: { text: bounded(contentText(payload), 20_000) } };
  }
  if (event.type === "speech.mark") {
    return { ...base, payload: { mark_id: bounded(payload.mark_id, 120), position_ms: payload.position_ms } };
  }
  if (event.type === "progress.update") {
    return {
      ...base,
      payload: {
        detail: bounded(payload.detail),
        error_code: bounded(payload.error_code, 120),
        stage: bounded(payload.stage, 120)
      }
    };
  }
  if (event.type === "error" || event.type === "route.denied") {
    return { ...base, payload: { detail: "The request could not be completed.", error_code: "request_failed" } };
  }
  return undefined;
};

const genericStatus = (value: unknown): unknown => {
  if (value === "none" || value === "cancelled" || value === "asr_cancelled" || value === "asr_input_invalid" || value === "asr_route_denied") {
    return value;
  }
  return value === undefined ? undefined : "request_failed";
};

export const projectFrameForWeb = (frame: Record<string, unknown>): Record<string, unknown> => {
  if (frame.kind === "op-error") {
    return {
      kind: "op-error",
      op: typeof frame.op === "string" ? frame.op : "unknown",
      ...(typeof frame.sid === "string" ? { sid: frame.sid } : {}),
      message: "The request could not be completed.",
      error_status: "request_failed"
    };
  }
  const projected: Record<string, unknown> = {};
  for (const field of webAckFields) {
    if (frame[field] !== undefined) {
      projected[field] = field === "error_status" || field === "error_category" ? genericStatus(frame[field]) : frame[field];
    }
  }
  return projected;
};
