# M3-01 Review — Voice protocol + loopback audio transport skeleton

Review date: 2026-07-09  
Reviewer: ChatGPT 5.5 Thinking  
Task brief: `tasks/M3-01-voice-protocol-loopback.md`  
Brief gate: `tasks/M3-01-brief-review.md`  
Delivery commit: `bf6896e`  
CI: GitHub Actions run `28992694192`, success, ubuntu + windows matrix completed.

## Verdict

**ACCEPTED WITH NOTES — implementation accepted, task close pending owner evidence and Fable/Opus countersign.**

M3-01 implements the first voice slice: registered speech-event conformance, deterministic loopback transport, gateway/CLI loopback path, replay rendering, config surface, and the `voice.protocol-loopback-v0` deterministic PR-tier suite.

This is accepted at code/CI level. It is not yet task-closed because owner evidence under `tasks/owner-checks/M3-01/` is not committed yet, and the delivery should receive the expected Fable/Opus code-level countersign because this is the first M3 trust-stack extension.

## Evidence base

- Commit `bf6896e` / `M3-01-work`.
- CI run `28992694192`: success, 2 verify jobs completed.
- Work report: `tasks/M3-01-work.md`.
- Brief gate: `tasks/M3-01-brief-review.md`.

## Acceptance review

### 0. Preserve M2 trust invariants

**PASS.**

The work report states all full acceptance commands passed, including:

- `pnpm -r test`
- `pnpm --filter @fairy/testing test -- --reporter=verbose`
- `pnpm dep-check`
- `pnpm conformance`
- `git diff --check`
- `git diff --name-only -- docs docs-zh`
- `git diff --name-only -- docs`
- `git diff --name-only -- docs-zh`

All M2 named suites are listed as preserved, and M3-01 adds `voice.protocol-loopback-v0`.

### 1. Speech event schemas and fixtures

**PASS.**

The implementation reports no speech schema additions. It conforms to registered v1 shapes:

- `speech.asr.partial`: `utterance_id`, `text`
- `speech.asr.final`: `utterance_id`, `text`, `audio_ref`
- `speech.tts.chunk`: `chunk_id`, `text`, optional `audio_ref`
- `speech.mark`: `mark_id`, `position_ms`

`mark_id` remains free string; loopback vocabulary is asserted at transport-test level rather than enum-narrowing a shipped v1 schema.

### 2. Voice package / transport skeleton

**PASS.**

`packages/voice` was added as TS protocol/transport glue. The work report records:

- no provider interfaces;
- no cloud APIs;
- no device APIs;
- no vendor SDKs;
- no VAD/endpointing;
- no real audio transport.

`LoopbackVoiceTransport` emits canonical speech events around a single final-turn callback and generates deterministic TTS chunks from the visible assistant final text.

### 3. Gateway / CLI loopback path

**PASS.**

The implementation adds `voice.loopback` gateway op and `fairy voice loopback`. ASR final is converted into exactly one normal turn through the existing TurnRunner path:

- `turn.input.provenance = "user"`
- `payload.channel = "voice"`
- additive `payload.speech = { utterance_id, audio_ref }`
- balanced-floor `payload.routing_hints.prefer_local = true`

No second TurnRunner is reported.

### 4. Trust stack integration

**PASS WITH NOTE.**

The implementation carries the voice label floor:

- balanced: `personal / region-restricted` plus `prefer_local`
- sovereign: `personal / local-only`
- cloud-friendly: `personal / global-ok`

Content escalation uses the existing `escalateLabelsForContent`; route clearance stays in the model gateway before provider I/O; `voice.protocol-loopback-v0` covers under-cleared primary zero-request behavior.

**Important note:** the brief's original acceptance line expected a safe spoken `remember` to produce `memory.written`. The implementation instead records the conflict with the voice floor: because M3-01 requires voice input to be `personal` by default, the existing M2 MemoryGate holds safe voice remembers as `personal_default_hold` rather than writing them. This preserves M2 MemoryGate invariants and is the safer interpretation. Final close should ask Fable/Opus to explicitly countersign this spec-conflict resolution.

### 5. TTS visibility boundary

**PASS.**

The work report states TTS chunks derive only from `turn.final` visible text. Reasoning deltas, route-denial diagnostics, tool traces, and audit internals are not converted into TTS chunks. `speech.tts.chunk.payload.audio_ref` uses deterministic `loopback://tts/...` refs, not raw audio or base64.

### 6. Replay and debugger visibility

**PASS.**

`apps/cli/src/replay.ts` renders `speech.asr.partial`, `speech.asr.final`, `speech.tts.chunk`, and `speech.mark`. JSON replay preserves full speech payloads, and corrupt-tail replay behavior is reported as not weakened.

### 7. Eval suite

**PASS.**

The implementation adds and reports the deterministic PR-tier suite:

```text
voice.protocol-loopback-v0
```

Deferred M3 evals are explicitly not fake-passed:

- voice latency bench
- interrupt quality / barge-in <= 250 ms
- ASR zh/en/mixed benchmark

### 8. Config surface

**PASS.**

The implementation adds minimal config:

```yaml
voice:
  enabled: true
  transport: loopback
  loopback:
    tts_chunk_chars: 80
```

`voice.transport` is schema-locked to `loopback`; `tts_chunk_chars` is clearly a deterministic loopback-only test knob, not the future sentence chunker. No real provider keys/config are added.

### 9. Docs proposals only

**PASS.**

No `docs/` or `docs-zh/` files were edited. The work report includes proposed docs edits for protocol, model-gateway, data-governance, evals, and a proposed future `docs/specs/voice-pipeline.md`.

## BLOCKER

None for implementation acceptance.

## CARRY-IN

1. **Owner evidence pending.**  
   Commit `bf6896e` includes `tasks/M3-01-work.md`, but owner evidence under `tasks/owner-checks/M3-01/` has not yet been committed.

2. **Fable/Opus code-level countersign pending.**  
   This first M3 voice slice extends the trust stack into spoken input/TTS output. Countersign should specifically verify:
   - registered speech schemas remain authoritative;
   - no `mark_id` enum narrowing;
   - voice-originated `turn.input` envelope remains schema-valid;
   - balanced label floor test is non-vacuous;
   - under-cleared primary zero-request assertion is real;
   - no hidden reasoning/traces/audit text reach TTS;
   - no repo-tree generated artifacts;
   - corrupt-tail replay test was not weakened.

3. **MemoryGate vs voice floor resolution needs explicit reviewer acceptance.**  
   Implementation holds safe spoken remembers as `personal_default_hold` rather than writing `memory.written`. This is the safer M2-invariant-preserving behavior, but it diverges from one brief acceptance line. Final close should record Fable/Opus acceptance or request a brief correction.

4. **Reviewer-owned docs pass pending.**  
   Apply proposed docs edits after countersign:
   - `docs/specs/protocol.md`
   - `docs/specs/model-gateway.md`
   - `docs/specs/data-governance.md`
   - `docs/specs/evals.md`
   - possibly new `docs/specs/voice-pipeline.md` if reviewer decides to land it.

5. **Work report stale CI line.**  
   Work report says CI link was not available from Codex workspace. Current pushed CI run is `28992694192` and is green.

## NIT

- Several new `.ts` files appear long-line/minified, making later code-level citation harder.
- Owner evidence should prefer PowerShell 7 / UTF-8 no-BOM capture to avoid old mojibake issues.

## Final decision

M3-01 implementation is accepted with notes. Run owner checks, commit evidence, then send to Fable/Opus for delivery countersign.
