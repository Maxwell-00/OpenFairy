# Spec: Model Gateway

| | |
|---|---|
| Status | Draft v0.1 |
| Requirements | FR-12, FR-12a, FR-7 (cross-vendor roles), NFR-7/8/9 |
| Package | `packages/model-gateway` |

The model gateway is the **only** path between Fairy and any LLM. It makes every OpenAI-compatible endpoint usable, makes vendor differences invisible to the kernel, and lets every agent role bind to a different model/vendor.

## 1. Design position

- **Primary wire format: OpenAI Chat Completions.** It is the de-facto lingua franca implemented by vLLM, Ollama, llama.cpp server, LM Studio, DeepSeek, Qwen/DashScope, Moonshot, Zhipu, OpenRouter, Groq, Mistral, and OpenAI itself. Fairy's internal request/response model is a superset of it.
- **Secondary transports as adapters.** `openai-responses` and `anthropic-messages` transports translate to/from the internal model (Hermes-style `ProviderTransport` abstraction), so "OpenAI-compatible" is the floor, not the ceiling. Adding a transport is one file + conformance fixtures.
- **Normalize at the edge.** Everything past the gateway sees one event shape. Vendor quirks die here and only here.

## 2. Model registry

Declarative registry (`fairy.yaml → models:`), one entry per model endpoint:

```yaml
models:
  - id: local-glm
    transport: openai-chat            # openai-chat | openai-responses | anthropic
    base_url: http://192.168.1.20:8000/v1
    api_key_ref: secret://vllm        # secrets resolved at the edge, never logged
    model: glm-4.7-awq
    capabilities:                     # declared; probed on first use, cached
      tools: native                   # native | prompted | none
      parallel_tools: false
      vision: false
      json_mode: prompted
      reasoning_channel: think-tag    # none | field:reasoning_content | think-tag | openai-reasoning
      context_window: 131072
      max_output: 16384
    pricing: { in: 0.0, out: 0.0 }    # per-1M tokens; 0 for self-hosted
    data_clearance: { max_sensitivity: secret, residency: [local-only, global-ok] }
    tags: [main-capable, cn]
  - id: vision-flash
    transport: openai-chat
    base_url: https://api.example.com/v1
    model: some-vlm
    capabilities: { vision: true, tools: native, context_window: 262144 }
```

**Capability probing.** On first use (and on `fairy doctor`), the gateway runs a probe suite: minimal tool call, streaming chunk shape, JSON mode, image input. Probe results override optimistic declarations and are cached with the endpoint's reported model build.

## 3. Role router

Agent code never names a model; it names a **role**. Roles are bound in config — this is what makes main agent and subagents cross-vendor (FR-7):

```yaml
roles:
  main:            { model: local-glm, fallback: [kimi-k3, gpt-x] }
  planner:         { model: kimi-k3 }
  subagent.research: { model: deepseek-v4 }
  subagent.coder:  { model: local-glm }
  summarizer:      { model: cheap-fast, max_cost_per_call: 0.002 }
  memory.extractor: { model: cheap-fast }
  perception.vision: { model: vision-flash }
  embedder:        { model: local-embed }
  voice.fastpath:  { model: cheap-fast, max_latency_ms: 700 }
```

Routing decision inputs: role binding → **data clearance** (max label of assembled context vs. the target's `data_clearance`; violation → next cleared fallback → else visible `route.denied` event, never a silent downgrade — specs/data-governance §3) → **routing hints** (`prefer_local` reorders the cleared candidates, never filters them) → health score (circuit breaker state, rolling error rate, p95 latency) → budget guard (ledger) → fallback chain. Every decision is traced (which model, why).

*Implementation status v0 (M1-01): `openai-chat` transport is hand-rolled HTTP + SSE (vendor SDKs forbidden by dependency rule); single role binding, no fallback chains yet (M1-04); clearance runs trace-only (recorded in `model_trace`; enforcement flips at M2 per ROADMAP).*

## 4. Normalization layer

The hard part of "OpenAI-compatible" is that nobody is quite compatible. Known variance the gateway absorbs, each covered by conformance fixtures:

| Variance | Normalization |
|---|---|
| Streaming tool-call deltas (arguments chunked differently; some omit `type`/`index`; some emit whole calls at once) | Stateful reassembler per choice; emits a single normalized `tool_call` event when arguments parse as complete JSON. Name-first deltas with empty arguments are **held open** (empty ≠ `{}`) until fragments complete or the stream ends |
| `tool_choice` support (absent/partial on vLLM & others) | Feature-detect; emulate `required`/named-tool via prompted-tools path |
| Reasoning channels (`reasoning_content` field vs `<think>` tags vs OpenAI reasoning items) | Extracted into a separate `reasoning` delta stream; never enters history sent back to models that would choke on it |
| Parameter support (some reject `frequency_penalty`, `logprobs`, etc.) | Per-model param allowlist; unknown params stripped, warned once |
| Finish reasons & error bodies | Mapped to internal enums / error taxonomy (`ProviderError{retryable, rate_limited, auth, context_overflow}`) |
| Usage reporting (missing, partial, or non-standard) | Fallback to local tokenizer estimate; ledger marks `estimated: true` |
| Multi-modal message shapes | Internal content-part model; downconverted per transport |
| Keepalive/idle streams | Watchdog timeout with clean abort + retry policy |

## 5. Tool-calling degradation ladder (FR-12)

1. **Native** — model emits structured tool calls; pass through.
2. **Prompted** — for models without tool tokens: gateway renders tool schemas into the system prompt (compact typed signatures), instructs a fenced `tool_call` JSON output grammar, parses with a tolerant parser (handles trailing prose, CJK punctuation), validates against JSON Schema, and runs a bounded **repair loop** (re-prompt with the validation error, ≤ 2 attempts) before surfacing a `ToolError`.
3. **None** — role marked tool-incapable; router refuses to bind it to tool-requiring roles at config-validation time, not at runtime.

Same ladder pattern applies to JSON mode: `native json_schema → json_object + validate → prompted + validate + repair`.

## 6. Perception service (FR-12a)

Lets a **text-only main brain** work with images, PDFs, audio, and video by delegating to bound perception roles.

- **Ingest path:** every non-text attachment (from user or tool) is registered as an artifact (content-hashed). The perception service produces a **structured description artifact**: caption, salient entities, OCR text, layout hints (for screenshots/PDFs), and stores it in the content-addressed cache — same input never re-billed.
- **Prompt injection:** the turn sees `[image #1: <structured description> (artifact: path)]` inline where the attachment appeared.
- **On-demand tools:** `vision.describe(artifact, question)` and `vision.ocr(artifact, region?)` let the main model re-interrogate an image with a specific question — the vision model answers the question, not just re-captions.
- **Audio:** routed to the ASR path (voice spec); **documents:** parser first (text extraction), vision model only for scanned/graphical pages.
- Perception outputs carry `provenance: tool:vision` and inherit the source's trust level (a hostile image's OCR text is untrusted content — see sandbox-security spec).

## 7. Interface (conceptual)

One method, streaming, normalized:

```
generate(role | modelId, request: {messages, tools?, response_format?, budget?, abort})
  → stream of: {type: text | reasoning | tool_call | usage | error | done, ...}
```

Plus: `embed(role, texts[])`, `registry` queries, and `probe(modelId)`. The kernel composes everything else.

## 8. Failure behavior

- Retryable provider errors: jittered backoff (transport layer only, ≤ 3 attempts), then fallback chain, then user-visible degradation message. No silent model switching mid-turn: a fallback switch is an event the user can see.
- Context overflow error from provider → signals the context engine to run its reduction ladder and retry once (see context-engine spec).
- Budget exceeded → `PolicyError` before the call is made; scheduler decides (pause workflow, ask user).

## 9. Testing

- **Conformance kit** (`packages/testing`): golden fixtures per provider for streaming shapes, tool deltas, reasoning channels, errors; replayed against the normalizer in CI; recorded from live endpoints via a capture proxy.
- Nightly **canary probes** against configured live endpoints; failures downgrade health scores and notify.
- Fuzzed prompted-tool parser corpus (malformed JSON, mixed CJK punctuation, prose-wrapped calls).
