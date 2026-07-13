# M3-03 Work Report — WebSocket Speech Transport Skeleton

Status: implementation complete locally; pending owner push/CI confirmation.

## File Tree Delta

- `packages/voice/src/index.ts`
  - Added deterministic WebSocket control/audio codecs.
  - Added `WebSocketVoiceDuplexTransport`, `startLocalVoiceWebSocketEndpoint`, `createWebSocketVoiceDuplexPair`, and `WebSocketVoiceTransport`.
- `packages/voice/test/index.test.ts`
  - Added codec, auth, local endpoint, malformed-frame, two-stream FIFO, and WebSocket transport tests.
- `packages/voice/package.json`
  - Added `ws` / `@types/ws`, reusing the same library already used by the gateway.
- `pnpm-lock.yaml`
  - Updated importer metadata from `pnpm install`.
- `apps/gateway/src/server.ts`
  - Added test/developer op `voice.ws`, still using `#submitVoiceFinalTranscript` -> `#acceptTurnInput`.
- `apps/cli/src/voice.ts`
  - Added `fairy voice ws --script ... --json`.
- `apps/cli/test/voice.test.ts`
  - Added CLI JSON smoke for `voice.ws`.
- `packages/testing/test/voice.websocket-transport.test.ts`
  - Added named suite `voice.websocket-transport-v0`.

No `docs/` or `docs-zh/` files were edited.

## Decisions

- **WebSocket codec shape:** text WebSocket messages carry existing M3-02 JSON control frames. Binary WebSocket messages carry a deterministic v0 conformance envelope: 4-byte big-endian unsigned JSON header length, UTF-8 JSON header `{stream_id, seq, final?}`, then raw audio bytes. This intentionally records the JSON-header envelope as the mock/local conformance shape; the compact `voice-pipeline.md` §2 "4-byte channel id + payload" framing remains reserved for the later real-audio/Opus slice where per-frame JSON header overhead matters.
- **Control/binary separation:** control frames are validated with the existing M3-02 control validator; audio payload bytes never enter JSON control frames, session JSONL, or replay.
- **Local WS adapter:** endpoint binds hard-coded `127.0.0.1`, ephemeral port only. There is no host/interface config or flag.
- **Auth:** local endpoint requires token via `Authorization: Bearer` or `?token=`. Missing/wrong token closes `4401`, no transport is accepted, and no frames are processed. `createWebSocketVoiceDuplexPair` uses an ephemeral generated token unless supplied.
- **Dependency:** reused `ws`; no second WebSocket library, no native dependency, no vendor SDK.
- **Deadlines/ports:** production local endpoint/open helpers and tests use explicit deadlines; tests bind port `0`; servers/sockets close in `finally`.
- **Mock worker reuse:** WebSocket path wraps `MockSpeechDuplexWorker`; no second ASR/TTS behavior stack was added.
- **Gateway/CLI path:** `voice.ws` is a developer/conformance op and CLI command. It uses the WebSocket adapter + mock worker and emits canonical speech events through normal session JSONL.
- **Single voice to turn path:** ASR final still enters exactly one normal user turn through `#submitVoiceFinalTranscript` -> `#acceptTurnInput`. ASR partials remain observability-only; TTS chunks remain output-only.
- **Cancellation:** ASR cancel before final emits `speech.mark` with `asr-cancelled`, no `turn.input`, no provider request, and replay remains clean.
- **Two-stream FIFO:** tests interleave two stream ids with three frames each and assert per-stream ordering and stream id preservation.
- **Labels/provenance:** frame labels remain advisory. Effective labels derive from profile floor plus one-way clamp plus content escalation. A frame claiming `public/global-ok` under balanced still emits `personal/region-restricted` and `prefer_local` on the voice-originated turn.
- **Replay:** WebSocket sessions use existing replay rendering because only canonical `speech.*` events are logged.
- **Config:** no new `voice.websocket.*` config was added.

## Named Suites

- Existing M2 suites remain visible in `@fairy/testing`:
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
- Existing M3 suites remain visible:
  - `voice.protocol-loopback-v0`
  - `voice.duplex-transport-v0`
- New M3 suite:
  - `voice.websocket-transport-v0`
- Deferred suites remain deferred, not fake-passed:
  - `memory.canary`
  - voice latency bench
  - interrupt quality / barge-in <= 250 ms
  - ASR zh/en/mixed benchmark
  - real ASR provider conformance
  - real TTS provider conformance
  - real desktop/tray client

## Verification

Local commands run:

- `pnpm install` — pass.
- `pnpm --filter @fairy/voice typecheck` — pass.
- `pnpm --filter @fairy/gateway typecheck` — pass.
- `pnpm --filter @fairy/cli typecheck` — pass.
- `pnpm --filter @fairy/testing typecheck` — pass.
- `pnpm --filter @fairy/voice test -- --reporter=verbose` — pass, 22 tests.
- `pnpm --filter @fairy/cli test -- --reporter=verbose` — pass, 17 tests.
- `pnpm --filter @fairy/testing test -- --reporter=verbose` — pass, 79 passed / 1 skipped.
- `pnpm lint` — pass.
- `pnpm -r typecheck` — pass.
- `pnpm -r test` — pass.
- `pnpm dep-check` — pass.
- `pnpm conformance` — pass, mock mode, 18/18 cases.
- `git diff --check` — pass.
- `git diff --name-only -- docs docs-zh` — pass, no output.

CI: not run from this environment; owner should push and confirm GitHub Actions green on ubuntu-latest and windows-latest.

## Spec Ambiguities

- `voice-pipeline.md` §2 names "4-byte channel id + payload" for real client/gateway binary audio. This slice uses a JSON-header binary envelope for deterministic local mock conformance. Proposed docs should explicitly reserve compact channel-id framing for the real-audio/Opus slice and describe JSON-header framing as v0 conformance-only.
- WebSocket transport frames are not canonical events. They are a worker/transport-plane frame family, not `packages/protocol/frames/` client op frames and not session JSONL.
- Loopback-only is enforced in code by binding `127.0.0.1` inside `startLocalVoiceWebSocketEndpoint`; no config or CLI flag can widen it.
- Real Python workers, ASR/TTS providers, VAD, endpointing, Lane A/B, ack bank, barge-in cascade, latency bench, ASR quality bench, and desktop client remain deferred because this task is only the local WebSocket skeleton and conformance adapter.

## Proposed Docs Edits

For `docs/specs/voice-pipeline.md`:

- Add M3-03 implementation status: local WebSocket transport adapter is live for deterministic conformance, using text JSON control frames and binary audio frames over loopback.
- Reconcile framing: v0 conformance binary messages use `uint32 header_len + JSON header + raw payload`; compact `4-byte channel id + payload` remains the future real-audio framing for 20 ms Opus streams.
- Add auth rule: local WS endpoint requires gateway token or ephemeral per-run token; missing/wrong token closes `4401`; endpoint binds `127.0.0.1` only.
- Add two-stream FIFO note: per-stream FIFO is test-gated over two interleaved streams.
- State real desktop client, Python workers, providers, VAD, barge-in, and latency/quality benches remain future.

For `docs/specs/protocol.md`:

- Add M3-03 note that WebSocket transport frames remain outside canonical events and outside session JSONL.
- Reaffirm binary audio bytes never enter JSONL/base64; canonical replay surface remains `speech.asr.partial`, `speech.asr.final`, `speech.tts.chunk`, and `speech.mark`.

For `docs/specs/evals.md`:

- Register `voice.websocket-transport-v0` as a deterministic PR-tier suite.
- Keep latency, barge-in, ASR quality, real provider, and desktop/tray suites deferred.

For `docs/specs/data-governance.md`:

- Add M3-03 note that WebSocket-produced ASR final inherits the same voice floor, clamp, route clearance, MemoryGate, egress, redaction, and replay rules as loopback/duplex.

For `docs/specs/model-gateway.md`:

- Note that the WebSocket mock worker is a conformance worker, not `voice.fastpath`, not a provider role, and not a vendor ASR/TTS integration.

## Manual Owner Checklist

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M3-03 | Out-Null
```

Run and save:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose *> tasks/owner-checks/M3-03/testing-voice-websocket.txt
pnpm --filter @fairy/testing test -- --reporter=verbose -t "voice.websocket-transport-v0" *> tasks/owner-checks/M3-03/voice-websocket-focused.txt
pnpm --filter @fairy/voice test -- --reporter=verbose *> tasks/owner-checks/M3-03/voice-package.txt
pnpm --filter @fairy/cli test -- --reporter=verbose *> tasks/owner-checks/M3-03/cli-voice-websocket.txt
```

Optional CLI smoke can be run against a local gateway:

```powershell
pnpm fairy voice ws --script <fixture.json> --json
```

Expected evidence:

- `voice.websocket-transport-v0`, `voice.duplex-transport-v0`, and `voice.protocol-loopback-v0` visible and green.
- JSON output parseable with session id, frame counts, speech event counts, model request count, transcript, TTS chunks, cancel status, and replay/log path.
- Exactly one normal `turn.input` for non-cancelled ASR final.
- Cancel case has no `turn.input` and no provider request.
- No raw audio/base64 and no `voice.ws.*`, `voice.frame.*`, or `speech.worker.*` event types in JSONL.
- GitHub Actions green on ubuntu-latest and windows-latest.
