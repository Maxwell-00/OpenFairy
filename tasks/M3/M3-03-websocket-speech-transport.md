# Task M3-03 — WebSocket speech transport skeleton + loopback conformance

> Paste this entire file as the task brief after Fable/Opus brief-gate review.
> Gated 2026-07-09 by the reviewer (Claude Fable 5); gate record in `tasks/M3-03-brief-review.md`; edits RE-1..RE-5 applied in place.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M0, M1, M2, M3-01, and M3-02 are closed.
>
> This is the third M3 slice. It adds a deterministic WebSocket transport adapter for the voice duplex frame contract from M3-02.
>
> This task is **not** a real ASR/TTS provider task, **not** a Python worker task, **not** a desktop client task, and **not** a latency/barge-in benchmark task. It implements the smallest loopback/local WebSocket adapter and conformance suite needed to prove the duplex frame protocol can cross an actual socket boundary while preserving the M2/M3 trust stack.

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
   - M3-02 is closed.
   - M3 trust property: every voice path inherits the full label / clearance / egress / replay stack.
   - Standing M3-02 note: a real-WS-transport slice must add a **two-stream audio FIFO interleave test**.
   - Owner commits/pushes before review.
   - Docs reviewer-owned unless explicitly instructed.

3. `tasks/M3-02-review.md`
   - M3-02 is closed.
   - Internal duplex frame protocol v0 exists in `packages/voice`.
   - Frame labels are advisory only; `clampVoiceFrameLabels` is the gateway-side source of effective labels.
   - The single voice-to-turn path is `#submitVoiceFinalTranscript` -> `#acceptTurnInput`.
   - Duplex frames are a third frame family outside the event registry and outside `packages/protocol/frames/`.
   - Transport frames must never appear in JSONL.
   - Cancelled utterance sessions are replayable and contain no dangling turn.

4. `docs/specs/voice-pipeline.md`
   - Client to gateway future transport: binary WebSocket subprotocol.
   - Gateway to speech workers future transport: local duplex protocol with JSON control frames and binary audio frames.
   - M3-01 landed in-process loopback.
   - M3-02 landed the internal duplex frame protocol / in-memory conformance implementation.
   - This task lands the next transport adapter: deterministic local WebSocket conformance over the M3-02 frame contract, still with a mock worker.

5. `docs/specs/protocol.md`
   - Runtime canon is normative.
   - Transport frames are not canonical events.
   - Binary audio frames are not JSONL events.
   - Canonical voice replay surface remains:
     - `speech.asr.partial`
     - `speech.asr.final`
     - `speech.tts.chunk`
     - `speech.mark`
   - Do not invent new canonical event types for WebSocket frames.

6. `packages/protocol/schemas/speech.*.v1.json`
   - Registered speech event schemas are authoritative.
   - Do not rename or restructure required fields.
   - No enum narrowing on `speech.mark.payload.mark_id`.
   - Additive optional fields only if absolutely required, with schema + fixture pairing and work-report Decisions.

7. `docs/specs/data-governance.md`
   - Voice floor:
     - balanced: `personal / region-restricted(home)` + `prefer_local`;
     - sovereign: `personal / local-only`;
     - cloud-friendly: `personal / global-ok`.
   - Frame labels are advisory and can only raise, never lower, the floor.
   - Route clearance, MemoryGate, egress guard, redaction, and replay apply identically to all voice-originated turns.

8. `docs/specs/evals.md`
   - `voice.protocol-loopback-v0` is live.
   - `voice.duplex-transport-v0` is live.
   - Future benches remain deferred:
     - voice latency bench;
     - interrupt quality / barge-in <= 250 ms;
     - ASR zh/en/mixed benchmark;
     - real ASR provider conformance;
     - real TTS provider conformance.
   - M3-03 may add a deterministic PR-tier WebSocket transport suite, but must not fake-pass acoustic/latency/provider benchmarks.

9. `docs/specs/model-gateway.md`
   - M3 loopback/duplex/mock worker paths are not provider roles.
   - Real ASR/TTS roles, including `voice.fastpath`, remain future M3 provider work.
   - No vendor audio SDKs.

## Deliverables

### 0. Preserve M3-01, M3-02, and M2 invariants

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
- Existing M3 suites still visible and green:
  - `voice.protocol-loopback-v0`
  - `voice.duplex-transport-v0`
- `memory.canary` remains visibly skipped/deferred; do not fake-pass.
- Future M3 latency/barge-in/ASR-quality/provider benches remain future/deferred; do not fake-pass.
- One TurnRunner.
- No provider-specific branches in kernel.
- No vendor SDKs.
- No docs-zh edits.

Acceptance:

- `pnpm --filter @fairy/testing test -- --reporter=verbose` shows the existing M2/M3 suites.
- `git diff --name-only -- docs-zh` has no output.
- No runtime source unrelated to voice/WebSocket transport changes unless justified in `tasks/M3-03-work.md`.

### 1. WebSocket frame codec for the duplex transport

Implement a deterministic WebSocket codec over the existing M3-02 frame contract.

Required principles:

- WebSocket **text messages** carry JSON control frames.
- WebSocket **binary messages** carry audio frames.
- Binary audio frames are never serialized into JSONL.
- Canonical session JSONL continues to emit only registered `speech.*` events and normal TurnRunner events.
- No new canonical event types for WebSocket messages.
- No base64 audio in JSON control frames or JSONL.

Binary audio framing:

- Define a small deterministic binary envelope for `VoiceAudioFrame`.
- Suggested shape:
  - 4-byte big-endian unsigned header length;
  - UTF-8 JSON header with `stream_id`, `seq`, `final`;
  - raw audio payload bytes.
- You may choose a different shape if better aligned with the existing code. Document final shape in `tasks/M3-03-work.md`.

**(gate RE-1)** `docs/specs/voice-pipeline.md` §2 already specifies the client⇄gateway binary subprotocol as "**4-byte channel id + payload**" — a compact channel-prefix framing designed for 20 ms Opus frame streams, not the JSON-header envelope suggested above. Whichever shape you implement, the voice-pipeline docs proposal MUST reconcile explicitly: either implement the §2 channel-id framing, or record the JSON-header envelope as the v0 conformance shape with the compact channel-id framing explicitly reserved for the real-audio slice (per-frame JSON headers are acceptable overhead for a mock conformance path, not for 50 frames/sec of real audio). A silent divergence from §2 is not acceptable; a recorded supersession/deferral is.

Required behavior:

- Encode/decode text control frames using the M3-02 control-frame validator.
- Encode/decode binary audio frames with max-size guard.
- Invalid JSON control messages fail closed.
- Invalid binary messages fail closed.
- Malformed messages produce safe redacted error/control behavior; no raw secret/personal text in error messages.
- Codec must be deterministic and testable without real audio.

Acceptance:

- Unit tests for valid/invalid text control messages.
- Unit tests for valid/invalid binary audio messages.
- Unit tests for max-size guard.
- Unit tests for stable round-trip.
- Unit tests that JSONL/replay never contains raw binary or base64 audio.

### 2. Local WebSocket transport adapter

Add a minimal local WebSocket adapter implementing the existing `VoiceDuplexTransport` contract.

Suggested names:

```ts
WebSocketVoiceDuplexTransport
createWebSocketVoiceDuplexPair
startLocalVoiceWebSocketEndpoint
```

Final names may differ. Document them in `tasks/M3-03-work.md`.

Required behavior:

- Use only loopback/local endpoints in tests (`127.0.0.1` / ephemeral port or equivalent).
- **(gate RE-3)** Loopback binding is **hard-coded** in this slice: the endpoint binds `127.0.0.1` only, with no config key, flag, or parameter that can widen it. Exposing a non-loopback voice listener is a future slice with its own TLS + auth design and its own gate.
- **(gate RE-2 — trust, load-bearing)** No unauthenticated listener, even on loopback. This endpoint accepts frames that trigger real turns — model calls, MemoryGate admissions, egress attempts — so an open port is a standing door into sessions for any local process. The gateway's token auth machinery already exists (`Bearer` / `?token=` vs `authToken`, close `4401`; `apps/gateway/src/server.ts:520-521` at gate time): the voice WS endpoint MUST enforce the same gateway token on connect (or an ephemeral per-run token generated by the harness and passed to both ends). An unauthenticated connect is closed `4401` with **zero frames processed**.
- No external network.
- No TLS/client productization in this slice (auth per RE-2 is required; TLS is not).
- No desktop tray/client.
- No microphone/speaker/device access.
- Deterministic open/close/error behavior.
- **(gate RE-5)** Deadline discipline (standing rule: every environment probe carries a deadline): every test await on socket open/message/close/server-listen carries its own explicit timeout — a hung socket fails fast with a named error, never at the vitest global timeout. Ephemeral ports only: bind port `0` and read the assigned port; no fixed port numbers anywhere (Windows CI port-collision hygiene).
- Bounded queue / max frame bytes respected.
- Closed sockets reject sends.
- Clean shutdown with no dangling timers/processes/handles (servers closed in `afterEach`/`finally`).
- No repo-tree writes.
- **(gate RE-4)** Dependency: reuse the **same `ws` library the gateway already uses** (`apps/gateway/src/server.ts:21`) — no second WebSocket library in the workspace. The client side may use Node's builtin `WebSocket` if cleaner. No vendor audio SDK, no native-build dependency.

Acceptance:

- Unit/integration tests for connect, send/receive control frames, send/receive audio frames, close, malformed message, overflow, and cleanup.
- **(gate RE-2)** Test: a client connecting without the token (or with a wrong token) is closed `4401` and no frame it sends is processed (zero control/audio frames handled, zero session events emitted).
- Test proves only loopback/local address is used.
- Test proves no external network/audio APIs are used.
- CI works on Windows and Linux.

### 3. WebSocket mock speech worker

Bridge the M3-02 `MockSpeechDuplexWorker` over the WebSocket adapter.

Required behavior:

- WebSocket endpoint consumes the same control/audio frames as the in-memory transport.
- Deterministic mock worker emits ASR partial/final, TTS chunk, mark, cancel/error behavior.
- Reuse M3-02 mock worker logic where possible; do not fork a separate behavior stack.
- No ASR/TTS model calls.
- No provider role.
- No vendor SDKs.
- No Python worker.
- No VAD/endpointing.
- No real acoustic machinery.

Acceptance:

- Test: WebSocket path produces the same canonical session shape as in-memory duplex for a basic utterance.
- Test: WebSocket cancel before ASR final produces clean replayable session with no `turn.input`, no provider request, and visible speech mark.
- Test: malformed control frame produces redacted error and no raw content leakage.
- Test: no second mock-worker behavior path diverges silently.

### 4. Gateway / CLI conformance path

Expose a minimal developer/test path.

Preferred:

```powershell
pnpm fairy voice ws --script <fixture.json> --json
```

Alternative names are acceptable if documented.

Required behavior:

- Uses the WebSocket adapter and mock speech worker.
- Emits canonical speech events through normal session JSONL.
- Converts only ASR final into one normal `turn.input` through the existing `#submitVoiceFinalTranscript` -> `#acceptTurnInput` path.
- ASR partials remain observability-only.
- TTS chunks remain output-only.
- JSON output includes:
  - session id;
  - websocket/control frame counts;
  - binary audio frame counts;
  - speech event counts;
  - model request count;
  - transcript text;
  - TTS chunk count;
  - cancel status if applicable;
  - log path or replay command.
- No raw audio/base64 in JSON output or JSONL.
- No repo-tree writes by default; temp/data-dir only.

Acceptance:

- CLI test with temp data dir.
- JSON parse test.
- Test exactly one normal turn for a non-cancelled ASR final.
- Test ASR partials do not create model calls.
- Test TTS chunks do not re-enter the prompt.
- Test no raw audio/base64 in JSON output or JSONL.
- Test no transport-frame event types appear in JSONL.
- Works on Windows and Linux CI.

### 5. Trust stack integration

WebSocket path must inherit M3-02 and M2 trust properties.

Required behavior:

- Frame labels remain advisory only.
- Effective labels derive gateway-side from profile floor + one-way advisory clamp + content escalation.
- Under-cleared primary receives zero request bytes when transcript labels exceed clearance.
- Cleared fallback can complete if configured.
- MemoryGate remains inherited:
  - spoken safe remember with default personal floor is `personal_default_hold`;
  - spoken secret remember is denied;
  - no automatic memory write just because content was spoken.
- Egress guard remains inherited:
  - spoken secret outbound attempt is blocked before outbound tool execution.
- TTS derives only from visible `turn.final`.

Acceptance:

- E2E: WebSocket path with frame label `public/global-ok` under balanced profile still emits `speech.asr.final` + `turn.input` labels `personal / region-restricted` plus `prefer_local`.
- E2E: spoken secret via WebSocket path denies under-cleared primary with zero provider request bytes, visible denied candidate, fallback completes.
- E2E: spoken safe remember via WebSocket path is `personal_default_hold`, no `memory.written`.
- E2E: spoken secret remember denied, no `memory.written`.
- E2E: spoken secret outbound attempt blocked and redacted.
- Test: TTS chunks do not contain hidden reasoning, audit internals, route-denial raw secret, or tool traces.

### 6. Two-stream audio FIFO interleave test

Add the coverage Fable noted at M3-02 close.

Required behavior:

- WebSocket binary audio frames for two streams/utterances may be interleaved on the socket.
- Per-stream FIFO must hold:
  - stream A frames delivered A1, A2, A3 in order;
  - stream B frames delivered B1, B2, B3 in order;
  - interleaving order across streams may vary but must be deterministic in the test.
- No frame from stream A is delivered as stream B or vice versa.
- No stream's bytes/metadata are serialized into JSONL.

Acceptance:

- Non-vacuous test with at least two stream ids and at least three frames per stream.
- Test fails if ordering is global-only but not per-stream.
- Test fails if stream ids are ignored.
- Test fails if binary payload is serialized into JSONL.

### 7. Replay and event visibility

Required behavior:

- Existing `fairy replay` speech rendering handles WebSocket-produced sessions without special cases beyond canonical speech events.
- Text replay renders speech events compactly.
- JSON replay preserves canonical event payloads.
- `--manifests` still works.
- Corrupt-tail replay tolerance remains green.
- No WebSocket/control/audio transport-frame event types appear in JSONL.

Acceptance:

- Replay tests for WebSocket-produced session.
- JSON payload preservation test.
- Corrupt-tail test unchanged and green.
- Grep/test proving no `voice.ws.*`, `voice.frame.*`, `speech.worker.*`, or transport-frame event type appears in JSONL.

### 8. Eval suite

Register deterministic PR-tier suite in `packages/testing`.

Required suite name:

```text
voice.websocket-transport-v0
```

Required coverage:

- WebSocket text/binary codec;
- local loopback WebSocket transport connect/send/receive/close;
- mock speech worker over WebSocket;
- ASR final enters normal TurnRunner path exactly once;
- partials do not call the model;
- TTS output-only;
- cancel produces replayable session with no dangling turn;
- two-stream audio FIFO interleave;
- label clamp + route clearance;
- MemoryGate/egress inherited;
- no raw audio/base64 in JSONL;
- no real provider, microphone, speaker, external network, Python worker, or OS audio device in CI.

Also continue to report as future/deferred, not pass:

```text
voice latency bench
interrupt quality / barge-in <= 250 ms
ASR zh/en/mixed benchmark
real ASR provider conformance
real TTS provider conformance
real desktop/tray client
```

Acceptance:

- `voice.websocket-transport-v0` appears in `pnpm --filter @fairy/testing test -- --reporter=verbose`.
- `voice.protocol-loopback-v0` and `voice.duplex-transport-v0` remain green.
- Non-vacuous assertions.
- No LLM judge.
- No real audio/provider/external network.

### 9. Config surface

Keep config minimal.

Preferred:

- No new user-facing config if the WebSocket conformance path can use CLI/test-local options.

If config is needed, it must be explicit and test-only/local-only:

```yaml
voice:
  websocket:
    max_frame_bytes: 65536
    max_queue_frames: 64
```

Rules:

- Extend existing config loader/schema only if necessary.
- **(gate RE-3)** There is deliberately NO `allow_external_hosts` (or any host/interface) key — the draft's suggestion is removed. A config key that can widen the binding is a standing hole; loopback binding is hard-coded this slice (Deliverable 2). Do not add any host-binding config.
- The `voice` schema has an `additionalProperties` sharp edge; any new `voice.websocket.*` key must have explicit schema entries and invalid-value tests.
- Defaults deterministic and safe.
- No real provider keys.
- No ASR/TTS provider endpoints.
- No env-var side channel.
- Document final choice in `tasks/M3-03-work.md`.

Acceptance:

- Config tests only if config changed.
- Invalid-value tests if config changed.
- No side-channel config.
- No provider config.

### 10. Docs proposals only

Default: do not edit `docs/` or `docs-zh/`. Put proposed docs edits in `tasks/M3-03-work.md`.

Propose docs edits for:

- `docs/specs/voice-pipeline.md`
  - WebSocket transport adapter status;
  - text control frames / binary audio frames;
  - **(gate RE-1)** the binary-framing reconciliation vs §2's "4-byte channel id + payload" (implemented shape, and what is reserved for the real-audio slice);
  - **(gate RE-2)** the endpoint auth rule (gateway token on connect, 4401 on failure, loopback-only binding);
  - two-stream FIFO interleave guarantee;
  - real desktop client, Python workers, ASR/TTS providers, VAD, barge-in remain future.

- `docs/specs/protocol.md`
  - WebSocket frames are not canonical events;
  - binary audio never enters JSONL;
  - canonical replay surface remains `speech.*`.

- `docs/specs/evals.md`
  - register `voice.websocket-transport-v0`;
  - keep latency/barge-in/ASR/provider benches deferred.

- `docs/specs/data-governance.md`
  - WebSocket voice path inherits same floor/clamp/route/egress rules.

- `docs/specs/model-gateway.md`
  - WebSocket mock worker is not `voice.fastpath` or provider role.

If reviewer asks for docs pass, they will apply it after delivery.

## Boundaries — do NOT

- Do not implement real microphone capture.
- Do not implement real speaker playback.
- Do not implement real ASR provider.
- Do not implement real TTS provider.
- Do not implement Python speech workers.
- Do not call cloud audio APIs.
- Do not import vendor audio SDKs.
- Do not implement VAD or endpointing.
- Do not implement two-lane Lane A/Lane B.
- Do not implement ack bank.
- Do not implement sentence-chunked real TTS.
- Do not implement barge-in cascade beyond protocol-level cancel semantics.
- Do not claim interrupt quality / barge-in <= 250 ms.
- Do not implement latency benchmark as pass.
- Do not implement ASR quality benchmark as pass.
- Do not implement desktop tray client.
- Do not implement M4 scheduler/workflows/proactivity.
- Do not create a second TurnRunner.
- Do not bypass model-gateway route clearance.
- Do not send ASR partials to the model.
- Do not TTS hidden reasoning/traces/audit internals.
- Do not store raw audio/base64 in JSONL.
- Do not add canonical event types for WebSocket/transport frames.
- Do not edit `docs-zh/`.
- Do not write generated fixtures/artifacts into the repo tree from tests or CLI; owner evidence belongs under `tasks/owner-checks/M3-03/`.
- Do not open external network listeners in tests; loopback only.
- **(gate)** Do not open an unauthenticated listener — even on loopback (RE-2).
- **(gate)** Do not add any config key, flag, or parameter that can bind a non-loopback host (RE-3).
- **(gate)** Do not add a second WebSocket library; reuse the gateway's `ws` (RE-4).

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

Owner should run after CI is green. Deterministic fixture/mock evidence is acceptable. No real audio device, provider, external network, or Python worker required.

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M3-03 | Out-Null
```

### 1. Voice WebSocket suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Expected:

- `voice.websocket-transport-v0` appears and passes.
- `voice.duplex-transport-v0` remains green.
- `voice.protocol-loopback-v0` remains green.
- All M2 named suites remain green.
- Future latency/barge-in/ASR provider benchmarks are not fake-passed.

Save:

```text
tasks/owner-checks/M3-03/testing-voice-websocket.txt
```

### 2. Focused WebSocket suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose -t "voice.websocket-transport-v0"
```

Expected:

- focused suite appears and passes.
- codec, local WS transport, mock worker, two-stream FIFO, route gate, MemoryGate, egress, replay are covered.

Save:

```text
tasks/owner-checks/M3-03/voice-websocket-focused.txt
```

### 3. Package / CLI tests

Run:

```powershell
pnpm --filter @fairy/voice test -- --reporter=verbose
pnpm --filter @fairy/cli test -- --reporter=verbose
```

Save:

```text
tasks/owner-checks/M3-03/voice-package.txt
tasks/owner-checks/M3-03/cli-voice-websocket.txt
```

Expected:

- voice package tests green.
- CLI/replay tests green.
- corrupt-tail replay still green.

### 4. Optional CLI smoke

Run the chosen CLI command if exposed, for example:

```powershell
pnpm fairy voice ws --script <fixture.json> --json
```

Expected:

- JSON parseable.
- loopback/local WS only.
- frame counts visible.
- speech event counts visible.
- model request count visible.
- exactly one normal turn for non-cancelled ASR final.
- no raw audio/base64.
- no external network/device/provider.

Save if run:

```text
tasks/owner-checks/M3-03/voice-websocket-cli.json
```

If no stable standalone CLI smoke exists, mark N/A and rely on deterministic E2E tests.

### 5. Replay smoke

Replay a WebSocket-produced session if a stable session/data-dir is exposed.

Save if available:

```text
tasks/owner-checks/M3-03/voice-websocket-replay.txt
tasks/owner-checks/M3-03/voice-websocket-replay.json
tasks/owner-checks/M3-03/voice-websocket-manifests.txt
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
   - WebSocket codec shape;
   - control/binary separation;
   - local WS adapter behavior;
   - mock worker reuse;
   - gateway/CLI conformance path;
   - cancellation semantics;
   - two-stream FIFO behavior;
   - label/provenance behavior;
   - replay rendering;
   - dependency/config choice.
4. Spec ambiguities.
   - Non-empty; at minimum explain what is WS transport frame vs canonical event, how loopback-only is enforced, and why real Python workers/providers/VAD/barge-in remain deferred.
5. Proposed docs edits.
6. Manual owner checklist with exact commands and evidence paths.
