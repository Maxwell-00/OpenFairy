# Task M3-01 — Voice protocol + loopback audio transport skeleton

> Paste this entire file as the task brief after task-brief gate review.
> Gated 2026-07-08 by the reviewer (Claude Fable 5); gate record in `tasks/M3-01-brief-review.md`; edits RE-1..RE-6 + CI-1 applied in place.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M0, M1, and M2 are closed. M2 closure was gated at commit `455f733` (GitHub Actions run `28940423265`, ubuntu + windows green) with verdict **M2 CLOSED WITH EXPLICIT DEFERRALS**; the verdict is recorded in commit `e290d68`, and the M2 task files are archived under `tasks/M2/` at `6c0b97b`.
>
> This is the first M3 slice. It must prove that voice can enter and leave Fairy through the canonical event/replay/trust stack without introducing a second agent loop.
>
> This task is **not** a real ASR/TTS provider task. It implements protocol/schema/test harness + deterministic loopback transport only.

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
   - M3 starts with voice, but voice must inherit M2 trust properties.
   - Owner commits/pushes before review.
   - Docs reviewer-owned unless explicitly instructed.

3. `tasks/M2/M2-exit-review.md`
   - M2 is closed with explicit deferrals.
   - M3-01 hard preconditions are accepted.
   - Voice does not unblock the M2 deferred items:
     - S4 >=20 real sessions lands at M4 entry;
     - persona frozen judge lands at M4 exit / critic wiring;
     - vector benchmark gates vector work;
     - memory canary / contradiction benchmark gate model-backed consolidation;
     - friction soak lands at M5.
   - M3-01 must preserve the trust stack: labels, route clearance, egress guard, replay, corrupt-tail tolerance.

4. `docs/ROADMAP.md`
   - M3 scope: speech worker framework, duplex audio protocol, ASR/TTS one cloud + one local later, VAD/endpointing later, two-lane turn integration later, ack bank, sentence-chunked TTS, barge-in cascade, desktop tray client later.
   - M3 exit includes S1 live, latency p50/p95, barge-in quality, zh/en/mixed bench, and fully replayable voice sessions.
   - This task implements only the first skeleton slice, not the whole M3 milestone.
   - The loopback transport is grounded in ROADMAP: "Client audio transport behind a conformance-tested interface (loopback second impl — ADR-006 amendment)."

5. `packages/protocol/schemas/registry.v1.json` + `packages/protocol/schemas/speech.*.v1.json` + `packages/protocol/fixtures/speech.*.json` — **(gate RE-1)**
   - The four speech event types are already registered, **and their payload schemas plus valid/invalid golden fixtures already exist and are complete**:
     - `speech.asr.partial` — payload requires `utterance_id`, `text`;
     - `speech.asr.final` — payload requires `utterance_id`, `text`, `audio_ref`;
     - `speech.tts.chunk` — payload requires `chunk_id`, `text`; optional `audio_ref`;
     - `speech.mark` — payload requires `mark_id`, `position_ms` (integer >= 0).
   - These registered schemas are **authoritative**. Do not rename or restructure their fields. Evolution is additive-minor only (protocol.md §3): new fields must be optional, existing required sets stay intact, and no shipped v1 field gets narrowed (no new enums on existing fields).
   - Do not invent unregistered speech event types.

6. `docs/specs/protocol.md`
   - The runtime canon is normative.
   - Client protocol is a filtered view of canon, not a separate schema.
   - Nothing outside `model-gateway` may construct/parse provider dialect shapes.
   - New speech surfaces must be first-class canonical events and replayable.
   - Protocol §5: binary audio frames are not events; events reference audio by ref (`speech.asr.final` carries the utterance audio artifact ref; `speech.tts.chunk` carries `{chunk_id, text, audio_ref?}`).

7. `docs/specs/model-gateway.md`
   - `voice.fastpath` is a role concept in the model-gateway spec, but this task should not bind real ASR/TTS providers.
   - Real ASR/TTS roles and provider conformance are later M3 slices.
   - No vendor SDKs.

8. `docs/specs/data-governance.md`
   - Effective labels derive over the assembled prompt.
   - Spoken transcripts, audio artifacts, and TTS payloads carry labels/provenance.
   - **(gate RE-4)** §1a is normative for spoken input: "User voice audio (to ASR)" defaults to `personal / region-restricted(home)` *prefer_local* under the balanced profile (`personal / local-only` sovereign; `personal / global-ok` cloud-friendly). This is the label **floor** for ASR transcripts.
   - Voice input must not bypass route clearance, MemoryGate, egress guard, or redaction.

9. `docs/specs/context-engine.md`
   - Voice ASR final text becomes current input only through a bounded, label-bearing path.
   - ASR partials and TTS chunks are observability/output events; they do not enter the model prompt unless deliberately converted into a final user input.
   - Context manifest remains observational.

10. `docs/specs/evals.md`
   - M3 introduces voice-specific evals:
     - voice latency bench;
     - interrupt quality;
     - ASR quality.
   - This first slice must register a deterministic PR-tier skeleton suite, but must not fake-pass latency, barge-in, or ASR quality benchmarks.
   - Note: the three M3 voice eval rows cite `voice-pipeline` as their source spec; that spec does not exist yet (see Deliverable 8).

## Deliverables

### 0. Preserve M2 trust invariants

Before adding voice behavior, preserve regression evidence that M2 trust gates still work.

Required:

- All existing M2 PR-tier named suites remain visible and green:
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
- `memory.canary` remains visibly skipped/deferred; do not fake-pass.
- One TurnRunner.
- No provider-specific branches in kernel.
- No vendor SDKs.
- No docs-zh edits.

Acceptance:

- `pnpm --filter @fairy/testing test -- --reporter=verbose` shows M2 suites.
- `git diff --name-only -- docs-zh` has no output.
- If docs/specs are not explicitly touched, `git diff --name-only -- docs` has no output.

### 1. Speech event schemas and fixtures — **(rewritten at gate, RE-1)**

The four speech payload schemas and their golden fixtures already exist and are complete (Context §5). The work here is to **conform to them** and extend additively only where loopback/replay genuinely needs it.

Required:

- Treat the registered field names as authoritative:
  - `speech.asr.partial.payload`: `utterance_id`, `text` (required).
  - `speech.asr.final.payload`: `utterance_id`, `text`, `audio_ref` (required).
  - `speech.tts.chunk.payload`: `chunk_id`, `text` (required), `audio_ref` (optional).
  - `speech.mark.payload`: `mark_id`, `position_ms >= 0` (required).
- Partial/final events for the same utterance share the same `utterance_id`; replay linkage builds on `utterance_id` / `chunk_id` / `mark_id`.
- If loopback or replay needs more (e.g. `seq` on tts chunks, `language`, `confidence`, an optional `utterance_id` on `speech.tts.chunk` to tie chunks back to their utterance/turn), add them as **optional** fields, additively, with schema + fixtures updated together, the exact additions listed in `tasks/M3-01-work.md` Decisions, and a matching proposed `docs/specs/protocol.md` edit.
- Payloads stay small and canonical. No raw audio bytes/base64 in JSONL: `audio_ref` is a reference (artifact/file ref under session/artifact storage, or a deterministic loopback ref). This invariant is **test-enforced** (assert no `data:` URIs / base64 audio blobs in any speech payload across a loopback session log), not schema-narrowing-enforced.
- `mark_id` stays a free string (adding an enum to a shipped v1 field is a breaking narrowing — forbidden). The loopback transport uses a documented conventional vocabulary: `asr-start`, `asr-end`, `tts-start`, `tts-end`, `turn-boundary`, `barge-in-placeholder`. The vocabulary is asserted at transport level (unit test on emitted mark ids) and included in the proposed protocol.md docs edit.
- Labels and provenance remain on the event envelope.

Acceptance:

- Protocol schema tests pass against the **registered** schemas; existing golden fixtures remain green.
- Valid fixtures for all four event types validate; any new optional field lands with updated valid + invalid fixtures.
- Invalid fixture rejections match the registered schemas:
  - empty `utterance_id`;
  - missing `audio_ref` on `speech.asr.final`;
  - empty `text`;
  - negative `position_ms`.
- Loopback-session JSONL contains no raw audio/base64 payloads (test-level assertion).
- Registry remains additive and no unregistered speech event type appears.

### 2. Voice package / transport skeleton

Add a small voice package or module with deterministic loopback transport.

Suggested package:

```text
packages/voice
```

**(gate RE-6)** `packages/voice` is TS protocol/transport glue only. Real ASR/TTS providers are later M3 slices and live under `workers/speech/` (dep-cruiser already whitelists vendor SDKs only in `packages/model-gateway` and `workers/speech`). Do not lay provider-adapter scaffolding in `packages/voice`. Package mechanics: `pnpm-workspace.yaml` globs auto-include `packages/voice`; exports must be source-first (`types`/`import` → `./src/index.ts`); no dist exports.

Required interfaces:

- `VoiceTransport`
  - accepts deterministic input frames or scripted transcript steps;
  - emits canonical speech events;
  - never calls a real microphone, speaker, network API, or provider in CI.

- `LoopbackVoiceTransport`
  - reads a scripted fixture of ASR partial/final and expected TTS chunks;
  - can attach to an existing session id or create a test session via normal gateway/CLI path;
  - emits `speech.asr.partial` and `speech.asr.final` sharing an `utterance_id` per scripted utterance;
  - forwards only `speech.asr.final` text into a normal user turn;
  - emits `speech.tts.chunk` events with stable `chunk_id`s from the assistant final text or deterministic fixture text;
  - emits `speech.mark` events using the conventional mark vocabulary (Deliverable 1) for start/end/turn-boundary markers.

Required behavior:

- ASR partials do not call the model.
- ASR final creates one normal user turn through existing TurnRunner/gateway path.
- TTS chunks are output events only; they never re-enter the prompt.
- No second TurnRunner.
- No separate "voice agent".
- No real ASR/TTS model/provider.
- No raw audio bytes in JSONL.

Acceptance:

- Unit tests for loopback event ordering and `utterance_id`/`chunk_id`/`mark_id` stability.
- Unit tests that partials do not produce model calls.
- Unit tests that final transcript produces exactly one normal turn.
- Unit tests that TTS chunks are output-only.
- Unit test that emitted `mark_id`s stay within the documented vocabulary.

### 3. Gateway / CLI loopback path

Expose a minimal developer-facing loopback path.

Choose one or both:

```powershell
pnpm fairy voice loopback --script <fixture.json> --json
```

or an internal gateway route used only by tests.

Required behavior:

- The loopback run writes a normal session JSONL with speech events and turn events.
- **(gate RE-2)** A final ASR transcript becomes a `turn.input` whose envelope `provenance` is `user` — the envelope provenance pattern is closed (`user|agent|tool:*|web:*|mcp:*`; there is **no** `speech` provenance value) — with `payload.channel: "voice"` and an additive-optional payload linkage to the source utterance (e.g. `payload.speech.utterance_id`). The produced `turn.input` must schema-validate. Propose the linkage field as a protocol.md docs edit.
- Assistant text can produce deterministic `speech.tts.chunk` events.
- JSON output includes:
  - session id;
  - event counts;
  - transcript text;
  - assistant final text;
  - tts chunk count;
  - log path or replay command.

Acceptance:

- CLI test with temp data dir.
- **(gate CI-1)** Tests and the loopback CLI default to temp/data-dir locations and write nothing into the repo tree; owner-run evidence belongs under `tasks/owner-checks/M3-01/`.
- **(gate RE-6)** The new CLI verb runs through the existing single execution world (`scripts/run-cli.mjs` / `node --import tsx`); tests never spawn plain `node` on `.ts`.
- JSON parse test.
- No real audio device access.
- No network access.
- Works on Windows and Linux CI.

### 4. Trust stack integration

Voice must inherit M2 trust rules.

Required behavior:

- ASR final transcripts carry labels and provenance. **(gate RE-4)** The label **floor** for spoken input is the profile-derived voice-audio default (data-governance §1a: balanced = `personal / region-restricted(home)` with `prefer_local` hint; sovereign = `personal / local-only`; cloud-friendly = `personal / global-ok`). Content escalation may raise labels above the floor; nothing lowers them. `prefer_local` remains a hint and never gates (M2-01 rule). Effective labels compose over the whole assembled prompt as in M2.
- If transcript content escalates to `secret` or `personal/local-only`, route clearance happens before model I/O.
- Under-cleared primary receives zero request bytes.
- Cleared fallback can complete if configured.
- MemoryGate behavior remains unchanged:
  - explicit "remember" from voice goes through MemoryGate;
  - secret-like remembered speech is denied;
  - no automatic memory write just because content was spoken.
- Egress guard remains unchanged:
  - spoken secret content cannot be sent to outbound tools.
- TTS must not speak hidden reasoning, redacted diagnostics, or denied secret content.

Acceptance:

- Test: a loopback transcript with no escalating content carries the balanced-profile default floor `personal / region-restricted(home)` (owner env: `governance.home_regions: [cn]`) and the `prefer_local` hint is present and non-gating.
- E2E: spoken secret-like transcript denies under-cleared primary before provider I/O; denied candidate visible; fallback completes or visible deny if none.
- E2E: spoken explicit remember safe preference creates normal MemoryGate allow and `memory.written`.
- E2E: spoken explicit secret remember creates MemoryGate deny and no `memory.written`.
- E2E: spoken malicious instruction attempting outbound secret egress is blocked before tool execution and redacted in diagnostics.
- Test: TTS chunks derive only from user-visible assistant final text, not `reasoning.delta`, hidden traces, route-denial raw secret, or audit internals.

### 5. Replay and debugger visibility

Voice sessions must be fully replayable.

Required behavior:

- `fairy replay` text mode renders:
  - ASR partial/final compactly;
  - TTS chunks compactly;
  - speech marks;
  - the associated turn input/final.
- `fairy replay --json` preserves full payloads.
- `fairy replay --manifests` continues to work.
- Corrupt-tail tolerance remains green.
- Speech events must not break existing replay regression.
- **(gate RE-6)** Implementation extends the existing event-type rendering switch in `apps/cli/src/replay.ts`; the corrupt-tail test (`apps/cli/test/replay.test.ts`) must remain untouched and green — the countersign weakening scan diffs pre-existing tests.

Acceptance:

- CLI replay tests for speech events.
- JSON replay payload-preservation test.
- Corrupt-tail replay test remains green.
- Replay output contains no raw audio/blob payload.

### 6. Eval suite

Register a deterministic PR-tier suite in `packages/testing`.

Required suite name:

```text
voice.protocol-loopback-v0
```

Required coverage:

- speech event schemas/fixtures validate against the **registered** schemas;
- loopback ASR partial/final event ordering;
- ASR final enters normal TurnRunner path once;
- TTS chunks are generated as output-only events;
- replay renders speech events;
- voice transcript labels gate routing (incl. the default floor label);
- MemoryGate/egress behavior remains inherited;
- no real provider, microphone, speaker, network, or OS audio device in CI.

Also report these M3 evals as deferred/future, not pass:

```text
voice latency bench
interrupt quality / barge-in <= 250 ms
ASR zh/en/mixed benchmark
```

Acceptance:

- `voice.protocol-loopback-v0` appears in `pnpm --filter @fairy/testing test -- --reporter=verbose`.
- Non-vacuous assertions.
- No LLM judge.
- No real audio provider.

### 7. Config surface — **(edited at gate, RE-3)**

Add only minimal config.

Suggested:

```yaml
voice:
  enabled: true
  transport: loopback
  loopback:
    tts_chunk_chars: 80
```

Rules:

- Extend the existing config loader/schema (`packages/config/src/schema.ts`, `packages/config/defaults.yaml`) following the persona/affect/chronicle pattern. `enabled: true` default is accepted (matches sibling-feature default-on precedent; loopback is inert unless invoked).
- `transport` is schema-locked to the enum `["loopback"]` in this slice; invalid values fail validation. Real transports extend the enum in later slices.
- `loopback.tts_chunk_chars` is a deterministic **loopback-only** chunking knob for tests. It is explicitly **not** the M3 CJK-aware sentence-chunked TTS from ROADMAP (that lands with real TTS in a later slice); the docs proposal must say so.
- The whole `voice.*` block is currently registered in **no spec**. The work report's proposed docs edits MUST include registering these keys (see Deliverable 8).
- Defaults are safe and deterministic.
- Invalid values fail validation.
- Do not add real ASR/TTS provider config yet unless needed as inert placeholder.
- Do not wire `voice.fastpath`, cloud ASR, local ASR, cloud TTS, or local TTS in this slice.
- No side-channel config: no separate config files, env-var switches, or hardcoded policy tables.

Acceptance:

- Config tests for defaults, valid override, invalid values (including a rejected non-`loopback` transport).
- No real API key support.
- No side-channel config.

### 8. Docs proposals only — **(edited at gate)**

Do not edit `docs-zh/`.

Default: do not edit `docs/` either. Put proposed docs edits in `tasks/M3-01-work.md`; the reviewer lands docs.

Propose docs edits for:

- `docs/specs/protocol.md`
  - speech event payload field semantics as registered;
  - any additive fields introduced (with rationale);
  - the conventional `mark_id` vocabulary;
  - the `turn.input` voice channel/linkage convention (RE-2);
  - replay visibility;
  - no raw audio payloads in JSONL.

- `docs/specs/model-gateway.md`
  - real ASR/TTS roles deferred; loopback transport is not a provider role.

- `docs/specs/data-governance.md`
  - ASR final transcripts and audio artifacts carry labels (floor per §1a) and gate routes.

- `docs/specs/evals.md`
  - register `voice.protocol-loopback-v0`;
  - mark latency/barge-in/ASR benchmarks as future M3 slices.

- `docs/specs/voice-pipeline.md` — **(gate RE-3): the reviewer asks for full proposal content for this spec in `tasks/M3-01-work.md`** (evals.md's three M3 voice eval rows already cite `voice-pipeline` as their source spec; it does not exist yet). The proposal must include the `voice.*` config key registration (keys, defaults, meaning, loopback-only scope of `tts_chunk_chars`). **Proposal only — do not create the file**; the reviewer lands docs and decides final placement.

## Boundaries — do NOT

- Do not implement real microphone capture.
- Do not implement real speaker playback.
- Do not implement real ASR provider.
- Do not implement real TTS provider.
- Do not call cloud audio APIs.
- Do not import vendor audio SDKs.
- Do not implement VAD or endpointing.
- Do not implement barge-in cascade beyond an inert `barge-in-placeholder` mark if useful.
- Do not implement latency benchmarks as pass.
- Do not implement ASR quality benchmark as pass.
- Do not implement desktop tray client.
- Do not implement M4 workflows/scheduler/proactivity.
- Do not create a second TurnRunner.
- Do not bypass model-gateway route clearance.
- Do not send ASR partials to the model.
- Do not TTS hidden reasoning/traces/audit internals.
- Do not store raw audio/base64 in JSONL.
- Do not edit `docs-zh/`.
- **(gate)** Do not rename or restructure the registered speech payload fields; do not narrow shipped v1 schemas (no enums on `mark_id`).
- **(gate)** Do not put provider adapters or provider scaffolding in `packages/voice` (future providers live under `workers/speech/`).
- **(gate)** Do not spawn plain `node` on `.ts` files anywhere (tsx single execution world).
- **(gate)** Do not write generated fixtures/artifacts into the repo tree from tests or the loopback CLI (temp dirs / owner-checks only).

## Encoding rules — **(gate RE-6; standing rules per M2-05c)**

- Valid UTF-8 Chinese text in fixtures is permitted (the lint encoding guard blocks mojibake/U+FFFD, not CJK), but prefer English-only fixture text in this slice unless zh text is testing something specific.
- Any new `.ts` regex literal containing CJK must use `\uXXXX` codepoint escapes.
- Any verification command whose target string is non-ASCII must be written as a fully-ASCII `node -e` script using `\uXXXX` escapes — never paste raw CJK into a terminal check (Windows terminals re-mangle; M2-05 incident class).

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
git diff --name-only -- docs-zh
```

GitHub Actions must be green on ubuntu + windows.

## Manual owner checks

Owner should run after CI is green. Deterministic fixture/mock evidence is acceptable. No real audio device or provider required.

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M3-01 | Out-Null
```

### 1. Voice protocol suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Expected:

- `voice.protocol-loopback-v0` appears and passes.
- All M2 named suites remain green.
- Future M3 latency/barge-in/ASR quality benchmarks are not fake-passed.

Save:

```text
tasks/owner-checks/M3-01/testing-voice.txt
```

### 2. Loopback CLI smoke

Run the chosen CLI command, for example:

```powershell
pnpm fairy voice loopback --script <fixture.json> --json
```

Expected:

- JSON parseable.
- session id visible.
- ASR partial/final event counts visible.
- exactly one normal turn from ASR final.
- TTS chunk count visible.
- no raw audio/base64.

Save:

```text
tasks/owner-checks/M3-01/voice-loopback.json
```

### 3. Replay smoke

Replay the generated session.

Expected:

- speech events render in text replay.
- JSON replay preserves payload.
- manifests still render.
- corrupt-tail tolerance remains green.

Save:

```text
tasks/owner-checks/M3-01/voice-replay.txt
tasks/owner-checks/M3-01/voice-replay.json
tasks/owner-checks/M3-01/voice-manifests.txt
```

### 4. Governance smoke

Run fixture where spoken transcript contains secret-like or personal/local-only content.

Expected:

- transcript floor label visible: balanced default `personal / region-restricted(home)` (`prefer_local` hint present, non-gating);
- under-cleared primary receives zero request bytes;
- fallback completes or visible deny if none;
- no TTS of hidden secret diagnostics;
- MemoryGate behaves normally for spoken remember cases;
- egress guard blocks spoken secret outbound attempt.

Save:

```text
tasks/owner-checks/M3-01/voice-governance.txt
```

## Report back

Use the established format:

1. File tree delta.
2. Verification tails:
   - local commands;
   - CI link/status;
   - conformance verdict;
   - named suite names.
3. Decisions:
   - speech payload conformance + any additive schema fields (exact list);
   - loopback transport interface;
   - how ASR final becomes turn input (envelope provenance/channel/linkage);
   - TTS chunk derivation;
   - label/provenance behavior (incl. floor label);
   - replay rendering;
   - config shape.
4. Spec ambiguities.
   - Non-empty; at minimum: which additive schema fields (if any) were added and why; why no real ASR/TTS provider is in M3-01; any friction with the registered speech schemas or the `audio_ref` format convention.
5. Proposed docs edits (incl. the `voice-pipeline.md` proposal and `voice.*` config registration).
6. Manual owner checklist with exact commands and evidence paths.
