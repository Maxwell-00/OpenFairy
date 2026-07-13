# M3-01 Work Report — Voice Protocol + Loopback

Status: implementation complete locally, pending owner push and GitHub Actions.

## File Tree Delta

- Added `packages/voice/`
  - `package.json`
  - `tsconfig.json`
  - `src/index.ts`
  - `test/index.test.ts`
- Added `apps/cli/src/voice.ts`
- Added `apps/cli/test/voice.test.ts`
- Added `packages/testing/test/voice.protocol-loopback.test.ts`
- Updated gateway loopback integration:
  - `apps/gateway/src/server.ts`
  - `apps/gateway/src/config.ts`
  - `apps/gateway/package.json`
- Updated CLI dispatch/exports/replay:
  - `apps/cli/src/bin/fairy.ts`
  - `apps/cli/src/index.ts`
  - `apps/cli/src/replay.ts`
  - `apps/cli/package.json`
  - `apps/cli/test/replay.test.ts`
- Updated config:
  - `packages/config/defaults.yaml`
  - `packages/config/src/schema.ts`
  - `packages/config/test/loader.test.ts`
- Updated testing workspace deps:
  - `packages/testing/package.json`
- Updated lockfile:
  - `pnpm-lock.yaml`

No `docs/` or `docs-zh/` files were edited.

## Verification

Targeted checks completed:

- `pnpm install` PASS
- `pnpm --filter @fairy/voice test` PASS
- `pnpm --filter @fairy/config test` PASS
- `pnpm --filter @fairy/testing exec vitest run test/voice.protocol-loopback.test.ts --reporter=verbose` PASS
- `pnpm --filter @fairy/cli exec vitest run test/voice.test.ts --reporter=verbose` PASS
- `pnpm --filter @fairy/gateway typecheck` PASS
- `pnpm --filter @fairy/cli typecheck` PASS
- `pnpm -r typecheck` PASS
- `pnpm lint` PASS

Full acceptance commands completed:

- `pnpm -r test` PASS
- `pnpm --filter @fairy/testing test -- --reporter=verbose` PASS
- `pnpm dep-check` PASS
- `pnpm conformance` PASS
- `git diff --check` PASS
- `git diff --name-only -- docs docs-zh` PASS, no output
- `git diff --name-only -- docs` PASS, no output
- `git diff --name-only -- docs-zh` PASS, no output

CI status: not pushed from this workspace; no GitHub Actions link yet.

## Named Suites

M2 named suites preserved by existing tests:

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

M3-01 added:

- `voice.protocol-loopback-v0`

Deferred/future, not fake-passed:

- voice latency bench
- interrupt quality / barge-in <= 250 ms
- ASR zh/en/mixed benchmark

## Decisions

Speech schema additions:

- None.
- The implementation conforms to the registered v1 schemas:
  - `speech.asr.partial.payload`: `utterance_id`, `text`
  - `speech.asr.final.payload`: `utterance_id`, `text`, `audio_ref`
  - `speech.tts.chunk.payload`: `chunk_id`, `text`, optional `audio_ref`
  - `speech.mark.payload`: `mark_id`, `position_ms`
- `mark_id` remains a free string. The loopback transport asserts only the conventional vocabulary at transport-test level.

Loopback transport:

- `@fairy/voice` is TS protocol/transport glue only.
- No provider interfaces, cloud APIs, device APIs, vendor SDKs, VAD, endpointing, or real audio transport were added.
- `LoopbackVoiceTransport` emits speech events around a single final transcript callback:
  - `speech.mark` `asr-start`
  - `speech.asr.partial`
  - `speech.asr.final`
  - `speech.mark` `asr-end`
  - one normal final-turn callback
  - `speech.mark` `tts-start`
  - `speech.tts.chunk`
  - `speech.mark` `tts-end`
  - `speech.mark` `turn-boundary`

ASR final to `turn.input`:

- Gateway op: `voice.loopback`.
- The gateway emits speech events, then submits exactly one normal `turn.input` through the existing `TurnRunner`.
- The `turn.input` envelope uses `provenance: "user"`.
- The payload uses `channel: "voice"` and additive `payload.speech: { utterance_id, audio_ref }`.
- The balanced voice floor adds `payload.routing_hints.prefer_local: true`.
- No second TurnRunner was added.

Labels/provenance:

- Balanced voice floor: `personal / region-restricted` plus `prefer_local`.
- Sovereign voice floor: `personal / local-only`.
- Cloud-friendly voice floor: `personal / global-ok`.
- Content escalation runs through the existing `escalateLabelsForContent`.
- Route clearance remains in the model gateway before provider I/O.
- Under-cleared primary zero-request behavior is covered by `voice.protocol-loopback-v0`.

TTS:

- TTS chunks derive only from `turn.final` visible text.
- Reasoning deltas, route-denial diagnostics, tool traces, and audit internals are not converted into TTS chunks.
- `speech.tts.chunk.payload.audio_ref` uses deterministic `loopback://tts/...` refs only; no raw audio/base64 is written.

Replay:

- `apps/cli/src/replay.ts` now renders:
  - `speech.asr.partial`
  - `speech.asr.final`
  - `speech.tts.chunk`
  - `speech.mark`
- `fairy replay --json` preserves full speech payloads.
- Existing corrupt-tail replay behavior was not weakened.

Config:

```yaml
voice:
  enabled: true
  transport: loopback
  loopback:
    tts_chunk_chars: 80
```

- `voice.transport` is schema-locked to `loopback`.
- `loopback.tts_chunk_chars` is a deterministic loopback-only test knob, not the future CJK-aware sentence chunker.
- No provider keys or real ASR/TTS config were added.

## Spec Ambiguities

- MemoryGate vs voice floor: the brief asks for a safe voice "remember" to produce `memory.written`, but the existing M2 MemoryGate holds all `personal` admission candidates by default. Since M3-01 also requires the voice label floor to be `personal`, a safe voice remember is held (`personal_default_hold`) rather than written. I preserved the M2 MemoryGate invariant and recorded this as a spec conflict instead of adding voice-specific admission behavior.
- `audio_ref` format remains informal across the repo. This implementation uses deterministic `loopback://audio/...` and `loopback://tts/...` refs, but does not narrow the schema.
- Loopback TTS chunking is char-count deterministic for tests only. It is intentionally not the ROADMAP sentence chunker.
- Real ASR/TTS provider roles are deferred because this slice is protocol/gateway/replay trust plumbing only.

## Proposed Docs Edits

### `docs/specs/protocol.md`

Add a speech events subsection:

- `speech.asr.partial` is an observability event for interim transcript text and requires `payload.utterance_id` and `payload.text`.
- `speech.asr.final` is the only ASR event eligible to become user input and requires `payload.utterance_id`, `payload.text`, and `payload.audio_ref`.
- `speech.tts.chunk` is output-only and requires `payload.chunk_id` and `payload.text`; `payload.audio_ref` is optional.
- `speech.mark` requires `payload.mark_id` and `payload.position_ms`.
- Conventional loopback mark IDs: `asr-start`, `asr-end`, `tts-start`, `tts-end`, `turn-boundary`, `barge-in-placeholder`.
- `mark_id` remains open-ended for future transports; do not enum-narrow v1.
- Binary audio frames are not JSONL events. Events reference audio by `audio_ref`.
- Voice-originated turn input uses `provenance: "user"`, `payload.channel: "voice"`, and optional `payload.speech.utterance_id` / `payload.speech.audio_ref`.
- Replay text mode renders speech events compactly; JSON mode preserves full payloads.

### `docs/specs/model-gateway.md`

- Clarify that M3-01 loopback is not a model role or provider.
- Real ASR/TTS model roles, including `voice.fastpath`, remain future M3 provider work.

### `docs/specs/data-governance.md`

- ASR final transcripts inherit the voice input label floor:
  - balanced: `personal / region-restricted(home)` with `prefer_local`
  - sovereign: `personal / local-only`
  - cloud-friendly: `personal / global-ok`
- Content escalation can raise labels but not lower them.
- Route clearance, MemoryGate, egress guard, redaction, and replay apply identically to voice-originated turns.

### `docs/specs/evals.md`

- Register PR-tier `voice.protocol-loopback-v0`.
- Explicitly mark the following as future M3 slices, not M3-01 passes:
  - voice latency bench
  - interrupt quality / barge-in <= 250 ms
  - ASR zh/en/mixed benchmark

### Proposed `docs/specs/voice-pipeline.md`

Title: Voice Pipeline

Scope:

- Defines canonical event flow for voice input/output.
- M3-01 covers loopback only.
- Real ASR, real TTS, VAD, endpointing, barge-in, latency benches, desktop tray, and provider conformance are later M3 slices.

Event flow:

1. Client/audio transport emits ASR observability events.
2. ASR partials remain observability-only and never call the model.
3. One ASR final transcript may be converted into a normal `turn.input`.
4. The normal TurnRunner/gateway path handles routing, context, tools, MemoryGate, egress, and final response.
5. TTS chunks are generated from visible assistant final text only.
6. TTS chunks are output-only and never re-enter prompts.
7. Replay renders the full event sequence from canonical JSONL.

Required canonical events:

- `speech.asr.partial`
- `speech.asr.final`
- `turn.input`
- existing TurnRunner events
- `speech.tts.chunk`
- `speech.mark`

Config registration:

```yaml
voice:
  enabled: true
  transport: loopback
  loopback:
    tts_chunk_chars: 80
```

Config semantics:

- `voice.enabled`: enables the inert voice feature surface.
- `voice.transport`: currently `loopback` only.
- `voice.loopback.tts_chunk_chars`: deterministic loopback chunk size for tests. It is not the final M3 sentence chunker.

Trust requirements:

- Voice input carries the data-governance voice floor before model routing.
- `prefer_local` is an advisory routing hint only.
- Under-cleared models receive zero request bytes.
- Egress guard blocks outbound tool arguments containing spoken secret content.
- TTS must not speak hidden reasoning, traces, audit internals, or raw route-denial secrets.
- No raw audio/base64 in JSONL.

Replay/debugger requirements:

- Text replay renders ASR partial/final, TTS chunks, and marks.
- JSON replay preserves full payloads.
- Corrupt-tail tolerance remains unchanged.

## Manual Owner Checklist

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M3-01 | Out-Null
```

Commands:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
pnpm fairy voice loopback --script <fixture.json> --json
pnpm fairy replay <sid> --data-dir <data-dir>
pnpm fairy replay <sid> --data-dir <data-dir> --json
pnpm fairy replay <sid> --data-dir <data-dir> --manifests
```

Evidence paths:

- `tasks/owner-checks/M3-01/testing-voice.txt`
- `tasks/owner-checks/M3-01/voice-loopback.json`
- `tasks/owner-checks/M3-01/voice-replay.txt`
- `tasks/owner-checks/M3-01/voice-replay.json`
- `tasks/owner-checks/M3-01/voice-manifests.txt`
- `tasks/owner-checks/M3-01/voice-governance.txt`
