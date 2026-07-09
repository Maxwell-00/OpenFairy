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
