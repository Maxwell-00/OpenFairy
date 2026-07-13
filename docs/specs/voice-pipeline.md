# Spec: Voice Pipeline

| | |
|---|---|
| Status | Draft v0.1 |
| Requirements | FR-2, NFR-1, NFR-6, NFR-10 |
| Components | `workers/speech` (Python) · gateway voice coordinator (TS) · voice-capable clients |

Goal: conversation that feels alive. Concretely: **stop-speaking → first audio p50 ≤ 1.2 s** (stretch 800 ms), interruptible at any moment, in Chinese and English, with pluggable cloud or local speech models.

*Implementation status — M3-01 (first slice, commit `bf6896e`): the §2 insurance-clause "in-process loopback" transport is live as `packages/voice` (`LoopbackVoiceTransport`) behind the gateway op `voice.loopback` and CLI `fairy voice loopback` — deterministic, no audio devices/providers/VAD/endpointing, no second TurnRunner. Speech event payload semantics and the voice-originated `turn.input` convention (envelope `provenance: "user"`, `payload.channel: "voice"`, additive `payload.speech: {utterance_id, audio_ref}`) are normative in protocol.md §5. The voice trust floor per data-governance §1a is enforced and test-gated: floor labels on the emitted `turn.input`, `prefer_local` advisory-only, zero request bytes to under-cleared providers, spoken "remember" held by MemoryGate (`personal_default_hold`) rather than auto-written, spoken-secret egress denied with redacted diagnostics, TTS derived only from visible `turn.final` text. Config surface registered in `packages/config`: `voice.enabled` (default `true`), `voice.transport` (closed enum `["loopback"]` for now), `voice.loopback.tts_chunk_chars` (deterministic loopback-only test knob — **not** this spec's §5 CJK-aware sentence chunker). PR-tier suite `voice.protocol-loopback-v0` is live (evals.md); the §10 latency/interrupt benches and §3–§9 acoustic machinery remain future M3 slices.*

*Implementation status — M3-02 (second slice, commit `fe8afc3`): the §2 gateway⇄worker duplex contract is live as internal frame protocol v0 in `packages/voice` — a **third frame family**, deliberately outside both the canonical event registry and the client op-frame set in `packages/protocol/frames/` (worker plane, not client protocol); golden valid/invalid fixtures in `packages/voice/fixtures/`. Implemented control kinds supersede §2's shorthand names: `start` → `session.start` + `utterance.start`, `partial` → `asr.partial`, `final` → `asr.final`, `synthesize` → `tts.request`, `cancel` → `cancel`, `mark` → `mark`; v0 additions: `tts.chunk`, `error`, `session.end`. JSON control frames and binary audio frames are separate; binary frames are in-memory `Uint8Array` with a max-size guard (`defaultVoiceMaxFrameBytes` 65536) and are never serialized into JSONL (metadata-only helper). `InMemoryVoiceDuplexTransport` / `createVoiceDuplexPair` provide the conformance implementation: FIFO control order, per-stream audio FIFO, closed-endpoint rejection, deterministic bounded-queue overflow, no timers/sockets/devices. `MockSpeechDuplexWorker` is a protocol-conformance worker, not a provider; worker `error` frames carry generic redacted messages, never content-derived text. **Frame labels are advisory metadata**: effective labels derive gateway-side from the profile voice floor via a one-way clamp (`clampVoiceFrameLabels` — advisory labels can raise, never lower; enforced on emitted `speech.asr.final` and `turn.input`). Cancellation is protocol-level cleanup only (ASR cancel before final ⇒ no `turn.input`, zero provider requests, `speech.mark` `asr-cancelled` from the additive `duplexMarkVocabulary`, session stays replayable) — it is NOT the §6 barge-in cascade nor the interrupt-quality benchmark. Both voice ops (`voice.loopback`, `voice.duplex`) share the single gateway construction path `#submitVoiceFinalTranscript` → `#acceptTurnInput`. No `voice.duplex.*` config keys exist in M3-02 (nothing rides the config schema's `additionalProperties`). PR-tier suite `voice.duplex-transport-v0` is live (evals.md). Real WebSocket transport, Python workers under `workers/speech/`, ASR/TTS providers, VAD/endpointing, Lane A/B, ack bank, and the barge-in cascade remain future M3 slices.*

*Implementation status — M3-03 (third slice, commit `524dd33`): the duplex frame contract now crosses a real socket boundary. A deterministic **local WebSocket adapter** is live (`WebSocketVoiceDuplexTransport` / `startLocalVoiceWebSocketEndpoint` / `createWebSocketVoiceDuplexPair`, gateway op + CLI `fairy voice ws`), reusing the gateway's `ws` dependency (one WebSocket library in the workspace). WebSocket **text** messages carry the M3-02 JSON control frames (validated by the same validator — not forked); **binary** messages carry a v0 conformance envelope: `uint32-BE header length + UTF-8 JSON header {stream_id, seq, final?} + raw payload`. **Framing reconciliation:** this JSON-header envelope is the mock/local conformance shape only; §2's compact "4-byte channel id + payload" framing remains reserved for the real-audio/Opus slice, where per-frame JSON header overhead matters. **Auth + binding (normative for every future voice listener):** the endpoint binds hard-coded `127.0.0.1` on an ephemeral port — no host/interface config, flag, or parameter exists; connects require a token (`Authorization: Bearer` or `?token=`; `createWebSocketVoiceDuplexPair` generates an ephemeral per-run token by default) and a missing/wrong token closes `4401` before any frame handler is attached — zero frames processed. Exposing a non-loopback voice listener is a future slice with its own TLS + auth design. **Per-stream audio FIFO is test-gated over two interleaved streams** (per-stream order preserved while cross-stream order diverges from global send order). Every socket await carries a named deadline; servers/sockets close deterministically. Trust stack (floor, one-way clamp on emitted events, route clearance, MemoryGate hold/deny, egress, TTS visibility, cancel-replayability) is inherited unchanged and re-asserted E2E over the WebSocket path. PR-tier suite `voice.websocket-transport-v0` is live (evals.md). Python speech workers, real ASR/TTS providers, VAD/endpointing, Lane A/B, ack bank, barge-in cascade, and the desktop client remain future M3 slices.*

*Implementation status — M3-04 (fourth slice, commit `e3e8089`): the §9 worker process boundary is live. A deterministic **Python stdlib-only mock worker** (`workers/speech/mock_worker.py` — ASCII-only source, imports `json/os/re/sys/time` only, no socket/subprocess/audio modules, no pip deps, no filesystem writes) runs under a **gateway-owned supervisor** (`apps/gateway/src/speech-worker-process.ts`, per §9 "workers under gateway supervision"; `packages/voice` untouched). **Wire reconciliation vs §2:** stdio NDJSON (`fairy.speech-worker.v0`) is the v0 wire for a gateway-supervised **local child**; §2's authenticated local WebSocket remains the transport for remote/decoupled workers (remote GPU boxes). The wire↔frame mapping is recorded in `tasks/M3-04-work.md` §6; `asr.script`/`tts.script` are **mock-conformance-only** kinds — a real worker receives audio frames and synthesize requests, and the real-audio/provider contract remains future work. **Windows stdio hygiene (normative for any stdio worker):** Python spawned with `-u -B`, `shell: false`, `cwd` outside the repo tree; the worker writes each message via `sys.stdout.buffer.write(... + b"\n")` + flush (`ensure_ascii`, no BOM, never bare `print`); the TS reader strips a trailing `\r` before parse (CRLF-injection test-gated); stdout and stderr are drained concurrently from spawn with bounded buffers. **Lifecycle:** interpreter discovery uses a fixed candidate list (`python3` → `python` → `py -3` win32-only) with per-candidate deadlines and named errors; `FAIRY_TEST_PYTHON` is a code-enforced test-only argv0 override surfaced in evidence; the `ready` handshake echoes and verifies the Python version. Handshake/request/cancel/shutdown/forced-kill all carry deadlines; crash/timeout/malformed-output fail closed with `progress.update` stage `voice.worker.failed` (no new event types), no `turn.input`, zero model requests, replayable sessions, and zero orphan processes (test-gated PID-disappearance checks). Worker path and interpreter are repository-controlled — CLI rejects any user-supplied executable/script flags. Trust stack (floor, raise-only clamp on emitted events, route clearance, MemoryGate hold/deny, egress, TTS visibility) is inherited unchanged and re-asserted E2E over the worker path; worker stderr is bounded, treated as untrusted, and redacted before any diagnostic surface. PR-tier suite `voice.worker-process-v0` is live (evals.md). Minimum supported Python version is a named carry-in for the first real-worker slice (3.13.9 discovered / 3.11.15 override both demonstrated; no floor declared yet). Real ASR/TTS providers, VAD/endpointing, Lane A/B, ack bank, barge-in cascade, and the desktop client remain future M3 slices.*

*Implementation status — M3-05 (fifth slice, commit `a2d7f6e`): the **first real speech provider is live** — MiniMax T2A v2 synchronous non-streaming TTS through a gateway-supervised Python stdlib worker (`workers/speech/minimax_tts_worker.py`; raw HTTPS, no SDK, no pip; owner-live verified against `cn-primary` with one request, `speech-2.8-turbo`, a playable 76 KB MP3 artifact). **Config registration (normative; this spec is the owning feature spec — there is no dedicated config spec):** `speech.providers[]` (id, `stage: tts`, `transport: minimax-t2a-v2-http`, closed `endpoint_profile` ∈ `cn-primary | cn-backup` mapping to the exact official endpoints — no raw URLs from YAML/CLI/wire/env, loopback test seam code-enforced; model ∈ `speech-2.8-turbo | speech-2.8-hd`, default turbo; system `voice` settings; `language_boost`; `audio` format/rate/bitrate/channel; `limits` — `max_text_chars ≤ 3000` non-streaming ceiling, bounded `max_response_bytes`/`max_audio_bytes`; `api_key_ref` `secret://` only, never inline; `data_clearance` reusing the governance shape — `region-restricted` requires `regions`) and `speech.roles.tts` (primary + ordered fallback, independent of model roles). **Clearance shares one law:** speech providers are checked through the same parameterized `canRouteToClearance` the model gateway uses — an under-cleared provider receives zero connections and zero bytes; auth/quota/balance/safety/parameter/voice failures never retry; no hidden endpoint failover. **Python floor settled: `>= 3.11`** (probe rejection + handshake re-verification + Ubuntu/Windows CI floor lanes; the M3-04 carry-in is discharged). **Real-provider wire:** `tts.request` (the M3-02 durable kind) now carries the real synthesize mapping; `tts.script` stays mock-only; audio bytes never cross stdio — the worker writes atomically into a gateway-created temp root (narrow env `FAIRY_SPEECH_WORKER_OUTPUT_ROOT`) and the supervisor validates path/hash/size/format before importing into the **neutral content-addressed store `packages/artifacts`** (pure extraction from perception — perception tests byte-identical; artifact kind gains `speech`, `audio/mpeg`/`.mp3`). `speech.tts.chunk.audio_ref` resolves to the local artifact in replay; **artifact labels inherit the synthesized visible text's labels** — synthesis never declassifies. Credential hygiene: `secret://` resolved gateway-side, delivered via the single narrow env `FAIRY_MINIMAX_T2A_TOKEN`, deliberately-constructed child env, **proxies disabled in code** (`ProxyHandler({})`) and excluded from the env, redirects fail closed, TLS verification on. TTS receives only visible `turn.final` text after egress checks (poison-fixture test-gated). PR-tier suite `voice.tts-provider-v0` is live (evals.md; Cases A–H, keyless deterministic fake, 13/13). §2 compact channel-id framing remains deferred to the first streaming-audio slice. Real ASR, VAD/endpointing, streaming TTS + the §5 chunker, Lane A/B, ack bank, barge-in, and the desktop client remain future M3 slices.*

## 1. Architecture position (ADR-006)

Fairy uses a **turn-based streaming pipeline** (VAD → streaming ASR → LLM → incremental TTS), not an end-to-end speech-to-speech model. Reasons: works with *any* OpenAI-compatible text brain (core product requirement), full control over tools/memory/persona mid-pipeline, and per-stage swapability. The pipeline is behind interfaces so a realtime S2S adapter can be added later without redesign.

## 2. Topology & transport

```
client mic → [Opus 20ms frames, binary WS] → gateway voice coordinator
  → ASR worker (partials + final)
  → kernel (two-lane turn)
  → TTS worker (per-sentence chunks) → [Opus] → client playback queue
```

- **Client ⇄ gateway:** WebSocket binary subprotocol (4-byte channel id + payload). Opus 48 kHz mono, 20 ms frames. WebRTC transport is a later adapter for hostile networks (mobile); WS is sufficient on LAN/tunnel and vastly simpler. **Insurance clause:** from M3 the client audio transport sits behind a conformance-tested interface (second implementation: in-process loopback used by the bench), so the WebRTC adapter is slot-in, not surgery. Mobile voice reach in v1 = IM voice notes (async) via channel adapters.
- **Gateway ⇄ speech workers:** same duplex protocol over local WS: JSON control frames (`start`, `partial`, `final`, `synthesize`, `cancel`, `mark`) + binary audio frames. Workers are stateless per utterance; warm pools sized by config.

## 3. Pipeline stages & latency budget

Budget for the reference path (LAN gateway, cloud ASR/LLM/TTS). Every stage emits trace spans; the bench in CI asserts these budgets.

| Stage | Target p50 | Notes |
|---|---|---|
| Endpoint detection (VAD tail silence) | 250–400 ms | Silero VAD on client or worker; adaptive tail (shorter after questions) |
| ASR finalization after endpoint | ≤ 200 ms | Streaming ASR already has partials; final is a flush |
| Router + prompt assembly | ≤ 50 ms | Fast-lane classification runs on partials *before* endpoint (pre-warm) |
| LLM time-to-first-sentence | 300–500 ms | Fast-path role for Lane A; main role streams Lane B |
| TTS time-to-first-audio | 150–300 ms | First sentence synthesized as soon as its boundary is seen |
| Network + playout | ~100 ms | |
| **End-to-end** | **≤ 1.2 s** | stretch 800 ms with fast providers / local stack |

**Semantic endpointing (P1):** in addition to silence, a lightweight incremental classifier (or punctuation heuristic on ASR partials) shortens the tail when the utterance is syntactically complete ("what's the weather in Shanghai" needs no 400 ms wait) and lengthens it mid-clause. This is the single highest-leverage latency trick.

## 4. Two-lane response (with kernel)

- **Lane A (conversational fast path).** A router (few-shot small model on `voice.fastpath` role, fed ASR partials) classifies: `direct-answer | needs-tools | needs-clarification`. Direct answers stream from the main (or fast-path) model immediately. If tools are needed, Lane A emits a persona-appropriate acknowledgment **from a template bank** (zero model latency) or fast model: "马上查" / "On it."
- **Lane B (agentic).** Normal turn with tools/subagents. Emits `progress` events; the voice coordinator selectively voices them (rate-limited, persona-styled) so silence never exceeds ~8 s during long work.
- Lane discipline: Lane A never claims results, only intent; Lane B's final answer supersedes; if Lane B finishes fast (< 1.5 s), Lane A's ack is skipped (races are resolved by the coordinator, not the models).

## 5. Incremental TTS

- **Sentence chunker** on the LLM token stream: emit at `。！？!?.;\n` boundaries with min/max chunk lengths; **CJK-aware** (no space-splitting; handles mixed zh/en, numbers, units); strips markdown to speakable text (code blocks summarized as "一段代码，已放到屏幕上" — never read aloud).
- Chunks synthesize in order with ≤ 2 in flight; playback queue on client with a `mark` protocol so the gateway knows what was actually heard (for accurate history: unheard text is marked `unspoken` in the log after barge-in).
- **Affect coupling:** TTS request carries style params (rate, energy, voice variant) derived from the affect state (persona-affect spec). Degrades to neutral if provider lacks style control.

## 6. Barge-in (FR-2)

Cancellation cascade on `vad.speech_start` while agent audio is playing:

1. Client ducks/stops playback locally (< 100 ms, no round-trip).
2. Gateway cancels TTS synthesis + in-flight chunks.
3. Kernel aborts or checkpoints the LLM stream (Lane B may continue silently if it's a tool task the user likely still wants — policy flag).
4. Session log records `turn.interrupted` + last-heard mark; the new utterance becomes the next turn with accurate "what the user actually heard" context.

Echo safety: client-side AEC (browser/OS provided) + the coordinator ignores VAD triggers that correlate with its own playback signature during the first 300 ms.

## 7. Provider matrix (pluggable, ADR/config only)

| Stage | Cloud (default lane) | Local (offline lane) |
|---|---|---|
| VAD | — (always local) | Silero VAD |
| ASR | Deepgram, OpenAI `audio/transcriptions` (compat), Azure, Tencent/Aliyun (CN) | faster-whisper (CUDA), FunASR/Paraformer-streaming (strong zh) |
| TTS | ElevenLabs, Cartesia, Azure, OpenAI-compat `/audio/speech`, CosyVoice API | CosyVoice 2, GPT-SoVITS (custom Fairy voice!), Kokoro (en), Piper (fast fallback) |

Speech providers follow the same registry+role pattern as LLMs (`speech.asr`, `speech.tts` roles with fallback chains), including `data_clearance` (voice audio of the owner defaults `personal` — cloud speech providers need explicit clearance; specs/data-governance). GPT-SoVITS/CosyVoice local serving is the intended path for a *custom Fairy voice*, which cloud vendors can't provide. Because zh + code-switching quality is a product pillar (NFR-10), M3 includes a dedicated ASR benchmark (FunASR/Paraformer vs faster-whisper vs cloud) on a zh/en/mixed corpus — provider defaults are chosen by measurement, not reputation (suite: specs/evals.md).

## 8. Modality policy

Per-device + per-context rules, user-overridable per session:

- Voice in → voice out **and** text card if the client has a screen; long content (tables, code, lists > 3 items) is *summarized* in voice, full version on screen ("详细内容在屏幕上").
- Text in → text out by default; `/speak` or persona setting flips it.
- IM channels: voice notes transcribed in; replies as text unless user opts into voice notes.
- Quiet hours: proactive speech suppressed (scheduler policy, orchestration spec).

## 9. Worker process model

Python workers under gateway supervision: `asr-worker`, `tts-worker` (one per provider family), optional `vad-worker` when client-side VAD is unavailable. Health-checked, restart-with-backoff, warm-model on boot (no first-request model load), GPU workers can run on a remote box (config: worker URL + auth token). Backpressure: if TTS falls behind, coordinator pauses chunk dispatch, never drops mid-sentence.

## 10. Metrics & bench

Per-turn spans: `vad_tail`, `asr_final`, `route`, `llm_tfs`, `tts_tfa`, `e2e_first_audio`; histograms exported; nightly bench runs a 30-utterance synthetic conversation (recorded audio corpus, zh + en + mixed) against the configured stack and fails CI on budget regression. Interruption bench: scripted barge-ins, asserts cancel ≤ 250 ms and correct `unspoken` accounting. WER sampling: 1% of real utterances (opt-in) re-transcribed by a reference model for drift detection.
