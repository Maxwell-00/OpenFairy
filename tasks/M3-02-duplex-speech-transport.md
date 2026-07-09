# Task M3-02 — Duplex speech transport protocol + conformance interface

> Paste this entire file as the task brief after Fable/Opus brief-gate review.
> Gated 2026-07-09 by the reviewer (Claude Fable 5); gate record in `tasks/M3-02-brief-review.md`; edits RE-1..RE-6 applied in place.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M0, M1, M2, and M3-01 are closed.
>
> This is the second M3 slice. It lifts M3-01's in-process loopback into a conformance-tested duplex speech transport interface and deterministic mock worker path.
>
> This task is **not** a real ASR/TTS provider task, **not** a WebSocket server task, and **not** a Python worker task. It defines the transport contract, frame codec, in-memory deterministic implementation, conformance suite, and minimal CLI/dev harness.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md`
   - One TurnRunner.
   - Event-sourced JSONL sessions are the source of truth.
   - Source-first TS workspace until M5.
   - No dist exports.
   - No sibling-package build dependency in tests.
   - Raw HTTP/SSE model transport; no provider SDKs.
   - CI never uses real API keys.
   - Do not read or edit `docs-zh/`.

2. `REVIEWER-HANDBOOK.md`
   - M2 is closed with explicit deferrals.
   - M3-01 is closed.
   - M3 trust property: every voice path inherits the full label / clearance / egress / replay stack.
   - Owner commits/pushes before review.
   - Docs reviewer-owned unless explicitly instructed.
   - Negative existence claims must be verified directly before they enter a gate document.

3. `tasks/M3-01-review.md`
   - M3-01 is closed.
   - `@fairy/voice` exists as TS protocol/transport glue.
   - Speech schemas are authoritative and were not narrowed.
   - Voice-originated `turn.input` uses `provenance: "user"`, `payload.channel: "voice"`, and additive `payload.speech`.
   - Voice label floor is enforced.
   - Spoken remember remains held by MemoryGate (`personal_default_hold`) unless a future explicit-confirmation flow is designed.
   - `docs/specs/voice-pipeline.md` already exists; do not claim it is missing.

4. `docs/specs/voice-pipeline.md`
   - Architecture: turn-based streaming pipeline, not end-to-end speech-to-speech.
   - Topology:
     - client mic → gateway voice coordinator → ASR worker → kernel → TTS worker → client playback queue.
   - Client ⇄ gateway future transport: binary WebSocket subprotocol.
   - Gateway ⇄ speech workers future transport: local duplex protocol with JSON control frames and binary audio frames.
   - M3-01 implementation status: in-process loopback is live as the §2 insurance-clause second implementation.
   - M3-02 must move toward the transport/conformance contract without implementing real acoustic machinery.

5. `docs/specs/protocol.md`
   - Runtime canon is normative.
   - Binary audio frames are not canonical JSONL events.
   - Canonical JSONL speech events reference audio by `audio_ref`.
   - Existing event types:
     - `speech.asr.partial`
     - `speech.asr.final`
     - `speech.tts.chunk`
     - `speech.mark`
   - Do not invent unregistered speech event types.

6. `packages/protocol/schemas/speech.*.v1.json`
   - Registered schemas are authoritative.
   - Do not rename or restructure required fields.
   - No enum narrowing on `speech.mark.payload.mark_id`.
   - Additive optional fields only if absolutely needed, with schema + fixture pairing and work-report Decisions.

7. `docs/specs/data-governance.md`
   - Voice audio/transcripts have a default floor label:
     - balanced: `personal / region-restricted(home)` + `prefer_local`;
     - sovereign: `personal / local-only`;
     - cloud-friendly: `personal / global-ok`.
   - Content escalation can raise labels, never lower them.
   - `prefer_local` is advisory and never gates.
   - Route clearance, MemoryGate, egress guard, redaction, and replay apply identically to voice-originated turns.

8. `docs/specs/evals.md`
   - `voice.protocol-loopback-v0` is live from M3-01.
   - Future M3 benches remain deferred:
     - voice latency bench;
     - interrupt quality / barge-in <= 250 ms;
     - ASR zh/en/mixed benchmark.
   - M3-02 may add a deterministic PR-tier transport conformance suite, but must not fake-pass acoustic/latency benchmarks.

9. `docs/specs/model-gateway.md`
   - M3-01 loopback is not a provider role.
   - Real ASR/TTS roles, including `voice.fastpath`, remain future M3 provider work.
   - No vendor SDKs.

## Deliverables

### 0. Preserve M3-01 and M2 invariants

Before adding duplex transport behavior, preserve regression evidence.

Required:

- Existing M2 named suites still visible and green:
  - `memory.leakage`
  - `memory.deletion-permanence`
  - `research.citation-precision`
  - `research.zh-en-parity`
  - `injection.research-v0`
  - `label.conformance`
  - `governance.friction-canary`
  - `persona.consistency`
  - `substance.invariance`
  - `perception.quarantine-v0`
  - `context.compaction-regression`
  - `chronicle.workspace-v0`
  - `dream-cycle.consolidation-v0`
- Existing M3-01 suite remains visible and green:
  - `voice.protocol-loopback-v0`
- `memory.canary` remains visibly skipped/deferred; do not fake-pass.
- Future M3 latency/barge-in/ASR-quality benches remain future/deferred; do not fake-pass.
- One TurnRunner.
- No provider-specific branches in kernel.
- No vendor SDKs.
- No docs-zh edits.

Acceptance:

- `pnpm --filter @fairy/testing test -- --reporter=verbose` shows the existing M2 and M3-01 suites.
- `git diff --name-only -- docs-zh` has no output.
- No runtime source unrelated to voice transport changes unless justified in `tasks/M3-02-work.md`.

### 1. Duplex frame protocol v0

Define a typed internal duplex speech frame protocol in `packages/voice`.

This is **not** the canonical JSONL event protocol. It is the internal transport/control contract that later WebSocket/client/worker adapters will implement.

Required principles:

- JSON control frames and binary audio frames are separate.
- Binary frames may exist in memory/test transport but must never be serialized into session JSONL.
- Canonical speech JSONL events still use `speech.*` schemas and `audio_ref`.
- Frame protocol must be deterministic and easy to conformance-test.
- No sockets/network/device access in this slice.

Suggested control-frame types:

```ts
type VoiceControlFrame =
  | { kind: "session.start"; session_id?: string; stream_id: string; labels: Labels; profile?: string }
  | { kind: "utterance.start"; utterance_id: string; audio_ref: string; labels: Labels }
  | { kind: "asr.partial"; utterance_id: string; text: string }
  | { kind: "asr.final"; utterance_id: string; text: string; audio_ref: string }
  | { kind: "tts.request"; utterance_id: string; text: string; labels: Labels }
  | { kind: "tts.chunk"; chunk_id: string; text: string; audio_ref?: string }
  | { kind: "mark"; mark_id: string; position_ms: number; utterance_id?: string; chunk_id?: string }
  | { kind: "cancel"; target: "asr" | "tts" | "turn"; reason: string }
  | { kind: "error"; code: string; message: string; retryable?: boolean }
  | { kind: "session.end"; reason?: string };
```

You may adjust the exact type names if existing M3-01 code suggests a better shape. Document final choices in `tasks/M3-02-work.md`.

**(gate RE-1)** `docs/specs/voice-pipeline.md` §2 already names the gateway⇄worker control frames: `start`, `partial`, `final`, `synthesize`, `cancel`, `mark`. The suggested kinds above diverge (e.g. `tts.request` vs the spec's `synthesize`). Whatever final vocabulary you choose, the proposed voice-pipeline.md docs edit MUST contain an explicit mapping/supersession table (spec §2 name ↔ implemented `kind`) so the spec never carries two unreconciled vocabularies; record the final names in the work-report Decisions.

**(gate RE-2 — trust, load-bearing)** Labels carried on control frames (`session.start` / `utterance.start` / `tts.request`) are **advisory metadata only**. Effective labels are derived gateway-side: governance-profile voice floor + content escalation via the existing helper — one-way, exactly as M3-01. A frame-supplied label may raise above the floor; it must NEVER lower, replace, or bypass it. Without this clamp, a buggy or hostile client could launder spoken content below the floor.

**(gate RE-4)** Adopt the frames discipline of protocol.md §7: control frames get runtime validation **plus golden valid/invalid fixtures** (fixtures may live in `packages/voice`). The docs proposal must state explicitly that voice duplex frames are a third frame family — deliberately outside both the canonical event registry and the client op-frame set in `packages/protocol/frames/` (those are the client⇄gateway plane; these are the gateway⇄worker plane).

Required behavior:

- Runtime validation for every control frame.
- Stable serialization for JSON control frames.
- Binary frame representation with max-size guard; do not store binary frame contents in JSONL.
- `cancel` is protocol-only in this slice. It may be conformance-tested for cleanup/ordering but must not claim barge-in quality.
- `error.message` must not contain raw secret/personal text; if content-derived, use existing redaction/fingerprint helpers.
- **(gate RE-2)** Frame-supplied labels never lower/replace the profile-derived floor; the gateway clamp is the single source of effective labels.

Acceptance:

- Unit tests for valid/invalid control frames (against the golden fixtures).
- Unit tests for stable encode/decode.
- Unit tests for binary-frame max-size guard.
- Unit tests that frame logs/session JSONL contain no base64/raw audio.
- Unit tests that invalid control frames fail closed.
- **(gate RE-2)** Test: a control frame claiming `public / global-ok` labels under a balanced profile still yields `personal / region-restricted` (+ `prefer_local` hint) on the emitted `speech.asr.final` and `turn.input` — asserted on the emitted events, not on config.

### 2. Transport interface and in-memory deterministic implementation

Add a conformance-tested transport interface.

Required interfaces:

```ts
interface VoiceDuplexTransport {
  sendControl(frame: VoiceControlFrame): Promise<void>;
  sendAudio(frame: VoiceAudioFrame): Promise<void>;
  close(reason?: string): Promise<void>;
  onControl(handler: (frame: VoiceControlFrame) => void): () => void;
  onAudio(handler: (frame: VoiceAudioFrame) => void): () => void;
}
```

You may refine names and return types. Keep the shape small.

Implement:

- `InMemoryVoiceDuplexTransport`
  - pairable endpoints: client side and gateway/worker side;
  - deterministic ordering;
  - bounded queue;
  - explicit closed state;
  - no sockets;
  - no timers required for correctness;
  - no network/device APIs.

- Optional helper:
  - `createVoiceDuplexPair()` returns two connected endpoints.

Required behavior:

- FIFO order for control frames.
- FIFO order for audio frames per stream.
- Closed transports reject new sends.
- Backpressure/queue overflow is deterministic and visible.
- No unbounded memory growth.
- No repo-tree writes.

Acceptance:

- Unit tests for pair creation, FIFO delivery, close, overflow, and deterministic cleanup.
- Test that no OS audio/network APIs are touched.
- Test that transport can carry synthetic binary frames without serializing them into JSONL.

### 3. Deterministic mock speech worker over the duplex protocol

Implement a deterministic mock worker that consumes duplex frames and emits ASR/TTS control frames.

This is a protocol conformance worker, not a provider.

Suggested name:

```ts
MockSpeechDuplexWorker
```

Required behavior:

- Accepts `utterance.start` + synthetic audio frames.
- Emits deterministic `asr.partial` and `asr.final` according to script.
- Accepts `tts.request`.
- Emits deterministic `tts.chunk` and `mark` frames.
- Supports `cancel` at protocol level:
  - cancel ASR before final suppresses `asr.final`;
  - cancel TTS suppresses remaining chunks;
  - no barge-in metric or quality claim.
- Redacts content-derived error messages.
- No ASR/TTS model calls.
- No provider role.
- No vendor SDKs.
- No Python worker.
- No sockets/network.

Acceptance:

- Unit tests for ASR script partial/final behavior.
- Unit tests for TTS chunk behavior.
- Unit tests for cancel behavior.
- Unit tests for redacted errors.
- Unit tests that no provider/model calls occur.

### 4. Gateway/client conformance path

Expose a minimal developer/test path that exercises the duplex transport through existing voice loopback behavior.

Choose the smallest viable interface, for example:

```powershell
pnpm fairy voice conformance --json
```

or:

```powershell
pnpm fairy voice duplex --script <fixture.json> --json
```

Required behavior:

- Uses the in-memory transport and mock speech worker.
- Emits the same canonical speech events as M3-01, through the existing session JSONL path.
- **(gate RE-3)** Reuses M3-01's single final-transcript submission path — the gateway `submitFinalTranscript` → `#acceptTurnInput` chain (`apps/gateway/src/server.ts:878/:751` at gate time). Do NOT duplicate `turn.input` envelope construction; if refactoring into a shared helper is cleaner, do that and justify in the work report. There must remain exactly one voice→turn envelope construction site.
- Converts only `asr.final` to one normal `turn.input`.
- ASR partials remain observability-only.
- TTS chunks remain output-only.
- **(gate RE-6)** A cancelled utterance (ASR cancel before final) leaves a well-formed, replayable session: no `turn.input`, no dangling turn, cancellation visible via `speech.mark` / existing event types only — no new canonical event types.
- JSON output includes:
  - session id;
  - frame counts;
  - speech event counts;
  - model request count;
  - transcript text;
  - TTS chunk count;
  - log path or replay command.
- No raw audio/base64 appears in JSON output or session JSONL.
- No repo-tree writes by default; use temp/data-dir.

Acceptance:

- CLI test with temp data dir.
- JSON parse test.
- Test exactly one normal turn is produced.
- Test ASR partials do not create model calls.
- Test TTS chunks do not re-enter prompt.
- Test no raw audio/base64 in JSON output or JSONL.
- Works on Windows and Linux CI.

### 5. Trust stack integration

The duplex path must inherit M3-01 and M2 trust properties.

Required behavior:

- `utterance.start` / `asr.final` path carries the voice floor labels.
- ASR final transcripts are content-escalated through the existing governance helper.
- Under-cleared primary models receive zero request bytes when transcript labels exceed clearance.
- Cleared fallback can complete if configured.
- MemoryGate remains inherited:
  - spoken safe remember with default personal floor is held unless an explicit future confirmation flow exists;
  - spoken secret remember is denied;
  - no automatic memory write just because content was spoken.
- Egress guard remains inherited:
  - spoken secret outbound attempt is blocked before tool execution.
- TTS still derives only from visible `turn.final`.

Acceptance:

- E2E: spoken secret via duplex protocol denies under-cleared primary with `provider.requests === 0`, visible denied candidate, fallback completes.
- E2E: spoken safe remember via duplex protocol is `personal_default_hold`, no `memory.written`.
- E2E: spoken secret remember is denied and no `memory.written`.
- E2E: spoken secret outbound attempt is blocked before outbound tool execution and redacted.
- Test: TTS chunks do not contain hidden reasoning, audit internals, route-denial raw secret, or tool traces.

### 6. Replay and event visibility

Voice sessions produced through duplex transport must remain replayable.

Required behavior:

- Existing `fairy replay` speech rendering handles duplex-produced sessions without special cases.
- Text replay renders speech events compactly.
- JSON replay preserves full payloads.
- `--manifests` still works.
- Corrupt-tail replay tolerance remains green.
- No new canonical event types for transport frames.

Acceptance:

- Replay tests for duplex-produced session.
- JSON payload preservation test.
- Corrupt-tail test unchanged and green.
- Grep/test proving no `voice.frame.*`, `speech.worker.*`, or other unregistered event type appears in JSONL.

### 7. Eval suite

Register a deterministic PR-tier suite in `packages/testing`.

Required suite name:

```text
voice.duplex-transport-v0
```

Required coverage:

- frame protocol encode/decode and validation;
- in-memory transport FIFO/close/overflow;
- mock speech worker partial/final/TTS behavior;
- ASR final enters the normal TurnRunner path exactly once;
- partials do not call the model;
- TTS output-only;
- replay renders duplex-produced sessions (including a cancelled-utterance session — clean render, no dangling turn);
- label floor + route clearance, including the frame-label clamp (frame-supplied labels never lower the floor);
- MemoryGate/egress inherited;
- no raw audio/base64 in JSONL;
- no real provider, microphone, speaker, socket, network, Python worker, or OS audio device in CI.

Also continue to report as future/deferred, not pass:

```text
voice latency bench
interrupt quality / barge-in <= 250 ms
ASR zh/en/mixed benchmark
real ASR provider conformance
real TTS provider conformance
```

Acceptance:

- `voice.duplex-transport-v0` appears in `pnpm --filter @fairy/testing test -- --reporter=verbose`.
- `voice.protocol-loopback-v0` remains green.
- Non-vacuous assertions.
- No LLM judge.
- No real audio/provider/network.

### 8. Config surface

Keep config minimal.

Preferred:

- No new user-facing config if the in-memory duplex conformance path can use existing `voice.transport: loopback`.

If new config is needed, make it explicit and loopback/conformance-only, for example:

```yaml
voice:
  duplex:
    max_frame_bytes: 65536
    max_queue_frames: 64
```

Rules:

- Extend existing config loader/schema only if necessary.
- **(gate RE-5)** The existing `voice` schema block is `additionalProperties: true` — an unregistered `voice.duplex.*` key would pass validation silently. Therefore: if any duplex config lands, it MUST get an explicit schema entry (with `enum`/`minimum` constraints), invalid-value tests, and registration in the voice-pipeline.md docs proposal. The `65536` / `64` values above are placeholders, not spec values — final numbers are your decision, documented in Decisions.
- Defaults must be deterministic and safe.
- Invalid values fail validation.
- No real provider keys.
- No ASR/TTS provider endpoints.
- No env-var side channel.
- Document final choice in `tasks/M3-02-work.md`.

Acceptance:

- Config tests only if config changed.
- No side-channel config.
- No provider config.

### 9. Docs proposals only

Default: do not edit `docs/` or `docs-zh/`. Put proposed docs edits in `tasks/M3-02-work.md`.

Propose docs edits for:

- `docs/specs/voice-pipeline.md`
  - duplex frame protocol v0;
  - in-memory conformance implementation;
  - mock speech worker scope;
  - cancellation is protocol-only and not a barge-in benchmark;
  - real WS/Python/provider workers remain future.

- `docs/specs/protocol.md`
  - transport frames are not canonical events;
  - no raw audio/base64 in JSONL;
  - canonical speech events continue to be the replay surface.

- `docs/specs/evals.md`
  - register `voice.duplex-transport-v0`;
  - keep voice latency/barge-in/ASR provider benches deferred.

- `docs/specs/data-governance.md`
  - duplex path inherits the same voice floor and route/egress rules.

- `docs/specs/model-gateway.md`
  - mock duplex worker is not `voice.fastpath` and not a provider role.

If reviewer asks for docs pass, they will apply it after delivery.

## Boundaries — do NOT

- Do not implement real microphone capture.
- Do not implement real speaker playback.
- Do not implement real ASR provider.
- Do not implement real TTS provider.
- Do not implement WebSocket server/client.
- Do not implement Python speech workers.
- Do not call cloud audio APIs.
- Do not import vendor audio SDKs.
- Do not implement VAD or endpointing.
- Do not implement two-lane Lane A/Lane B.
- Do not implement ack bank.
- Do not implement sentence-chunked real TTS.
- Do not implement barge-in cascade beyond protocol-level cancel semantics.
- Do not claim interrupt quality / barge-in <=250 ms.
- Do not implement latency benchmark as pass.
- Do not implement ASR quality benchmark as pass.
- Do not implement desktop tray client.
- Do not implement M4 scheduler/workflows/proactivity.
- Do not create a second TurnRunner.
- Do not bypass model-gateway route clearance.
- Do not send ASR partials to the model.
- Do not TTS hidden reasoning/traces/audit internals.
- Do not store raw audio/base64 in JSONL.
- Do not add new canonical event types for transport frames.
- Do not edit `docs-zh/`.
- Do not write generated fixtures/artifacts into the repo tree from tests or CLI; owner evidence belongs under `tasks/owner-checks/M3-02/`.

## Encoding and Windows rules

- Use PowerShell 7 / UTF-8 no-BOM evidence where possible.
- Valid UTF-8 Chinese text in fixtures is permitted only if testing zh behavior; otherwise prefer English.
- New `.ts` regex literals with CJK must use `\uXXXX` escapes.
- Verification commands targeting non-ASCII strings must use ASCII `node -e` scripts with escapes.
- New CLI tests must use the existing source-first TS execution world (`scripts/run-cli.mjs` / `node --import tsx`), not plain `node` on `.ts`.

## Acceptance commands

```powershell
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm --filter @fairy/testing test -- --reporter=verbose
pnpm dep-check
pnpm conformance
git diff --check
git diff --name-only -- docs docs-zh
```

GitHub Actions must be green on ubuntu + windows.

## Manual owner checks

Owner should run after CI is green. Deterministic fixture/mock evidence is acceptable. No real audio device, provider, socket, network, or Python worker required.

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M3-02 | Out-Null
```

### 1. Voice duplex suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Expected:

- `voice.duplex-transport-v0` appears and passes.
- `voice.protocol-loopback-v0` remains green.
- All M2 named suites remain green.
- Future latency/barge-in/ASR provider benchmarks are not fake-passed.

Save:

```text
tasks/owner-checks/M3-02/testing-voice-duplex.txt
```

### 2. Focused duplex suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose -t "voice.duplex-transport-v0"
```

Expected:

- focused suite appears and passes.
- frame protocol, transport, mock worker, route gate, MemoryGate, egress, replay are covered.

Save:

```text
tasks/owner-checks/M3-02/voice-duplex-focused.txt
```

### 3. CLI conformance smoke

Run the chosen CLI command, for example:

```powershell
pnpm fairy voice conformance --json
```

or:

```powershell
pnpm fairy voice duplex --script <fixture.json> --json
```

Expected:

- JSON parseable.
- session id visible if a session is created.
- frame counts visible.
- speech event counts visible.
- model request count visible.
- exactly one normal turn from ASR final.
- no raw audio/base64.
- no network/device/provider use.

Save:

```text
tasks/owner-checks/M3-02/voice-duplex-cli.json
```

If no standalone CLI smoke is exposed, record why in `tasks/M3-02-work.md` and rely on deterministic E2E tests.

### 4. Replay smoke

Replay a duplex-produced session if CLI/E2E exposes a stable session/data-dir.

Expected:

- speech events render in text replay.
- JSON replay preserves payload.
- manifests still render.
- corrupt-tail tolerance remains green.
- no transport-frame event types appear.

Save, if available:

```text
tasks/owner-checks/M3-02/voice-duplex-replay.txt
tasks/owner-checks/M3-02/voice-duplex-replay.json
tasks/owner-checks/M3-02/voice-duplex-manifests.txt
```

If not available, mark N/A and point to deterministic replay tests.

## Report back

Use the established format:

1. File tree delta.
2. Verification tails:
   - local commands;
   - CI link/status;
   - conformance verdict;
   - named suite names.
3. Decisions:
   - frame protocol shape;
   - control/binary separation;
   - in-memory transport behavior;
   - mock speech worker behavior;
   - gateway/CLI conformance path;
   - cancellation semantics;
   - label/provenance behavior;
   - replay rendering;
   - config changes or no-config decision.
4. Spec ambiguities.
   - Non-empty; at minimum explain what is internal transport frame vs canonical event, and why real WebSocket/Python workers/providers are deferred.
5. Proposed docs edits.
6. Manual owner checklist with exact commands and evidence paths.
