# M3-03 Review — WebSocket speech transport skeleton + loopback conformance

Review date: 2026-07-09
Reviewer: ChatGPT 5.5 Thinking
Task brief: `tasks/M3-03-websocket-speech-transport.md`
Brief gate: `tasks/M3-03-brief-review.md`
Delivery commit: `524dd33`
CI: GitHub Actions run `29019686865`, success, ubuntu + windows matrix completed.

## Verdict

**ACCEPTED WITH NOTES — implementation accepted, task close pending owner evidence and Fable/Opus delivery countersign.**

M3-03 implements the local WebSocket speech transport skeleton, WebSocket text/binary codec, loopback-only WS endpoint with token auth, mock worker over WS, CLI/gateway conformance path, two-stream FIFO coverage, and `voice.websocket-transport-v0`.

The implementation is accepted at primary-review level. It is not yet task-closed because owner evidence under `tasks/owner-checks/M3-03/` has not been committed yet, and this slice should receive Fable/Opus delivery countersign because it crosses the real OS socket boundary for voice.

## Evidence base

- Commit `524dd33` / `M3-03-work`.
- CI run `29019686865`: success, 2 verify jobs completed.
- Work report: `tasks/M3-03-work.md`.
- Brief gate: `tasks/M3-03-brief-review.md`.

## Acceptance review

### 0. Preserve M3-01, M3-02, and M2 invariants

**PASS.**

The work report records all required acceptance commands as PASS:

- `pnpm install`
- package typechecks for voice/gateway/cli/testing
- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm --filter @fairy/testing test -- --reporter=verbose`
- `pnpm lint`
- `pnpm dep-check`
- `pnpm conformance`
- `git diff --check`
- `git diff --name-only -- docs docs-zh`

Existing M2 suites are listed as visible, existing M3 suites `voice.protocol-loopback-v0` and `voice.duplex-transport-v0` remain green, and new `voice.websocket-transport-v0` is added.

### 1. WebSocket frame codec

**PASS.**

The implementation adds deterministic WebSocket codec support in `packages/voice/src/index.ts`.

The work report states:

- WebSocket text messages carry existing M3-02 JSON control frames.
- WebSocket binary messages carry v0 conformance envelope: `uint32 header_len + JSON header {stream_id, seq, final?} + raw payload`.
- `voice-pipeline.md` compact `4-byte channel id + payload` framing is explicitly reserved for the later real-audio/Opus slice.

This satisfies RE-1 at the work-report level. Fable/Opus should code-check the codec and docs-proposal wording.

### 2. Local WebSocket transport adapter

**PASS WITH COUNTERSIGN FOCUS.**

The work report states:

- endpoint binds hard-coded `127.0.0.1`;
- ephemeral port only;
- token/Bearer auth enforced;
- no token/wrong token closes `4401` and processes zero frames;
- `createWebSocketVoiceDuplexPair` uses an ephemeral generated token unless supplied;
- dependency reuses `ws`;
- no second WebSocket library, native dependency, or vendor SDK.

This addresses RE-2/RE-3/RE-4. Because this is the first real socket boundary, countersign should verify token close behavior and zero-frame/session-event handling in code/tests.

### 3. Socket hygiene

**PASS WITH COUNTERSIGN FOCUS.**

The work report states production local endpoint/open helpers and tests use explicit deadlines, tests bind port `0`, and servers/sockets close in `finally`. This addresses RE-5. Fable/Opus should check no fixed ports, no unbounded waits, and no dangling server paths.

### 4. WebSocket mock speech worker

**PASS.**

The WebSocket path wraps `MockSpeechDuplexWorker` and does not fork ASR/TTS behavior. No ASR/TTS model calls, provider role, vendor SDK, Python worker, VAD, endpointing, or acoustic machinery are added.

### 5. Gateway / CLI conformance path

**PASS.**

The implementation adds gateway op `voice.ws` and CLI path `fairy voice ws --script ... --json`.

The work report states the path emits canonical speech events through normal session JSONL, and ASR final enters exactly one normal user turn through `#submitVoiceFinalTranscript` -> `#acceptTurnInput`. ASR partials remain observability-only; TTS chunks remain output-only.

### 6. Trust stack integration

**PASS WITH COUNTERSIGN FOCUS.**

The work report states:

- frame labels remain advisory;
- effective labels derive from profile floor + one-way clamp + content escalation;
- under balanced profile, a frame claiming `public/global-ok` still emits `personal/region-restricted` plus `prefer_local` on the voice-originated turn.

It also retains M3-02 semantics: spoken safe remember remains `personal_default_hold`, egress is inherited, and hidden reasoning/audit/route-denial raw secret should not reach TTS.

### 7. Two-stream audio FIFO interleave

**PASS WITH COUNTERSIGN FOCUS.**

The work report says tests interleave two stream ids with three frames each and assert per-stream ordering and stream id preservation. This is the exact M3-02 carry-in coverage Fable requested. Countersign should verify the test would fail if stream ids were ignored or ordering were only global.

### 8. Replay and event visibility

**PASS.**

The work report states WebSocket sessions use existing replay rendering because only canonical `speech.*` events are logged. No WebSocket/control/audio transport frame is written into session JSONL.

### 9. Eval suite

**PASS.**

The implementation adds:

```text
voice.websocket-transport-v0
```

and preserves:

```text
voice.protocol-loopback-v0
voice.duplex-transport-v0
```

The work report states `@fairy/testing` reached 79 passed / 1 skipped, with future latency/barge-in/ASR/provider/desktop benchmarks still deferred and not fake-passed.

### 10. Config surface

**PASS.**

No new `voice.websocket.*` config is reported. Binding remains hard-coded loopback in this slice, so there is no `allow_external_hosts` or host/interface config hole.

### 11. Docs proposals only

**PASS.**

No `docs/` or `docs-zh/` files were edited. Proposed docs edits are in the work report.

## BLOCKER

None for implementation acceptance.

## CARRY-IN

1. **Owner evidence pending.**
   Commit `524dd33` includes `tasks/M3-03-work.md`, but owner evidence under `tasks/owner-checks/M3-03/` has not yet been committed.

2. **Fable/Opus delivery countersign pending.**
   Focus items:
   - auth on connect: no/wrong token closes `4401`, zero frames processed, zero session events;
   - loopback binding hard-coded to `127.0.0.1`, no widening config/flag/parameter;
   - one `ws` library, no native/vendor SDK dependency;
   - explicit socket deadlines, ephemeral ports, clean shutdown;
   - two-stream audio FIFO interleave is non-vacuous;
   - no transport-frame event types in JSONL or registry;
   - label clamp and route clearance inherited;
   - single voice-to-turn path preserved.

3. **Reviewer-owned docs pass pending.**
   Apply or gate proposed docs edits for:
   - `docs/specs/voice-pipeline.md`
   - `docs/specs/protocol.md`
   - `docs/specs/evals.md`
   - `docs/specs/data-governance.md`
   - `docs/specs/model-gateway.md`

4. **Work report stale CI line.**
   Work report says CI was not run from Codex workspace. Current pushed CI run is `29019686865` and is green.

## NIT

- Work report is compressed into long lines, making line-level citation harder.
- If owner CLI/replay smoke is omitted, document the substitution explicitly in `M3-03-owner-checks.md`.

## Final decision

M3-03 implementation is accepted with notes. Run owner checks, commit evidence, then send to Fable/Opus for delivery countersign.
