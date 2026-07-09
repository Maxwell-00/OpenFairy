# Spec: Voice Pipeline

| | |
|---|---|
| Status | Draft v0.1 |
| Requirements | FR-2, NFR-1, NFR-6, NFR-10 |
| Components | `workers/speech` (Python) · gateway voice coordinator (TS) · voice-capable clients |

Goal: conversation that feels alive. Concretely: **stop-speaking → first audio p50 ≤ 1.2 s** (stretch 800 ms), interruptible at any moment, in Chinese and English, with pluggable cloud or local speech models.

*Implementation status — M3-01 (first slice, commit `bf6896e`): the §2 insurance-clause "in-process loopback" transport is live as `packages/voice` (`LoopbackVoiceTransport`) behind the gateway op `voice.loopback` and CLI `fairy voice loopback` — deterministic, no audio devices/providers/VAD/endpointing, no second TurnRunner. Speech event payload semantics and the voice-originated `turn.input` convention (envelope `provenance: "user"`, `payload.channel: "voice"`, additive `payload.speech: {utterance_id, audio_ref}`) are normative in protocol.md §5. The voice trust floor per data-governance §1a is enforced and test-gated: floor labels on the emitted `turn.input`, `prefer_local` advisory-only, zero request bytes to under-cleared providers, spoken "remember" held by MemoryGate (`personal_default_hold`) rather than auto-written, spoken-secret egress denied with redacted diagnostics, TTS derived only from visible `turn.final` text. Config surface registered in `packages/config`: `voice.enabled` (default `true`), `voice.transport` (closed enum `["loopback"]` for now), `voice.loopback.tts_chunk_chars` (deterministic loopback-only test knob — **not** this spec's §5 CJK-aware sentence chunker). PR-tier suite `voice.protocol-loopback-v0` is live (evals.md); the §10 latency/interrupt benches and §3–§9 acoustic machinery remain future M3 slices.*

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
