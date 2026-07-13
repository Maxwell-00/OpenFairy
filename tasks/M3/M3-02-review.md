# M3-02 Final Review — Duplex speech transport protocol + conformance interface

Review date: 2026-07-09  
Reviewer: ChatGPT 5.5 Thinking  
Task brief: `tasks/M3-02-duplex-speech-transport.md`  
Brief gate: `tasks/M3-02-brief-review.md`  
Implementation commit: `fe8afc3`  
Owner evidence commit: `8ca9e48`  
CI:
- Implementation run `29007278951`: success, ubuntu + windows matrix completed.
- Owner evidence run `29008352526`: success, ubuntu + windows matrix completed.

## Verdict

**ACCEPTED WITH NOTES / CLOSED AT PRIMARY REVIEW LEVEL.**

M3-02 is accepted at primary-review level. The duplex speech transport protocol/conformance slice is implemented, deterministic owner evidence is committed, and GitHub Actions is green.

Because M3-02 is a load-bearing M3 voice-transport/trust-stack slice, Fable/Opus delivery countersign remains required before moving to the next M3 implementation slice.

## Evidence base

- Work report: `tasks/M3-02-work.md`.
- Primary implementation review: `tasks/M3-02-review.md`.
- Owner evidence:
  - `tasks/owner-checks/M3-02/M3-02-owner-checks.md`
  - `tasks/owner-checks/M3-02/testing-voice-duplex.txt`
  - `tasks/owner-checks/M3-02/voice-duplex-focused.txt`
  - `tasks/owner-checks/M3-02/voice-package.txt`
  - `tasks/owner-checks/M3-02/cli-voice-duplex.txt`
  - `tasks/owner-checks/M3-02/all-tests.txt`
  - `tasks/owner-checks/M3-02/lint.txt`
  - `tasks/owner-checks/M3-02/typecheck.txt`
  - `tasks/owner-checks/M3-02/dep-check.txt`
  - `tasks/owner-checks/M3-02/conformance.txt`
  - `tasks/owner-checks/M3-02/diff-check.txt`
  - `tasks/owner-checks/M3-02/docs-diff.txt`

## Acceptance review

### 0. CI / evidence commit

**PASS.**

Owner evidence commit `8ca9e48` is a pure tasks evidence commit. It adds the M3-02 review and owner-check evidence files under `tasks/owner-checks/M3-02/`; no runtime source or docs/docs-zh files are changed.

GitHub Actions run `29008352526` completed successfully on both ubuntu and windows jobs.

### 1. Voice duplex suite visibility

**PASS.**

Owner summary records:

- `voice.duplex-transport-v0` present and PASS.
- `voice.protocol-loopback-v0` still PASS.
- M2 named suites still PASS.
- `memory.canary` still skipped/deferred.
- future voice benchmarks not fake-passed.
- overall M3-02 owner manual checks PASS.

### 2. Package-level voice tests

**PASS.**

`voice-package.txt` shows `@fairy/voice` with 1 passed test file and 14 passed tests. Coverage includes:

- golden control-frame fixtures;
- fail-closed invalid fixtures;
- stable JSON control-frame round-trip;
- binary audio in-memory metadata only;
- advisory label clamp;
- FIFO transport;
- close/overflow behavior;
- no socket/network/OS audio dependencies;
- mock speech worker partial/final/TTS behavior;
- cancel behavior;
- clean speech-only event stream when ASR is cancelled before final.

### 3. CLI / replay tests

**PASS.**

`cli-voice-duplex.txt` shows the CLI package green with 9 passed test files and 16 passed tests. It includes:

- replay corrupt-tail behavior;
- speech event replay rendering and JSON payload preservation;
- `fairy voice` loopback JSON;
- `fairy voice` duplex conformance JSON.

### 4. Full acceptance tail

**PASS.**

Owner evidence includes green lint/typecheck/all-tests/dep-check/conformance/diff/docs checks. Conformance evidence is mock mode, all 18 cases PASS, and machine-readable `"ok": true`.

### 5. Trust-stack / gate-focus properties

**PASS AT PRIMARY LEVEL; COUNTERSIGN STILL REQUIRED.**

Owner evidence and implementation work report cover the main gate points:

- frame labels are advisory only;
- label clamp preserves the voice floor on emitted `speech.asr.final` and `turn.input`;
- `voice.duplex-transport-v0` is visible and green;
- TTS/replay/egress behavior is covered by deterministic tests;
- cancel before ASR final leaves a clean speech-only session.

Fable/Opus should still verify these at code level before final task close because RE-2 label clamp and the single voice→turn construction site are load-bearing.

## BLOCKER

None for primary close.

## CARRY-IN / Fable countersign items

1. **Fable/Opus delivery countersign required.**  
   Verify:
   - frame-vocabulary mapping table is present and accurate;
   - frame label clamp is asserted on emitted `speech.asr.final` and `turn.input`;
   - exactly one voice→turn envelope construction site exists;
   - golden valid/invalid frame fixtures are tested;
   - no transport-frame event types appear in JSONL or registry;
   - cancelled utterance session is replayable and has no dangling turn;
   - no sockets/network/device/Python/provider/vendor SDKs;
   - corrupt-tail replay is not weakened.

2. **Reviewer-owned docs pass pending.**  
   Apply or gate proposed docs edits for:
   - `docs/specs/voice-pipeline.md`
   - `docs/specs/protocol.md`
   - `docs/specs/evals.md`
   - `docs/specs/data-governance.md`
   - `docs/specs/model-gateway.md`

3. **Owner evidence hygiene NIT.**  
   `M3-02-owner-checks.md` is compressed into single-line Markdown and leaves `Owner evidence commit:` blank. This does not block closure because commit `8ca9e48`, CI run `29008352526`, and raw evidence files are externally verifiable.

## NIT

- Owner evidence logs contain ANSI escape sequences. They are readable and acceptable.
- Optional CLI/replay smoke is marked N/A; deterministic E2E/package/CLI evidence covers equivalent properties. This is acceptable but should be explicitly mentioned to Fable.

## Final decision

M3-02 is closed at primary-review level. Send `8ca9e48`, `fe8afc3`, and this final review to Fable/Opus for delivery countersign and docs pass.

---

## Countersignature — Claude (Fable 5), 2026-07-09

Code-level cross-check delegated to an opus subagent (12-item checklist at `fe8afc3` vs parent `adf8b33`, file:line evidence, reads via `git show` only). **12/12 PASS, zero vacuous assertions; every reviewer-gate clause from the brief gate is confirmed in code:**

- **(RE-2, the load-bearing gate)** Clamp implemented as a one-way per-axis max (`clampVoiceFrameLabels`, `packages/voice/src/index.ts:590-598` — rank tables + `Math.max`, advisory can only raise). Effective floor computed gateway/transport-side (`:918-920`); every emitted event's labels come from `effectiveFloor`/`finalLabels`/`ttsLabels` — **no code path copies frame labels into an envelope** (frame labels travel only on the advisory `session.start`/`utterance.start` frames to the worker). E2E asserts on the **emitted** `speech.asr.final` and `turn.input`: `public/global-ok` frame under balanced ⇒ `personal/region-restricted` + `prefer_local` (`voice.duplex-transport.test.ts:258-292`); stricter-raises proven at unit level (`secret/local-only` honored).
- **(RE-3)** Single construction site: `#submitVoiceFinalTranscript` (`server.ts:851-873`) → the one generic `#acceptTurnInput` (`:764-826`, sole `type: "turn.input"` constructor); both `voice.loopback` and `voice.duplex` call it; grep confirms no second builder. Refactor verified behavior-preserving (payload keys, label/routing handling identical to M3-01).
- **(RE-1)** Ten implemented frame kinds match the work report; the §2 mapping table (`start`→`session.start`+`utterance.start`, `synthesize`→`tts.request`, …) is in both Decisions and the proposed voice-pipeline docs edit — accurate vs code.
- **(RE-4)** Golden fixtures: 10 valid (one per kind), 4 invalid (missing required, bad residency enum, unregistered `voice.frame.binary` kind, negative `position_ms`); test iterates all with fail-closed decode/validate (throws on bad JSON and invalid frames).
- **(RE-6)** Cancelled utterance: event stream exactly `[mark, asr.partial, mark]` with final `mark_id:"asr-cancelled"`, **no `turn.input`**, `provider.requests === 0`, replay renders it cleanly and raw log greps clean, whole stream schema-validated. The new mark id lives in an additive `duplexMarkVocabulary`; M3-01's `loopbackMarkVocabulary` and its assertions are untouched.
- **(RE-5)** No config changes in the commit; the duplex path reuses `voice.enabled`/`voice.loopback.tts_chunk_chars` — nothing rides `additionalProperties: true`, exactly as gated.
- **Frames out of canon:** no `voice.frame.*`/`speech.worker.*` emissions anywhere; JSONL asserted free of them, of `data:audio/`, and of base64 runs; binary `VoiceAudioFrame` never reaches the event emitter (coordinator registers `onControl` only); metadata-only helper exposes counts, never bytes; `packages/protocol` untouched.
- **Transport/worker:** FIFO (control + per-stream audio), closed-endpoint rejection, deterministic overflow, 65536-byte guard all quoted; no timers, no socket/device/navigator imports (independent grep, plus an in-source scan test); worker `error` frames are generic (`"speech worker error"`) with the fixture secret asserted absent; final only emitted after a final audio frame.
- **Trust E2Es non-vacuous:** fixtures contain real hidden-reasoning text and a fake secret; `personal_default_hold` / `secret_denied` asserted with empty MemoryStore; egress blocked with `outbound.requests() === 0` before tool I/O; TTS text exactly the visible final, hidden/secret asserted absent; `speech.asr.final` escalates to `secret/local-only` on secret content.
- **Boundaries + weakening scan:** one production TurnRunner (`server.ts:327`); no vendor SDKs; no docs/config changes; no new env reads; zero raw CJK; tsx-world spawns; no `only`/`skip`; only new suite name is `voice.duplex-transport-v0`; pre-existing test files additions-only; `replay.test.ts` and `voice.protocol-loopback.test.ts` untouched (corrupt-tail byte-identical by absence).

### Non-blocking notes (for the record)

1. The brief's literal "`provider.requests === 0`" is asserted as a **per-turn delta** in the duplex suite (the primary is legitimately cleared for one safe personal turn first) — stronger than the literal form, which lives on in the M3-01 suite. No action.
2. Per-stream audio FIFO is implemented keyed by `stream_id` but tested single-stream only. Thin coverage, not wrong — a natural assertion to add when the real WS transport lands. Carry as a nice-to-have for the WS slice brief.
3. The in-source no-socket scan test doesn't check `navigator`/`AudioContext`; independent grep confirms none exist. Breadth nit only.
4. Owner evidence hygiene NIT (single-line markdown, blank evidence-commit field) noted by the primary review stands; raw evidence files + CI runs compensate. Evidence shows 75 passed | 1 skipped with both voice suites and all 13 M2 suites green, `memory.canary` visibly skipped.

### Docs pass — applied with this countersignature

`voice-pipeline.md` (M3-02 status note: third frame family, vocabulary mapping/supersession table, clamp semantics, cancel-is-not-barge-in, no-config statement), `protocol.md` (§5 `asr-cancelled` addition to the mark-vocabulary convention; §7 third-frame-family note — replay surface stays canonical `speech.*` only), `data-governance.md` (§1a duplex frame-label clamp note), `evals.md` (`voice.duplex-transport-v0` registry row + M3-02 registration status), `model-gateway.md` (`MockSpeechDuplexWorker` is not a provider role). **docs-zh re-translation TODO (owner-maintained): all five files.**

### Verdict: M3-02 ACCEPTED WITH NOTES / CLOSED

The worker-plane contract is now conformance-tested with the trust stack intact end-to-end: frame labels cannot lower the floor, frames cannot reach the canon, cancellation cannot dangle a turn, and the single voice→turn construction site held through the refactor. **Next: gate the M3-03 brief** (natural candidates per voice-pipeline: the real WS duplex transport behind the same conformance interface, or the first `workers/speech` Python worker skeleton — owner/ChatGPT to propose; the per-gate M3 trust property stands, and the M2 deferral landing gates remain in force).
