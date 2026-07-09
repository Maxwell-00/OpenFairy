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

---

## Countersignature — Claude (Fable 5), 2026-07-09

Code-level cross-check delegated to an opus subagent (13-item checklist at `524dd33` vs parent `341eb9c`, file:line evidence, reads via `git show` only); the load-bearing RE-2 evidence (auth ordering, loopback literal) additionally spot-checked directly by this reviewer. **13/13 PASS, zero vacuous trust assertions; every reviewer-gate clause from the brief gate is confirmed in code:**

- **(RE-2, the load-bearing gate)** Token check is the **first statement** in the `wss.on("connection")` handler (`packages/voice/src/index.ts:1061-1066`): missing/wrong token ⇒ `socket.close(4401, "unauthorized")` + `return` — the message handler only exists inside `WebSocketVoiceDuplexTransport`'s constructor, which is never reached, so there is **zero window** for an unauthenticated frame to be processed. Rejection tested with both no-token and wrong-token clients that actively send frames on open: `4401` asserted, `acceptedConnections() === 0`, `rejectedConnections() === 2`. Defense is deeper than the gate demanded: the gateway `voice.ws` op sits behind the gateway's own connect auth, and the inner endpoint uses an ephemeral per-run token (`voice-ws-${randomUUID()}`) — double-gated. The token is never logged, echoed, or emitted.
- **(RE-3)** `server.listen(0, voiceWebSocketLoopbackHost)` with `voiceWebSocketLoopbackHost = "127.0.0.1" as const` (`:409`); the endpoint options type has **no host/interface field**; grep confirms no config key, flag, or parameter can widen the binding; `packages/config` untouched (no `voice.websocket.*`).
- **(RE-4)** `ws: ^8.18.3` added to `packages/voice` — identical spec to the gateway's; lockfile delta (+7) resolves to the already-present `8.21.0`, no second version; `@types/ws` dev-only; no native-build deps, no workspace/approve-builds changes.
- **(RE-5)** `withVoiceWebSocketDeadline(name, promise, 5000)` wraps listen/open/close in production with named timeout errors and `clearTimeout` in `finally`; the transport-run waits are equally wrapped; tests bind port `0` and read the assigned port (no fixed listener ports anywhere); servers/sockets close in `finally`/`afterEach`; no dangling timers.
- **(Deliverable 6, non-vacuous by construction)** Interleave test sends `a0,b0,a1,b1,a2,b2` with a 30 ms stall injected on `stream_a`'s first frame: per-stream order `[0,1,2]` asserted for both streams, **and** `stream_b:0` asserted to arrive before `stream_a:0` — so a global-only FIFO fails, an ignored-stream-id chain fails, and a cross-labeled frame fails the per-stream equality. Exactly the failure modes the gate demanded.
- **(RE-1)** Binary codec is `uint32-BE header length + UTF-8 JSON header {stream_id, seq, final?} + raw payload` with fail-closed decode (missing/zero/overflowing header length, oversize vs max-frame-bytes — all tested); the §2 reconciliation is recorded in both Decisions and the docs proposal: JSON-header envelope = v0 conformance shape, compact "4-byte channel id + payload" reserved for the real-audio/Opus slice. Landed in the docs pass below.
- **Frames vs events:** no new canonical event types; binary bytes never reach the event emitter (audio is consumed by the mock worker only); JSONL asserted free of `voice.ws.*`/`voice.frame.*`/`speech.worker.*`/`data:audio/`/base64 runs in both E2E and CLI tests; control frames validated by the reused M3-02 validator — not forked; `packages/protocol` untouched.
- **Trust stack over WS, all non-vacuous:** clamp on emitted `speech.asr.final` + `turn.input` (`public/global-ok` frame ⇒ `personal/region-restricted` + `prefer_local`); under-cleared primary zero additional requests + fallback completes; `personal_default_hold` / `secret_denied` with empty MemoryStore; egress blocked with `outbound.requests() === 0` + redacted diagnostics; TTS exactly the visible final with hidden/secret fixture text asserted absent; cancel ⇒ `[mark, partial, mark:asr-cancelled]`, no `turn.input`, zero provider requests, replay clean.
- **Single path & reuse:** `voice.ws` routes through the same `#submitVoiceFinalTranscript` → `#acceptTurnInput` as loopback/duplex; one production TurnRunner; `WebSocketVoiceTransport.run` instantiates the **unchanged** `MockSpeechDuplexWorker` with only the transport swapped — no forked behavior stack.
- **Weakening scan:** `packages/voice/src/index.ts` +679/−0 (pure additions; all M3-01/M3-02 exports untouched); gateway +85/−1 (import line); CLI test additions-only; `replay.test.ts`, `voice.protocol-loopback.test.ts`, `voice.duplex-transport.test.ts` untouched. **One justified relaxation:** the voice-package "no socket dependencies" source-scan necessarily changed (the WS transport now legitimately imports `ws`/`node:http` in that file); the replacement still forbids `node:dgram`/`node:child_process` and OS-audio-device references. Accepted — the old assertion was made false by the slice's own scope, and the narrowed guard keeps the properties that still matter.

### Non-blocking notes (for the record)

1. The interleave test is a direct transport-pair test producing no JSONL, so its inline no-binary-in-JSONL proxy is weak; the real guarantee is enforced by the E2E/CLI rawLog assertions. Fine as divided.
2. `M3-03-owner-checks.md` §3 left a template placeholder unfilled next to its N/A verdict — cosmetic; the N/A-with-reason convention itself was followed correctly ("covered by deterministic E2E tests"), as pre-negotiated in the brief.
3. CI: owner evidence run `29020931861` green (ubuntu + windows) at `e467773` per primary review; `e467773` is tasks-only (verified).

### Docs pass — applied with this countersignature

`voice-pipeline.md` (M3-03 status note: WS adapter, framing reconciliation vs §2 — JSON-header v0 conformance shape with compact channel-id framing reserved for real audio, **auth + loopback-binding rule stated as normative for every future voice listener**, two-stream FIFO guarantee), `protocol.md` (§7 third-family note extended: WS carries the family across a real socket, still never events/JSONL), `data-governance.md` (WS inheritance + "an unauthenticated voice port is an unlabeled ingress and is forbidden"), `evals.md` (`voice.websocket-transport-v0` registry row + M3-03 registration status), `model-gateway.md` (WS-bridged mock worker still not a provider role). **docs-zh re-translation TODO (owner-maintained): all five files.**

### Verdict: M3-03 ACCEPTED WITH NOTES / CLOSED

Voice now crosses a real OS boundary with the trust stack intact: the port is authenticated before any frame exists, the binding cannot be widened by configuration, frame labels still cannot lower the floor, and the wire protocol still cannot reach the canon. The M3-02 interleave carry-in is discharged with a genuinely discriminating test. **Next: gate the M3-04 brief** (natural candidates per voice-pipeline: first real speech worker under `workers/speech/` (Python, duplex protocol client) or the real ASR/TTS provider role binding — owner/ChatGPT to propose; the per-gate M3 trust property stands, the M2 deferral landing gates remain in force, and any real-provider slice must carry the data-governance clearance rules for cloud speech providers).
