# Task M3-01 — Voice protocol + loopback audio transport skeleton

> Paste this entire file as the task brief.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M0, M1, and M2 are closed. M2 closed at commit `e290d68` with verdict **M2 CLOSED WITH EXPLICIT DEFERRALS**.
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

3. `tasks/M2-exit-review.md`
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

5. `packages/protocol/schemas/registry.v1.json`
   - Speech event types are already registered:
     - `speech.asr.partial`
     - `speech.asr.final`
     - `speech.tts.chunk`
     - `speech.mark`
   - If payload schemas/fixtures for these types are incomplete or missing, add them additively.
   - Do not invent unregistered speech event types.

6. `docs/specs/protocol.md`
   - The runtime canon is normative.
   - Client protocol is a filtered view of canon, not a separate schema.
   - Nothing outside `model-gateway` may construct/parse provider dialect shapes.
   - New speech surfaces must be first-class canonical events and replayable.

7. `docs/specs/model-gateway.md`
   - `voice.fastpath` is a role concept in the model-gateway spec, but this task should not bind real ASR/TTS providers.
   - Real ASR/TTS roles and provider conformance are later M3 slices.
   - No vendor SDKs.

8. `docs/specs/data-governance.md`
   - Effective labels derive over the assembled prompt.
   - Spoken transcripts, audio artifacts, and TTS payloads carry labels/provenance.
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

### 1. Speech event schemas and fixtures

Define or complete payload schemas and fixtures for the pre-registered speech events.

Required event types:

```text
speech.asr.partial
speech.asr.final
speech.tts.chunk
speech.mark
```

Required schema principles:

- Payloads are small and canonical.
- No raw audio bytes/base64 in JSONL.
- Audio payloads must be artifact refs, file refs under session/artifact storage, or deterministic loopback refs.
- Labels and provenance remain on the event envelope.
- Stable ids / stream ids must let replay connect partial/final/tts/mark events.

Suggested payload shape:

```ts
speech.asr.partial.payload = {
  stream_id: string,
  segment_id: string,
  text: string,
  offset_ms: number,
  duration_ms?: number,
  language?: string,
  confidence?: number
}

speech.asr.final.payload = {
  stream_id: string,
  segment_id: string,
  text: string,
  offset_ms: number,
  duration_ms?: number,
  language?: string,
  confidence?: number,
  source_audio_ref?: string
}

speech.tts.chunk.payload = {
  stream_id: string,
  utterance_id: string,
  seq: number,
  text: string,
  audio_ref?: string,
  offset_ms?: number,
  duration_ms?: number
}

speech.mark.payload = {
  stream_id: string,
  mark: "asr-start" | "asr-end" | "tts-start" | "tts-end" | "turn-boundary" | "barge-in-placeholder",
  offset_ms?: number,
  utterance_id?: string,
  segment_id?: string,
  note?: string
}
```

The exact shape may differ if you find existing protocol conventions. Document any deviations in `tasks/M3-01-work.md`.

Acceptance:

- Protocol schema tests pass.
- Valid fixtures for all four event types.
- Invalid fixtures reject:
  - missing stream id;
  - negative offset;
  - base64/raw audio in payload;
  - unknown mark values.
- Registry remains additive and no unregistered speech event type appears.

### 2. Voice package / transport skeleton

Add a small voice package or module with deterministic loopback transport.

Suggested package:

```text
packages/voice
```

Required interfaces:

- `VoiceTransport`
  - accepts deterministic input frames or scripted transcript steps;
  - emits canonical speech events;
  - never calls a real microphone, speaker, network API, or provider in CI.

- `LoopbackVoiceTransport`
  - reads a scripted fixture of ASR partial/final and expected TTS chunks;
  - can attach to an existing session id or create a test session via normal gateway/CLI path;
  - emits `speech.asr.partial` and `speech.asr.final`;
  - forwards only `speech.asr.final` text into a normal user turn;
  - emits `speech.tts.chunk` from the assistant final text or deterministic fixture text;
  - emits `speech.mark` for start/end/turn-boundary markers.

Required behavior:

- ASR partials do not call the model.
- ASR final creates one normal user turn through existing TurnRunner/gateway path.
- TTS chunks are output events only; they never re-enter the prompt.
- No second TurnRunner.
- No separate "voice agent".
- No real ASR/TTS model/provider.
- No raw audio bytes in JSONL.

Acceptance:

- Unit tests for loopback event ordering and id stability.
- Unit tests that partials do not produce model calls.
- Unit tests that final transcript produces exactly one normal turn.
- Unit tests that TTS chunks are output-only.

### 3. Gateway / CLI loopback path

Expose a minimal developer-facing loopback path.

Choose one or both:

```powershell
pnpm fairy voice loopback --script <fixture.json> --json
```

or an internal gateway route used only by tests.

Required behavior:

- The loopback run writes a normal session JSONL with speech events and turn events.
- A final ASR transcript becomes a `turn.input` with speech provenance.
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
- JSON parse test.
- No real audio device access.
- No network access.
- Works on Windows and Linux CI.

### 4. Trust stack integration

Voice must inherit M2 trust rules.

Required behavior:

- ASR final transcripts carry labels and provenance.
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

- speech event schemas/fixtures validate;
- loopback ASR partial/final event ordering;
- ASR final enters normal TurnRunner path once;
- TTS chunks are generated as output-only events;
- replay renders speech events;
- voice transcript labels gate routing;
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

### 7. Config surface

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

- Extend existing config loader/schema validation.
- Defaults are safe and deterministic.
- Invalid values fail validation.
- Do not add real ASR/TTS provider config yet unless needed as inert placeholder.
- Do not wire `voice.fastpath`, cloud ASR, local ASR, cloud TTS, or local TTS in this slice.

Acceptance:

- Config tests for defaults, valid override, invalid values.
- No real API key support.
- No side-channel config.

### 8. Docs proposals only

Do not edit `docs-zh/`.

Default: do not edit `docs/` either unless Fable/Opus explicitly asks during gate. Put proposed docs edits in `tasks/M3-01-work.md`.

Propose docs edits for:

- `docs/specs/protocol.md`
  - speech event payload shapes;
  - replay visibility;
  - no raw audio payloads in JSONL.

- `docs/specs/model-gateway.md`
  - real ASR/TTS roles deferred; loopback transport is not a provider role.

- `docs/specs/data-governance.md`
  - ASR final transcripts and audio artifacts carry labels and gate routes.

- `docs/specs/evals.md`
  - register `voice.protocol-loopback-v0`;
  - mark latency/barge-in/ASR benchmarks as future M3 slices.

- New future spec if needed:
  - `docs/specs/voice-pipeline.md` proposal only; do not create unless reviewer asks.

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
   - speech payload schema shapes;
   - loopback transport interface;
   - how ASR final becomes turn input;
   - TTS chunk derivation;
   - label/provenance behavior;
   - replay rendering;
   - config shape.
4. Spec ambiguities.
   - Non-empty; at minimum explain whether speech schemas existed or were newly added, and why no real ASR/TTS provider is in M3-01.
5. Proposed docs edits.
6. Manual owner checklist with exact commands and evidence paths.
