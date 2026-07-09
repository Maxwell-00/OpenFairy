# M3-02 Review — Duplex speech transport protocol + conformance interface

Review date: 2026-07-09  
Reviewer: ChatGPT 5.5 Thinking  
Task brief: `tasks/M3-02-duplex-speech-transport.md`  
Brief gate: `tasks/M3-02-brief-review.md`  
Delivery commit: `fe8afc3`  
CI: GitHub Actions run `29007278951`, success, ubuntu + windows matrix completed.

## Verdict

**ACCEPTED WITH NOTES — implementation accepted, task close pending owner evidence and Fable/Opus delivery countersign.**

M3-02 implements the internal duplex speech transport protocol v0, in-memory deterministic transport, mock speech worker, gateway/CLI duplex conformance path, golden control-frame fixtures, and the deterministic `voice.duplex-transport-v0` suite.

The implementation is accepted at primary-review level. It is not yet task-closed because owner evidence under `tasks/owner-checks/M3-02/` has not been committed yet, and this slice should receive Fable/Opus delivery countersign because it extends the M3 voice trust path.

## Evidence base

- Commit `fe8afc3` / `M3-02-work`.
- CI run `29007278951`: success, 2 verify jobs completed.
- Work report: `tasks/M3-02-work.md`.
- Brief gate: `tasks/M3-02-brief-review.md`.

## Acceptance review

### 0. Preserve M3-01 and M2 invariants

**PASS.**

The work report records all required acceptance commands as PASS:

- `pnpm install`
- `pnpm lint`
- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm --filter @fairy/testing test -- --reporter=verbose`
- `pnpm dep-check`
- `pnpm conformance`
- `git diff --check`
- `git diff --name-only -- docs docs-zh`

The M2 suites are listed as preserved, `voice.protocol-loopback-v0` remains green, and `voice.duplex-transport-v0` is added. Future voice latency/barge-in/ASR/provider conformance benchmarks remain deferred and are not fake-passed.

### 1. Duplex frame protocol v0

**PASS.**

The implementation adds `VoiceControlFrame` in `@fairy/voice`, deliberately outside the canonical event registry and outside `packages/protocol/frames`.

Final v0 frame kinds are:

- `session.start`
- `utterance.start`
- `asr.partial`
- `asr.final`
- `tts.request`
- `tts.chunk`
- `mark`
- `cancel`
- `error`
- `session.end`

The work report includes the required mapping from `voice-pipeline.md` short names to implemented frame kinds. Golden valid/invalid fixtures were added under `packages/voice/fixtures/`. Stable encode/decode and fail-closed validation are reported.

### 2. Control/binary separation

**PASS.**

The implementation separates JSON control frames from in-memory `VoiceAudioFrame` binary frames. The work report states that `VoiceAudioFrame` carries `Uint8Array` data in memory only; metadata exposes length/stream/sequence/final only; no duplex transport frame is appended to session JSONL; canonical JSONL remains limited to existing speech events.

### 3. Transport interface and in-memory deterministic implementation

**PASS.**

`InMemoryVoiceDuplexTransport` and `createVoiceDuplexPair` were implemented. The work report records paired endpoints, FIFO delivery, deterministic queue overflow, closed endpoint rejection, default max audio frame size of 65,536 bytes, and no socket/device/microphone/speaker/network/timer dependency.

### 4. Deterministic mock speech worker

**PASS.**

`MockSpeechDuplexWorker` consumes `utterance.start` plus synthetic audio frames, emits deterministic ASR partial/final frames, accepts `tts.request`, emits deterministic `tts.chunk` / `mark`, supports cancel, and uses generic redacted error messages. No model/provider calls, vendor SDK, Python worker, socket, VAD, or endpointing are added.

### 5. Gateway / CLI conformance path

**PASS WITH NOTE.**

The implementation adds gateway op `voice.duplex` and CLI path `fairy voice duplex --script <fixture.json> --json`.

The duplex path uses the in-memory transport/mock worker and emits the same canonical speech events through session JSONL. ASR partials remain observability-only; only `asr.final` enters a normal turn. TTS chunks remain output-only.

The work report says voice turn submission was refactored into `#submitVoiceFinalTranscript`, and both `voice.loopback` and `voice.duplex` use it. This satisfies the “single construction site” intent if code-level countersign confirms no second voice→turn envelope builder exists.

### 6. Cancellation semantics

**PASS.**

Cancellation is protocol-only. ASR cancel before final emits `speech.mark` with `mark_id: "asr-cancelled"`, emits no `turn.input`, starts no TurnRunner turn, makes zero provider requests, and remains replayable. No barge-in latency or quality claim is made.

### 7. Label clamp and trust stack

**PASS WITH COUNTERSIGN FOCUS.**

The work report states frame labels are advisory metadata only. Effective labels derive from the governance profile voice floor plus stricter advisory labels, then content escalation. A frame claiming `public/global-ok` under balanced profile still produces emitted `speech.asr.final` and `turn.input` labels of `personal / region-restricted` with `routing_hints.prefer_local`.

This addresses the load-bearing RE-2 gate issue. Fable/Opus should countersign at code level that the clamp is asserted on emitted events, not merely on config or frame metadata.

MemoryGate behavior remains inherited: spoken safe remember is `personal_default_hold`; voice does not bypass MemoryGate.

### 8. Replay and event visibility

**PASS.**

No replay renderer special case was needed beyond M3-01 speech rendering. Duplex-produced sessions render through existing `fairy replay`; JSON replay preserves speech payloads; `--manifests` remains compatible. Tests assert no `voice.frame.*` or `speech.worker.*` event type appears in JSONL.

### 9. Eval suite

**PASS.**

The implementation adds:

```text
voice.duplex-transport-v0
```

and preserves:

```text
voice.protocol-loopback-v0
```

The work report states `packages/testing` reached 75 passed / 1 skipped in local testing, with future latency/barge-in/ASR/provider conformance benchmarks still deferred.

### 10. Config surface

**PASS.**

No new config keys were added. This correctly avoids the `additionalProperties: true` sharp edge in the current `voice` config block. The work report explicitly states no `voice.duplex.*` keys exist and therefore nothing rides unregistered config acceptance.

### 11. Docs proposals only

**PASS.**

No `docs/` or `docs-zh/` files were edited. The work report includes proposed docs edits for:

- `docs/specs/voice-pipeline.md`
- `docs/specs/protocol.md`
- `docs/specs/evals.md`
- `docs/specs/data-governance.md`
- `docs/specs/model-gateway.md`

## BLOCKER

None for implementation acceptance.

## CARRY-IN

1. **Owner evidence pending.**  
   Commit `fe8afc3` includes `tasks/M3-02-work.md`, but owner evidence under `tasks/owner-checks/M3-02/` has not yet been committed.

2. **Fable/Opus delivery countersign pending.**  
   Focus items:
   - frame-vocabulary mapping table present and accurate;
   - frame label clamp tested on emitted `speech.asr.final` and `turn.input`;
   - exactly one voice→turn construction site after the refactor;
   - golden valid/invalid frame fixtures are tested;
   - no transport-frame event types in JSONL or registry;
   - cancel session is replayable with no dangling turn;
   - no sockets/network/device/Python/provider/vendor SDKs;
   - corrupt-tail replay not weakened.

3. **Reviewer-owned docs pass pending.**  
   Apply or gate the proposed docs edits after countersign.

4. **Work report stale CI line.**  
   Work report says CI was not pushed from Codex workspace. Current pushed CI run is `29007278951` and is green.

## NIT

- Work report is highly compressed into long lines, making citation/review harder.
- Owner CLI smoke may be optional if deterministic E2E covers equivalent properties; if omitted, record the substitution explicitly in `M3-02-owner-checks.md`.

## Final decision

M3-02 implementation is accepted with notes. Run owner checks, commit evidence, then send to Fable/Opus for delivery countersign.
