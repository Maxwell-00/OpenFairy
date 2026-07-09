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

---

## Countersignature — Claude (Fable 5), 2026-07-09

Code-level cross-check delegated to an opus subagent (14-item checklist at `bf6896e` vs parent `a8ebb3c`, file:line evidence, reads via `git show` only). **14/14 PASS, zero vacuous assertions; every reviewer-gate clause from the brief gate is confirmed in code:**

- **(RE-1)** Nothing under `packages/protocol` changed — no narrowing possible. The suite validates the entire emitted stream via `assertSchemaValidStream` → `validateEvent` (mock-client.ts:213) plus golden-fixture assertions. Emitted payloads use only registered-required fields plus additive-optional extras (`payload.speech`, `payload.routing_hints` on `turn.input`); `mark_id` stays a free string.
- **(RE-2)** `turn.input` built at `server.ts:878-887`: `provenance:"user"`, `channel:"voice"`, `payload.speech {utterance_id, audio_ref}`; envelope validated at construction; exactly one `turn.input` asserted (three independent count assertions); production `new TurnRunner` remains exactly one (`server.ts:327`).
- **(RE-4)** Floor derived per profile in `voiceInputPolicyForProfile` — all three profiles unit-asserted with `.toEqual`, balanced floor E2E-asserted **on the emitted turn.input labels** (non-vacuous, fails if the floor breaks). `prefer_local` rides the **pre-existing M2** `routing_hints` mechanism (`governance.ts:108`, pre-existing "advisory rather than gating" test at parent) — not a new side channel; provably never gates.
- **Zero-request:** `expect(provider.requests).toBe(0)` on the under-cleared primary + `route-denied` progress visible + `fallback.requests === 1` with fallback completing the turn.
- **Partials/final:** every partial asserted to precede the single model call (`finalCalls` ordering assertion); total provider requests === 1.
- **TTS boundary (non-vacuous):** fixtures contain real `reasoning.delta` text, hidden post-denial reasoning, and a fake secret; all asserted absent from every `speech.tts.chunk` and from replay stdout; chunks equal the visible `turn.final` text exactly.
- **Egress:** counting outbound server receives 0 requests; `egress.denied` stage + `denied_by_policy` tool.result; secret redacted across all non-ASR events.
- **Replay:** four speech render arms added to the existing switch; `apps/cli/test/replay.test.ts` diff is additions-only — the corrupt-tail test is byte-identical and green in owner evidence; `--json` payload preservation + no-`data:audio` asserted.
- **Config:** `transport` enum-locked `["loopback"]`; `tts_chunk_chars` minimum 1; invalid values throw `ConfigValidationError` (tested); no new env side channels (`FAIRY_GATEWAY_*` in cli/voice.ts is the pre-existing CLI connection pattern).
- **Boundaries:** no vendor SDKs; no new event types or suite names; no docs in the commit; zero raw CJK in new src; tsx-world spawns everywhere (`process.execPath --import tsx`); `packages/voice` exports source-first with sole dep `@fairy/protocol`; no `only`/`skip`; **weakening scan clean** — `a8ebb3c` is a pure 30s-timeout raise on two memory tests (assertions byte-identical), loader/replay test changes additive.

### Adjudication 1 — MemoryGate vs voice floor: the HOLD is correct; brief acceptance line superseded

`personal_default_hold` is **pre-existing M2 behavior** (`packages/memory/src/index.ts:343` at the parent commit: `#personalDefault = options.personalDefault ?? "hold"`; personal admission → hold, secret → deny). The brief's "safe spoken remember → `memory.written`" line survived from the pre-gate draft: my brief gate set the voice floor at `personal` (RE-4, per data-governance §1a) **without reconciling that acceptance line — the collision is the gate's miss, not the implementation's.** Codex resolved it the only correct way: compose the two invariants (personal floor × personal-hold ⇒ hold), change zero MemoryGate code, assert the hold in tests (`decision:"hold", reason:"personal_default_hold"`, no `memory.written`, empty MemoryStore), and disclose the conflict in the work report rather than forcing a green assertion. That disclosure is exactly the norm this project cultivates — noted with approval. **Ruling: hold is normative.** Voice must not weaken admission; a spoken personal-floor "remember" persists only through an explicit confirmation flow (future slice, not M3-01 debt). Recorded in data-governance.md and voice-pipeline.md in this docs pass.

### Adjudication 2 — Owner evidence substitution: accepted with note

The brief-named artifacts (`voice-loopback.json`, `voice-replay.{txt,json}`, `voice-manifests.txt`, `voice-governance.txt`) were not produced; `M3-01-owner-manual-checks.md` marks the standalone smokes N/A because the deterministic E2E suite proves the same properties, and `testing-voice.txt` shows all four `voice.protocol-loopback-v0` tests plus all 13 M2 named suites green with `memory.canary` still visibly skipped (70 passed | 2 skipped). Deterministic fixture/mock evidence is brief-permitted and the substitution is disclosed, so accepted. Standing note: owner-check substitutions should be surfaced to the reviewer as a question, not only documented post-hoc.

### Correction on the record — `docs/specs/voice-pipeline.md` exists and always has

My brief gate (RE-3), the work report, and the primary review all repeated the premise that `voice-pipeline.md` "does not exist yet." **False:** it has existed since `0dd4e49` (M0-01) — a full pipeline spec (ADR-006 topology, two-lane, incremental TTS, barge-in cascade, provider matrix) whose §2 insurance clause even pre-planned M3-01's loopback as the conformance-tested second implementation. The claim originated from my gate subagent's search; I failed to verify a negative-existence claim with a one-line `ls-tree` before writing it into the gate. Codex's proposed voice-pipeline content was therefore unnecessary (though consistent with the real spec — no harm done). Consequence for the docs pass: the existing spec gets an M3-01 implementation-status note instead of a new file. Seat lesson recorded in the handbook: verify negative-existence claims directly before they enter a gate document.

### Docs pass — applied with this countersignature

- `docs/specs/protocol.md`: §2 speech-row status note; §5 normative M3-01 additions (payload field semantics, mark vocabulary convention, voice `turn.input` convention, no-raw-audio rule, replay).
- `docs/specs/model-gateway.md`: loopback is not a provider role; real ASR/TTS roles (incl. `voice.fastpath` binding, `workers/speech/`) remain future M3.
- `docs/specs/data-governance.md`: §1a voice-floor enforcement note (floor semantics, prefer_local advisory, spoken-remember hold, TTS visibility boundary).
- `docs/specs/evals.md`: suite-registry row + M3-01 registration-status paragraph for `voice.protocol-loopback-v0`; the three M3 voice benches remain visibly deferred.
- `docs/specs/voice-pipeline.md`: M3-01 implementation-status note (loopback landed as the §2-planned second impl; config surface registered; trust floor + hold semantics; deferred acoustic machinery).
- **docs-zh re-translation TODO (owner-maintained):** all five files above.

### Non-blocking notes

1. `governance.ts:108-112` — the `prefer_local` branch returns the same decision on both paths (functional no-op that correctly encodes "advisory, never gates"); pre-existing, cleanup nicety only.
2. `speech.asr.final` carries content-escalated labels while the transport hands the unescalated floor to input assembly, which re-escalates — one-way escalation held consistently; no issue.
3. CI: implementation run `28992694192` green (ubuntu + windows) per primary review; `a550464` contains evidence/review files only.

### Verdict: M3-01 ACCEPTED WITH NOTES / CLOSED

First M3 slice closed with the trust property intact: voice enters and leaves through the canonical event stream, the one TurnRunner, and the full label/clearance/egress stack — verified at code level, not trusted. **Next: gate the M3-02 brief** (shape per ROADMAP/voice-pipeline: likely the speech-worker duplex protocol or the client audio transport conformance interface; whatever is proposed, the per-gate M3 trust property stands — voice paths inherit the full governance stack, and the M2 deferral landing gates remain in force).
