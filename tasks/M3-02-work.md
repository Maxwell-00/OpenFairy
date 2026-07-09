# M3-02 Work Report — Duplex Speech Transport Protocol + Conformance

Status: implementation complete locally; pending owner push and GitHub Actions.

## File Tree Delta

Added:

- `packages/voice/fixtures/voice-control.valid.json`
- `packages/voice/fixtures/voice-control.invalid.json`
- `packages/testing/test/voice.duplex-transport.test.ts`
- `tasks/M3-02-work.md`

Updated:

- `packages/voice/src/index.ts`
- `packages/voice/test/index.test.ts`
- `apps/gateway/src/server.ts`
- `apps/cli/src/voice.ts`
- `apps/cli/test/voice.test.ts`

No `docs/` or `docs-zh/` edits were made.

## Verification

Completed:

- `pnpm install` PASS
- `pnpm lint` PASS
- `pnpm -r typecheck` PASS
- `pnpm -r test` PASS
- `pnpm --filter @fairy/testing test -- --reporter=verbose` PASS
- `pnpm dep-check` PASS
- `pnpm conformance` PASS
- `git diff --check` PASS
- `git diff --name-only -- docs docs-zh` PASS, no output
- `pnpm --filter @fairy/voice test` PASS
- `pnpm --filter @fairy/gateway typecheck` PASS
- `pnpm --filter @fairy/cli typecheck` PASS
- `pnpm --filter @fairy/testing typecheck` PASS
- `pnpm --filter @fairy/testing exec vitest run test/voice.duplex-transport.test.ts --reporter=verbose` PASS
- `pnpm --filter @fairy/cli exec vitest run test/voice.test.ts --reporter=verbose` PASS

CI status: not pushed from this workspace; no GitHub Actions link yet.

## Named Suites

M2 suites expected to remain visible:

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

M3 suites:

- `voice.protocol-loopback-v0`
- `voice.duplex-transport-v0`

Deferred/future, not fake-passed:

- voice latency bench
- interrupt quality / barge-in <= 250 ms
- ASR zh/en/mixed benchmark
- real ASR provider conformance
- real TTS provider conformance

## Decisions

Frame protocol:

- Implemented `VoiceControlFrame` in `@fairy/voice`, deliberately outside the canonical event registry and outside `packages/protocol/frames`.
- Final v0 control kinds:
  - `session.start`
  - `utterance.start`
  - `asr.partial`
  - `asr.final`
  - `tts.request`
  - `tts.chunk`
  - `mark`
  - `cancel`
  - `error`
  - `session.end`
- The M0 voice-pipeline names map as:
  - `start` -> `session.start` + `utterance.start`
  - `partial` -> `asr.partial`
  - `final` -> `asr.final`
  - `synthesize` -> `tts.request`
  - `cancel` -> `cancel`
  - `mark` -> `mark`
- `encodeVoiceControlFrame` uses stable sorted JSON. `decodeVoiceControlFrame` and `validateVoiceControlFrame` fail closed.
- Golden valid and invalid fixtures live in `packages/voice/fixtures/`.

Control/binary separation:

- Control frames are JSON objects.
- `VoiceAudioFrame` is in-memory only and carries `Uint8Array` data.
- `voiceAudioFrameMetadata` exposes `byte_length`, `stream_id`, `sequence`, and `final`, never bytes/base64.
- No duplex transport frame is appended to session JSONL.
- Canonical JSONL remains limited to existing speech events: `speech.asr.partial`, `speech.asr.final`, `speech.tts.chunk`, `speech.mark`.

In-memory transport:

- `InMemoryVoiceDuplexTransport` implements paired endpoints via `createVoiceDuplexPair`.
- Control frames deliver FIFO.
- Audio frames deliver FIFO per stream.
- Closed endpoints reject sends.
- Queue overflow is deterministic via `maxQueueFrames` guard.
- Audio max size defaults to 65,536 bytes through `defaultVoiceMaxFrameBytes`.
- No socket, device, microphone, speaker, network, or timer dependency is used by the transport.

Mock worker:

- `MockSpeechDuplexWorker` consumes `utterance.start` plus synthetic audio frames.
- ASR partials are emitted from script data; ASR final is emitted only after a final audio frame.
- `tts.request` emits deterministic `tts.chunk` and `mark` frames.
- ASR cancel before final suppresses `asr.final`.
- TTS cancel suppresses pending chunks.
- Worker error frames use generic redacted messages and do not include content-derived text.
- No model/provider calls, vendor SDKs, Python worker, socket, VAD, or endpointing were added.

Gateway/CLI conformance path:

- Added gateway op `voice.duplex`.
- Added CLI path `fairy voice duplex --script <fixture.json> --json`.
- The duplex path uses the in-memory transport and mock worker, then emits the same canonical speech events through session JSONL.
- ASR partials remain observability-only.
- Only `asr.final` can enter a normal user turn.
- TTS chunks remain output-only and do not re-enter prompts.

Single voice-to-turn construction:

- Refactored gateway voice turn submission into `#submitVoiceFinalTranscript`.
- Both `voice.loopback` and `voice.duplex` call that helper.
- The helper is the single production construction site for voice-originated `turn.input` payloads:
  - envelope provenance remains `user`;
  - payload channel remains `voice`;
  - payload carries additive `speech: { utterance_id, audio_ref }`;
  - `routing_hints.prefer_local` is preserved when present.

Cancellation:

- ASR cancellation is protocol-only in this slice.
- A cancelled ASR utterance emits `speech.mark` with `mark_id: "asr-cancelled"`.
- It emits no `turn.input`, starts no TurnRunner turn, makes zero provider requests, and remains replayable.
- No barge-in latency or quality claim is made.

Label clamp:

- Frame labels are advisory metadata only.
- Effective labels are derived from the governance profile voice floor plus optional stricter advisory labels, then content escalation.
- A frame claiming `public / global-ok` under the balanced profile still produces emitted `speech.asr.final` and `turn.input` labels of `personal / region-restricted` with `routing_hints.prefer_local`.
- A stricter frame label can raise above the floor but cannot lower it.
- Spoken safe remember remains held by MemoryGate as `personal_default_hold`; voice does not bypass MemoryGate.

Replay:

- No replay renderer special case was required beyond M3-01 speech rendering.
- Duplex-produced sessions render through existing `fairy replay`.
- JSON replay preserves speech payloads.
- `--manifests` remains compatible.
- Tests assert no `voice.frame.*` or `speech.worker.*` event type appears in JSONL.

Config:

- No new config keys were added.
- `voice.duplex.*` is intentionally absent, so nothing rides the existing `voice` schema `additionalProperties: true`.
- The duplex conformance path reuses existing `voice.enabled`, `voice.transport: loopback`, and `voice.loopback.tts_chunk_chars` only as deterministic test/runtime knobs.
- No provider keys, endpoints, env side channels, or real ASR/TTS config were added.

## Spec Ambiguities

- Internal duplex frames vs canonical events: duplex frames are a worker-plane transport contract, not runtime facts. They are validated and fixture-tested in `packages/voice`, but they are not registered canonical events and are never written to JSONL.
- Existing voice-pipeline §2 used short names (`start`, `partial`, `final`, `synthesize`, `cancel`, `mark`). M3-02 uses more explicit v0 `kind` names; the proposed docs include a mapping table to avoid two active vocabularies.
- The current gateway/client E2E still uses the existing local test WebSocket and mock HTTP model servers. M3-02 does not implement speech transport sockets or networked speech workers; the duplex transport itself remains in-memory.
- Cancellation is cleanup/ordering only. It is not barge-in, no VAD is involved, and no <=250 ms interrupt claim is made.
- Worker error redaction is generic because the mock worker does not need to include content-derived text in errors. Future real adapters should call the established governance redaction helpers at the edge.

## Proposed Docs Edits

### `docs/specs/voice-pipeline.md`

- Add M3-02 implementation status:
  - `@fairy/voice` now defines internal duplex frame protocol v0 and in-memory conformance transport.
  - The protocol is gateway-to-worker-plane only, not canonical JSONL and not client op frames.
  - Real WebSocket, Python workers, ASR/TTS providers, VAD, endpointing, Lane A/B, ack bank, and barge-in cascade remain future M3 slices.
- Add frame vocabulary mapping:
  - spec `start` -> implemented `session.start` and `utterance.start`
  - spec `partial` -> implemented `asr.partial`
  - spec `final` -> implemented `asr.final`
  - spec `synthesize` -> implemented `tts.request`
  - spec `cancel` -> implemented `cancel`
  - spec `mark` -> implemented `mark`
- Document `tts.chunk`, `error`, and `session.end` as M3-02 v0 additions to the worker-plane frame contract.
- State cancellation is protocol-level cleanup only, not the interrupt-quality benchmark.
- Register that no `voice.duplex.*` config keys exist in M3-02.

### `docs/specs/protocol.md`

- Clarify that voice duplex frames are a third frame family:
  - outside runtime canonical event registry;
  - outside client op-frame schemas in `packages/protocol/frames`;
  - tested in `packages/voice/fixtures`.
- Reaffirm no raw audio/base64 in JSONL.
- Reaffirm replay surface remains canonical speech events only.

### `docs/specs/evals.md`

- Register deterministic PR-tier suite `voice.duplex-transport-v0`.
- Keep future/deferred:
  - voice latency bench;
  - interrupt quality / barge-in <= 250 ms;
  - ASR zh/en/mixed benchmark;
  - real ASR provider conformance;
  - real TTS provider conformance.

### `docs/specs/data-governance.md`

- Add duplex path to the existing voice floor note:
  - frame labels are advisory;
  - gateway-side voice floor is authoritative;
  - stricter frame labels can raise but never lower;
  - route clearance, MemoryGate, egress guard, replay, and TTS visibility boundary are inherited.

### `docs/specs/model-gateway.md`

- State `MockSpeechDuplexWorker` is not `voice.fastpath`, not a provider role, and not a real ASR/TTS adapter.
- Real speech providers remain future worker/adaptor work.

## Manual Owner Checklist

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M3-02 | Out-Null
```

Voice duplex suite:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Save:

```text
tasks/owner-checks/M3-02/testing-voice-duplex.txt
```

Focused duplex suite:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose -t "voice.duplex-transport-v0"
```

Save:

```text
tasks/owner-checks/M3-02/voice-duplex-focused.txt
```

CLI conformance smoke:

```powershell
pnpm fairy voice duplex --script <fixture.json> --json
```

Expected:

- parseable JSON;
- `sid`;
- `frame_counts`;
- `event_counts`;
- `model_request_count`;
- exactly one normal turn for non-cancelled ASR final;
- no raw audio/base64;
- no real speech provider/device/network transport.

Save:

```text
tasks/owner-checks/M3-02/voice-duplex-cli.json
```

Replay smoke:

```powershell
pnpm fairy replay <sid> --data-dir <data-dir>
pnpm fairy replay <sid> --data-dir <data-dir> --json
pnpm fairy replay <sid> --data-dir <data-dir> --manifests
```

Save:

```text
tasks/owner-checks/M3-02/voice-duplex-replay.txt
tasks/owner-checks/M3-02/voice-duplex-replay.json
tasks/owner-checks/M3-02/voice-duplex-manifests.txt
```
