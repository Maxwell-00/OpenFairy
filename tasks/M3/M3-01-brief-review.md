# M3-01 Brief Gate — Voice protocol + loopback audio transport skeleton

Gate date: 2026-07-08
Reviewer role: task-brief gate (spec fidelity + invariants). **Not** an implementation review — M3-01 is unbuilt.
Brief under review: `tasks/M3-01-voice-protocol-loopback.md` (ChatGPT draft, committed at HEAD `6c0b97b`)
Repo state: M2 closure gated at `455f733` (CI `28940423265` green ubuntu+windows); verdict recorded in `e290d68`; M2 task files archived under `tasks/M2/` at `6c0b97b`.

Method: 14-item spec-fidelity audit delegated to an opus subagent (git-show/grep only, file:line evidence, per handbook §8 discipline adapted for brief gating). Every decisive finding below was then re-verified directly by this reviewer against `git show HEAD:` — the speech `*.v1.json` schemas and fixtures, `turn.input.v1.json` payload, `docs/specs/data-governance.md` §1a voice row, and `packages/config/defaults.yaml`.

---

## Verdict

**ACCEPTED WITH REQUIRED EDITS — edits applied in place by this gate.**

The brief's shape, boundaries, and deferrals are correct: one TurnRunner, no second voice agent, no real providers, evals-with-capability, ROADMAP scope faithful (loopback-as-second-impl is even explicitly grounded in ROADMAP's ADR-006 amendment note), M2 deferral landing gates correctly threaded and none lands here, no vector work smuggled in. `voice.fastpath` (`model-gateway.md` §3), the 13 M2 suite names, the M3 eval names/thresholds (barge-in ≤ 250 ms, p50 ≤ 1.2 s / p95 ≤ 2.5 s), and `turn.input` as the canonical input event all check out verbatim against the specs.

But it carries the drafter's signature failure mode in one load-bearing place: **Deliverable 1's suggested payload shapes contradict the speech schemas that already shipped.** RE-1/RE-2 are blockers-if-dispatched-as-was; the rest are fidelity pins. All edits are applied directly to the brief file — diff it against `6c0b97b` to review the changes, then commit both files and dispatch.

## BLOCKER

None remaining (RE-1/RE-2 would have been, had the brief dispatched unedited).

---

## REQUIRED EDITS (applied in place)

### RE-1 — Registered speech schemas are authoritative; the brief's suggested shapes would fail them (HIGH)

The brief framed the speech payload schemas as possibly "incomplete or missing" and suggested shapes built on `stream_id`/`segment_id`/`offset_ms`/`seq`/`source_audio_ref` plus a `mark` **enum**. Reality at HEAD: `packages/protocol/schemas/speech.{asr.partial,asr.final,tts.chunk,mark}.v1.json` **and** valid+invalid golden fixtures all exist and are complete. Registered required fields:

| Event | Required payload fields |
|---|---|
| `speech.asr.partial` | `utterance_id`, `text` |
| `speech.asr.final` | `utterance_id`, `text`, `audio_ref` |
| `speech.tts.chunk` | `chunk_id`, `text` (optional `audio_ref`) |
| `speech.mark` | `mark_id`, `position_ms` (integer ≥ 0) |

Fixtures built to the brief's shapes fail these schemas. Worse, the acceptance list ("missing stream id", "unknown mark values", "negative offset") tested fields that do not exist; enforcing "unknown mark values" would require adding an enum to `mark_id` — a **breaking narrowing of a shipped v1 schema** (protocol.md §3 additive-minor rule).

Edit applied: Deliverable 1 rewritten. Registered field names authoritative; evolution additive-optional only (schema+fixtures updated together, listed in work-report Decisions + proposed protocol.md edit); invalid-fixture acceptance now matches the registered invalid fixtures (empty `utterance_id`, missing `audio_ref`, empty `text`, negative `position_ms`); `mark_id` stays a free string with a documented conventional vocabulary asserted at transport level; "no raw audio/base64" is test-enforced across loopback session JSONL, not schema-narrowing-enforced.

### RE-2 — "turn.input with speech provenance" would produce invalid envelopes (MED)

The envelope `provenance` pattern is closed: `^(user|agent|tool:[^\s]+|web:[^\s]+|mcp:[^\s]+)$` (every schema, incl. `turn.input.v1.json`). There is no `speech` value; a literal `provenance: "speech"` fails validation. `turn.input.payload` already has a free `channel` string.

Edit applied: ASR-final-driven `turn.input` carries `provenance: "user"`, `payload.channel: "voice"`, and an additive-optional payload linkage to the source utterance (e.g. `payload.speech.utterance_id`), proposed as a protocol.md docs edit; the produced envelope must schema-validate in tests.

### RE-3 — `voice.*` config keys registered in no spec; `tts_chunk_chars: 80` is an invented value (MED)

No config spec exists; keys register per feature spec (CLAUDE.md: specs are normative including config schemas). No `voice` block exists anywhere in `packages/config`. `tts_chunk_chars` appears in no spec, and ROADMAP mandates CJK-aware **sentence**-chunked TTS — a char-count knob is not that.

Edit applied: `transport` schema-locked to enum `["loopback"]` this slice; `tts_chunk_chars` accepted as an explicitly loopback-only deterministic test knob (docs proposal must say it is not the M3 sentence chunker); the work report's proposed docs edits MUST include registering the whole `voice.*` block. `enabled: true` default is accepted — consistent with persona/affect/chronicle default-on precedent in `defaults.yaml`, and loopback is inert unless invoked.

Additionally (folded into Deliverable 8): the reviewer **asks** for full proposal content for `docs/specs/voice-pipeline.md` in the work report (proposal only, no file creation — reviewer lands docs). Three M3 rows in evals.md already cite `voice-pipeline` as their source spec; it does not exist yet and this slice should produce the draft to unorphan them.

### RE-4 — Voice input's normative default label floor was unstated (MED)

`docs/specs/data-governance.md` §1a is normative and already has the row: "User voice audio (to ASR)" → balanced `personal / region-restricted(home)` *prefer_local*; sovereign `personal / local-only`; cloud-friendly `personal / global-ok`. The brief only spoke generically of escalation.

Edit applied: Deliverable 4 now requires loopback ASR final transcripts to carry the profile-derived default label class as **floor** (content escalation may raise, never lower; `prefer_local` remains a hint that never gates, per M2-01 rule), with a test pinning the balanced default (owner env: `governance.home_regions: [cn]`). Owner governance smoke updated to expect the floor label.

### RE-5 — M2 closure commit attribution imprecise (LOW)

"M2 closed at commit `e290d68`" — `e290d68` is the doc commit recording the verdict; the CI-verified gate commit is `455f733` (run `28940423265`); `6c0b97b` archives. Header corrected; `tasks/M2-exit-review.md` reference re-pathed to `tasks/M2/M2-exit-review.md` (post-archive location).

### RE-6 — Standing rules threaded (LOW; incident-derived, enforce-don't-relitigate)

Added to the brief as an explicit gate section + boundary bullets:

- **tsx single execution world** for the new CLI verb and its tests (`scripts/run-cli.mjs` / `node --import tsx`; never plain `node` on `.ts`) — standing rule, M1-era incident class.
- **Encoding (M2-05c):** valid UTF-8 CJK in fixtures passes the guard (`scripts/check-encoding.mjs` blocks mojibake/U+FFFD, not CJK), but new `.ts` regex literals with CJK must be `\uXXXX`-escaped, and any verification command targeting non-ASCII must be a fully-ASCII `node -e` script — never raw CJK pasted into a Windows terminal.
- **`packages/voice` is TS protocol/transport glue only**; real ASR/TTS providers land later under `workers/speech/` (dep-cruiser rule 4 whitelists vendor SDKs only in `packages/model-gateway` and `workers/speech`). No provider-adapter scaffolding in `packages/voice`.
- **Replay** extends the existing event-type switch in `apps/cli/src/replay.ts`; the corrupt-tail test (`apps/cli/test/replay.test.ts`) must remain untouched — the countersign weakening scan diffs pre-existing tests.
- New-package mechanics for the record: `pnpm-workspace.yaml` globs auto-include `packages/voice`; source-first exports (`types`/`import` → `./src/index.ts`); no native deps, so no `pnpm approve-builds` concern.

---

## CARRY-IN

### CI-1 — M2-08 review CARRY-IN 4: generated artifacts stay out of the repo tree

Threaded into Deliverable 3 acceptance and Boundaries: loopback CLI and its tests default to temp data dirs and write nothing into the repo tree; owner-run evidence goes under `tasks/owner-checks/M3-01/`. (M2-08's `extensions/skills/learned/pending/` write was the accepted exception because the product path itself was under validation; nothing in M3-01 qualifies.)

Deferral register check: no M2 deferral lands at M3-01 (S4→M4 entry; persona judge→M4 exit/critic; vector benchmark→first vector task brief-gate; canary/contradiction→model-backed consolidation; friction soak→M5). The brief threads this correctly and contains no vector work. M2-09's gate carry-ins were discharged at the exit gate; reviewer docs passes are applied through M2-08.

---

## NIT

- The brief's "define or complete" framing for speech schemas was stale (they are complete); superseded by RE-1.
- Speech payload schemas are `additionalProperties: true` with no offset/language/confidence fields — additive room exists if loopback genuinely needs it; keep required sets intact.
- The four speech schemas' `audio_ref` format is loosely specified project-wide (`artifact://` appears informally in kernel tests; the golden fixture uses a bare `artifacts/utt-1.opus` path). Not this slice's problem to solve; flag in spec-ambiguities if it bites, and note the M2-07 quirk (`session.compacted.summary_ref` absolute-path inconsistency) is the same family.

---

## Reviewer-gate clauses for the delivery countersign

(For the §8 subagent checklist when M3-01 delivers; each maps to an RE above.)

1. Speech fixtures/tests validate against the registered `speech.*.v1` schemas; any new payload field is optional, additive, schema+fixture-paired, and listed in Decisions. No renamed/removed required fields; no `mark_id` enum. (RE-1)
2. Voice-originated `turn.input`: `provenance: "user"`, `payload.channel: "voice"`, schema-valid; linkage field additive and docs-proposed. (RE-2)
3. Config: `voice.transport` enum-locked to `["loopback"]`; `voice.*` registration present in proposed docs edits; `voice-pipeline.md` proposal content present in work report; no side-channel config. (RE-3)
4. Balanced-profile floor label test present and non-vacuous (`personal / region-restricted(home)`, `prefer_local` hint non-gating); under-cleared primary gets zero request bytes. (RE-4)
5. tsx-world CLI spawning; corrupt-tail test byte-identical; no repo-tree writes from tests/CLI; no CJK regex without escapes; `packages/voice` free of provider scaffolding. (RE-6/CI-1)

---

## Dispatch instruction

Owner: diff both files against HEAD (`git diff -- tasks/M3-01-voice-protocol-loopback.md tasks/M3-01-brief-review.md` after staging), commit via GitHub Desktop, then dispatch the patched brief to Codex. RE-1 and RE-2 are the load-bearing edits: without them, Codex would have built fixtures that fail the shipped schemas and turn inputs that fail envelope validation — both discovered only at delivery review, one full round-trip late. With the edits in, this is a clean, testable, spec-faithful first M3 slice — dispatch-ready.
