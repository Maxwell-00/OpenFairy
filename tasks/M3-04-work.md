# M3-04 Work Report - Speech worker process scaffold + Python mock conformance

Date: 2026-07-10

Starting revision: `db0556f` (required gate matched; working tree was clean)

## 1. File tree delta

```text
apps/
  cli/
    src/voice.ts                              modified - `voice worker` CLI subcommand
    test/voice.test.ts                        modified - worker CLI JSON/evidence and command-injection guards
  gateway/
    src/index.ts                              modified - gateway supervisor exports
    src/server.ts                             modified - `voice.worker` composition and canonical event bridge
    src/speech-worker-process.ts              new - gateway-owned process supervisor + NDJSON codec
packages/
  testing/
    test/voice.worker-process.test.ts         new - `voice.worker-process-v0`
workers/
  speech/
    README.md                                 new - mock-worker scope and launch contract
    mock_worker.py                            new - ASCII-only, stdlib-only deterministic worker
    fixtures/
      voice-worker-script.json                new - owner/CLI smoke fixture
      wire.invalid.json                       new - invalid wire golden cases
      wire.valid.json                         new - valid wire golden cases
tasks/
  M3-04-work.md                               new - this report
```

No dependency, lockfile, config-schema, protocol-schema, English `docs/`, or `docs-zh/` file changed. `packages/voice/src/index.ts` and the protected source-scan assertion in `packages/voice/test/index.test.ts` are unchanged.

## 2. Implementation summary

### Python worker

`workers/speech/mock_worker.py` is a deterministic child process. It:

- imports only `json`, `os`, `re`, `sys`, and `time` from the Python standard library;
- reads UTF-8 NDJSON from `sys.stdin.buffer`;
- writes every protocol message with `sys.stdout.buffer.write(encoded_message + b"\n")` and immediately flushes;
- implements `hello`/`ready`, scripted ASR/TTS, cancellation, errors, `shutdown`/`bye`, and deterministic failure modes used by conformance tests;
- rejects raw audio/data URLs/base64 on the control wire;
- redacts its own stderr diagnostics before writing them;
- opens no socket, device, file, network client, or subprocess;
- runs with `-u -B`, a temp-directory cwd, and `PYTHONDONTWRITEBYTECODE=1`, so it creates no repository artifacts.

The Python source is ASCII-only. There is intentionally no `pyproject.toml`, lockfile, pip dependency, uv environment, or vendor package in this slice because the gated task is standard-library-only.

### Gateway supervisor

`apps/gateway/src/speech-worker-process.ts` owns all child-process code. The protected voice package remains process-agnostic.

The supervisor provides:

- fixed production discovery candidates: `python3`, then `python`, then Windows-only `py -3`;
- a narrowly gated `FAIRY_TEST_PYTHON` override only when `NODE_ENV=test` or `CI=true`; the exact value is used only as `argv[0]`, never split or interpreted by a shell;
- `spawn(argv0, args, { shell: false, ... })` for probes and the worker;
- repository-controlled worker path resolution; no CLI/config worker path or command surface;
- explicit discovery, process-start, ready-handshake, request, cancellation, stdin-write, termination, and shutdown deadlines;
- concurrent stdout and stderr draining from process start;
- CRLF-tolerant NDJSON decode (one trailing `\r` is removed before parsing);
- full runtime validation in both directions, exact-field validation, stable one-line encoding, raw-audio/base64 rejection, stable request correlation, bounded pending requests, bounded stdout queue/line size, and bounded stderr capture;
- gateway governance redaction on all surfaced diagnostics;
- direct-child termination on malformed output, crash, timeout, cancellation failure, startup failure, and shutdown failure;
- shutdown-race handling that waits for or forcibly terminates the actual child and leaves no orphan.

Local evidence captured through the real supervisor:

```json
{"capabilities":["asr.script","tts.script","cancel","shutdown"],"interpreter":{"args":[],"argv0":"python","source":"discovered","version":"3.13.9"},"processId":31164,"pythonVersion":"3.13.9","workerId":"speech-mock-v0"}
{"alive":false}
```

The PID is run-specific. The selected interpreter/version on this Windows workstation was `python` / Python `3.13.9`.

### Gateway/CLI worker path

The gateway accepts authenticated client op `voice.worker`. It creates one supervised worker for the operation, translates only validated worker results into existing canonical speech events, and always shuts the child down before returning the ack.

The path is:

```text
Python asr.final
  -> speech.asr.final
  -> #submitVoiceFinalTranscript
  -> #acceptTurnInput
  -> existing TurnRunner
  -> visible turn.final text only
  -> Python tts.script
  -> speech.tts.chunk
```

ASR partials are observability-only. They never call `#submitVoiceFinalTranscript` or the model. TTS chunks are output-only and never re-enter history or prompt assembly. There is no second `turn.input` builder and no second TurnRunner.

Developer/owner command:

```powershell
pnpm fairy voice worker --script workers/speech/fixtures/voice-worker-script.json --json
```

The JSON ack contains session id, worker id/PID, request ids, event counts, model request count, transcript, TTS chunk count, cancel/error status, log/replay path, all deadline values, and selected interpreter/version evidence. No worker path, Python command, shell string, raw audio, or base64 can be supplied through the CLI.

## 3. Verification

All required local commands were run from `E:\Claude_Projects\Projects\Fairy\OpenFairy`.

### Required commands

| Command | Result | Decisive tail/evidence |
|---|---|---|
| `pnpm install` | PASS | `Scope: all 15 workspace projects` / `Already up to date` / pnpm `11.7.0` |
| `pnpm lint` | PASS | `Encoding guard passed (236 files scanned)`; ESLint exited 0 |
| `pnpm -r typecheck` | PASS | 14 of 15 workspace projects; gateway, testing, CLI, voice, kernel, protocol, and all other typed packages `Done` |
| `pnpm -r test` | PASS | `packages/testing`: 83 passed / 1 skipped; `apps/cli`: 19 passed; `packages/voice`: 22 passed; `packages/protocol`: 108 passed; all runnable workspace package suites green |
| `pnpm --filter @fairy/testing test -- --reporter=verbose` | PASS | 12 files passed / 1 skipped; 83 tests passed / 1 skipped; all four M3 named suites visible |
| `pnpm dep-check` | PASS | `no dependency violations found (107 modules, 366 dependencies cruised)` |
| `pnpm conformance` | PASS | mock mode; 18 cases PASS; JSON verdict `"ok":true` |
| `git diff --check` | PASS | no output (run after this report's final formatting pass) |
| `git diff --name-only -- docs docs-zh` | PASS | no output |

Additional focused verification:

- `pnpm --filter @fairy/testing exec vitest run test/voice.worker-process.test.ts --reporter=verbose`: 4/4 passed.
- `pnpm --filter @fairy/voice test -- --reporter=verbose`: 22/22 passed; protected loopback/duplex/WebSocket behavior and source guard remain green.
- `pnpm --filter @fairy/cli test -- --reporter=verbose`: 19/19 passed, including parseable worker JSON and no-arbitrary-worker-command checks.
- Direct supervisor evidence reported Python `3.13.9`, worker `speech-mock-v0`, then `alive:false` after shutdown.
- The worker-process suite asserts ASCII-only Python, stdlib import allowlist, `-u`, binary stdout + per-message flush, CRLF decode, concurrent stdout/stderr drains, `shell:false`, single test-only env read, no repo-tree writes, and no `node:child_process` in `packages/voice/src/index.ts`.

GitHub Actions was not run from this uncommitted working tree and is not claimed green. The owner must commit/push and inspect the Ubuntu + Windows matrix.

### Named suite list

New and green:

- `voice.worker-process-v0`

Existing M3 suites visible and green:

- `voice.websocket-transport-v0`
- `voice.duplex-transport-v0`
- `voice.protocol-loopback-v0`

Existing M2 suites visible and green:

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

`memory.canary` remains visibly skipped/deferred. Voice latency, interrupt/barge-in, ASR quality, real ASR provider, real TTS provider, and desktop/tray suites remain deferred and were not fake-passed.

## 4. Decisions

### Worker directory/package shape

The worker is a plain stdlib script plus fixtures and README under `workers/speech/`. No Python package manager metadata was added because there are no dependencies to resolve. This avoids generating environments, locks, caches, or repository artifacts for a deterministic scaffold.

### Python interpreter discovery

Production discovery is a fixed ordered list with a bounded share of the 5-second discovery deadline:

1. `python3`
2. `python`
3. `py -3` on Windows only

Each candidate is probed with fixed arguments, `shell:false`, concurrent stdout/stderr drains, bounded capture, and cleanup on timeout. Failure returns named `SPEECH_WORKER_*` errors with the attempted fixed candidates.

`FAIRY_TEST_PYTHON` is test-only (`NODE_ENV=test` or `CI=true`), captured once in the constructor, and used only as literal `argv[0]`. It is never split, parsed, appended as a command string, or exposed as production config. The source and CLI tests assert that `--python`, `--worker-command`, and `--worker-path` are rejected.

### Selected interpreter/version evidence

This workstation selected:

```text
argv[0]: python
Python: 3.13.9
source: discovered
```

The ready handshake independently reports the same version; a mismatch fails closed. CLI JSON exposes `interpreter`, `python_version`, `worker_id`, and `worker_process_id`.

### Stdio wire protocol

Protocol id: `fairy.speech-worker.v0`.

The control wire is UTF-8 NDJSON only. It carries synthetic `audio_ref` values, never audio bytes/base64. Every message has exact runtime validation in TypeScript; Python validates the minimum required fields before acting. Stable request ids correlate ASR, TTS, and cancellation. Unknown/malformed/uncorrelated/oversized/flooded messages terminate the worker path without creating a turn.

Final message kinds:

```text
hello, ready
asr.script, asr.partial, asr.final
tts.script, tts.chunk, tts.done
cancel, cancelled
error
shutdown, bye
```

`asr.script`, `tts.script`, and their deterministic failure knobs are mock-conformance-only.

### Supervisor placement

All `node:child_process` code lives in `apps/gateway/src/speech-worker-process.ts`. The gateway is the composition root and child-process owner. `packages/voice/src/index.ts` is unchanged and still contains no `node:child_process`; its existing source-scan test is byte-identical.

### Lifecycle/deadline behavior

Default explicit deadlines:

```text
interpreter discovery: 5000 ms total
process startup:        3000 ms
ready handshake:        5000 ms
each ASR/TTS request:  10000 ms
cancellation:           2000 ms
shutdown:               3000 ms
```

Stdin writes use the relevant operation deadline. Termination has its own bounded graceful/forced phases. Captured stderr is capped at 8192 bytes, stdout lines at 262144 bytes, queued stdout messages at 64, and pending requests at 16.

### Cancel/crash/timeout semantics

- Cancel before ASR final: worker returns `cancelled`; gateway emits existing `speech.mark` `asr-cancelled`; no `speech.asr.final`, `turn.input`, or model request.
- Crash before ASR final: the Python worker self-exits (and a unit path also directly kills the actual child); pending work rejects; gateway emits existing `progress.update` with `stage: "voice.worker.failed"`; no canonical worker event is added.
- Malformed output: TypeScript decode fails closed, terminates the actual worker, and emits the same safe progress stage.
- Request/startup timeout: supervisor kills the child, waits for exit, returns a named error, and leaves no turn or process behind.
- Shutdown: `shutdown` -> `bye` -> process exit; deadline breach forces direct-child termination.

Every failure test verifies the PID is gone and the session remains replayable.

### Gateway/CLI worker path

The gateway op is `voice.worker`; CLI is `fairy voice worker`. It is a deterministic developer/conformance surface, not a provider binding. One operation owns one worker process, which is shut down before the ack is sent. Gateway shutdown also terminates and awaits active workers.

### Label/provenance behavior

Wire labels are advisory. Gateway policy applies:

```text
profile voice floor
  -> clampVoiceFrameLabels (raise only)
  -> escalateLabelsForContent (raise only)
  -> existing route/MemoryGate/egress enforcement
```

Canonical ASR and turn events retain existing `provenance: "user"`; TTS remains `provenance: "agent"`. Balanced-profile `public/global-ok` advisory labels still emit `personal/region-restricted` plus `prefer_local`. Secret escalation denies the under-cleared primary with zero new provider requests and completes on a cleared local fallback.

### Replay behavior

Only existing `speech.*`, turn, governance, tool, memory, and progress events reach JSONL. Wire kinds and process lifecycle messages never do. Failure visibility uses the existing `progress.update` type with stage string `voice.worker.failed`. Cancel/crash/malformed/timeout logs contain no `turn.input`, replay without a dangling turn, and contain no worker-wire message types.

### Config decision

No config surface was added. The worker path and interpreter candidates are code-controlled. There is no `voice.worker.*` schema, command string, provider endpoint, host, API key, or external-network setting.

## 5. Spec ambiguities and reconciliations

1. **Local stdio vs. voice-pipeline local WebSocket.** `voice-pipeline.md` section 2 currently says gateway-to-worker uses local WS. A stdlib-only supervised Python child cannot reasonably use WS without a dependency or hand-rolled RFC 6455 client. This slice therefore uses stdio NDJSON for a locally supervised direct child. The local authenticated WebSocket transport from M3-03 remains the correct future boundary for remote/decoupled workers (including the section 9 remote GPU box); stdio does not replace it.
2. **Wire messages vs. the M3 duplex frame family.** The NDJSON objects carry equivalent coordinator semantics but are a process wire, not `VoiceControlFrame`, not client op frames, and not canonical envelopes. They must remain outside `packages/protocol`, the event registry, and JSONL.
3. **Mock script requests vs. a real worker contract.** `asr.script` and `tts.script` exist only to make behavior deterministic without audio/providers. A real ASR worker receives audio frames; a real TTS worker receives a synthesize/`tts.request` operation. The mock names must not be promoted unchanged into the real-provider contract.
4. **Completion receipts.** `tts.done` and `cancelled` make request/cancel deadlines and correlation deterministic over stdio. They map to existing mark/completion semantics and are not canonical event types.
5. **Python availability.** CI/dev must provide one fixed candidate. Missing Python is an actionable named error, not a silent skip. `FAIRY_TEST_PYTHON` only selects a literal test `argv[0]` and is surfaced in evidence; it is not production configuration.
6. **Worker failure visibility.** The protocol registry has no worker lifecycle type and none was added. `progress.update {stage: "voice.worker.failed"}` is the replayable existing surface, analogous to `egress.denied` as a stage string.
7. **Real providers remain deferred.** Binding cloud/local ASR/TTS would introduce audio egress, keys, billing, provider clearance, acoustic behavior, and vendor conformance. Those require their own gated slice and are deliberately absent here.

## 6. Proposed English documentation edits (reviewer-owned)

No English docs were edited in this delivery. Proposed edits follow.

### `docs/specs/voice-pipeline.md`

- Add M3-04 implementation status: deterministic Python stdlib mock worker, gateway-owned supervisor, stdio NDJSON v0, lifecycle deadlines, cleanup/redaction, and `voice.worker-process-v0`.
- Reconcile section 2 explicitly:
  - stdio NDJSON is the v0 wire for a gateway-supervised local child;
  - authenticated local WebSocket remains the transport for remote/decoupled workers and remote GPU boxes;
  - the real-audio/provider contract remains future work.
- State that `asr.script` and `tts.script` are mock-conformance-only.
- Record deadline/bounded-buffer requirements and no-orphan behavior.

Proposed wire-to-M3-duplex mapping:

| Stdio wire kind | Direction | Closest M3-02 `VoiceControlFrame` semantic | Status |
|---|---|---|---|
| `hello` | gateway -> child | `session.start` precondition / protocol negotiation | durable lifecycle wire |
| `ready` | child -> gateway | session-ready health response (no exact M3-02 frame) | durable lifecycle wire |
| `asr.script` | gateway -> child | `utterance.start` + synthetic replacement for audio frames | **mock-conformance-only**; real worker receives audio frames |
| `asr.partial` | child -> gateway | `asr.partial` | durable semantic |
| `asr.final` | child -> gateway | `asr.final` | durable semantic |
| `tts.script` | gateway -> child | `tts.request` | **mock-conformance-only name/shape**; real contract is synthesize/`tts.request` |
| `tts.chunk` | child -> gateway | `tts.chunk` | durable semantic |
| `tts.done` | child -> gateway | `mark(tts-end)` + `mark(turn-boundary)` completion | durable request-completion receipt; not canonical |
| `cancel` | gateway -> child | `cancel` | durable semantic |
| `cancelled` | child -> gateway | cancellation receipt / `mark(asr-cancelled|tts-cancelled)` | durable receipt; not canonical |
| `error` | child -> gateway | `error` control frame | durable semantic; diagnostics redacted |
| `shutdown` | gateway -> child | `session.end` request | durable lifecycle wire |
| `bye` | child -> gateway | `session.end` acknowledgement | durable lifecycle wire |

### `docs/specs/protocol.md`

- Extend the section 7 third-frame-family note: supervised child stdio messages are another encoding of the worker plane, never runtime events or JSONL.
- Keep the canonical replay surface exactly `speech.asr.partial`, `speech.asr.final`, `speech.tts.chunk`, and `speech.mark`; worker failure uses existing `progress.update` stage `voice.worker.failed`.
- State that wire request ids, ready/bye, `tts.done`, and cancellation receipts are transport facts only.

### `docs/specs/evals.md`

- Register `voice.worker-process-v0` as a deterministic PR-tier suite: Python/version handshake, wire goldens, stdio/CRLF/flush/drain rules, ASR/TTS scripts, lifecycle/deadlines, cancel/crash/malformed/timeout cleanup, one TurnRunner path, trust inheritance, diagnostics redaction, CLI JSON, and no raw audio/provider/device/network/pip access.
- Keep latency, interrupt/barge-in, ASR quality, real provider, and desktop suites explicitly deferred.

### `docs/specs/data-governance.md`

- Add that the supervised worker process is controlled ingress under the gateway, and its labels remain advisory under the same raise-only clamp.
- State that worker stdout protocol errors and bounded stderr are untrusted diagnostics and must be redacted before events/acks/logging.
- Reaffirm that route clearance, MemoryGate, egress guard, TTS visibility, and replay apply unchanged to worker-backed voice.

### `docs/specs/model-gateway.md`

- Add M3-04 note: the Python scripted mock worker is not `voice.fastpath`, `speech.asr`, `speech.tts`, or any provider role.
- Real ASR/TTS binding remains a later M3 slice and must carry cloud-speech data-clearance/audio-egress rules and provider conformance.

## 7. Detailed manual owner checklist

Run after committing/pushing and after GitHub Actions is green on both Ubuntu and Windows. Store evidence only under `tasks/owner-checks/M3-04/`.

### A. Create evidence directory

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M3-04 | Out-Null
```

### B. Full named-suite evidence

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose *> tasks/owner-checks/M3-04/testing-voice-worker.txt
```

Confirm in the saved output:

```powershell
Select-String -Path tasks/owner-checks/M3-04/testing-voice-worker.txt -Pattern @(
  'voice.worker-process-v0',
  'voice.websocket-transport-v0',
  'voice.duplex-transport-v0',
  'voice.protocol-loopback-v0',
  '83 passed',
  '1 skipped'
)
```

Expected: all four M3 suites visible and green; M2 suites green; `memory.canary` visibly skipped; future acoustic/provider/latency suites not reported as PASS.

### C. Focused worker suite

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose -t "voice.worker-process-v0" *> tasks/owner-checks/M3-04/voice-worker-focused.txt
```

Expected: four tests pass, covering wire/handshake/version, normal TurnRunner path, cancel/crash/malformed/timeout/replay, and trust-stack inheritance.

### D. Voice and CLI packages

```powershell
pnpm --filter @fairy/voice test -- --reporter=verbose *> tasks/owner-checks/M3-04/voice-package.txt
pnpm --filter @fairy/cli test -- --reporter=verbose *> tasks/owner-checks/M3-04/cli-voice-worker.txt
```

Expected: voice 22/22 and CLI 19/19. Confirm corrupt-tail replay remains green and the worker CLI test reports interpreter evidence.

### E. Static worker/supervisor safety checks

```powershell
node -e "const fs=require('fs');const s=fs.readFileSync('workers/speech/mock_worker.py','utf8');if([...s].some(c=>c.charCodeAt(0)>127))process.exit(1);console.log('ASCII-only PASS')" *> tasks/owner-checks/M3-04/python-ascii.txt
$forbidden = rg -n "^(from|import) (socket|subprocess|requests|urllib|pyaudio|sounddevice)" workers/speech/mock_worker.py
$forbidden | Set-Content -Encoding utf8 tasks/owner-checks/M3-04/python-forbidden-imports.txt
if ($forbidden) { throw "Forbidden Python import found" }
rg -n "sys\.stdout\.buffer\.write|sys\.stdout\.buffer\.flush|shell: false|line\.endsWith\(\"\\r\"\)|FAIRY_TEST_PYTHON" workers/speech/mock_worker.py apps/gateway/src/speech-worker-process.ts *> tasks/owner-checks/M3-04/stdio-spawn-evidence.txt
git diff --name-only -- docs docs-zh *> tasks/owner-checks/M3-04/docs-diff.txt
```

Expected: ASCII check says PASS; forbidden-import and docs-diff files are empty; stdio/spawn evidence contains binary write/flush, CRLF stripping, `shell:false`, and one test override read.

### F. Optional live CLI smoke (configured mock/local text provider; no audio/provider speech access)

With the gateway running on the normal authenticated loopback endpoint:

```powershell
pnpm fairy voice worker --script workers/speech/fixtures/voice-worker-script.json --json *> tasks/owner-checks/M3-04/voice-worker-cli.json
$result = Get-Content -Raw tasks/owner-checks/M3-04/voice-worker-cli.json | ConvertFrom-Json
$result | Select-Object sid,worker_id,worker_process_id,python_version,interpreter,request_ids,event_counts,model_request_count,transcript_text,tts_chunk_count,error_status
Get-Process -Id $result.worker_process_id -ErrorAction SilentlyContinue
```

Expected:

- parseable JSON;
- `worker_id = speech-mock-v0`;
- selected interpreter and Python version present;
- exactly one `turn.input`/`turn.final` and model request count 1;
- `error_status = none`;
- final `Get-Process` has no output because ack follows child shutdown;
- no audio device, speech provider, pip package, or external-network requirement.

If no stable gateway/model fixture is running, mark this step N/A and cite the deterministic CLI E2E test instead.

### G. Replay smoke from optional CLI output

Use `log_path`/`replay_command` from the JSON:

```powershell
$dataDir = Split-Path (Split-Path (Split-Path $result.log_path -Parent) -Parent) -Parent
pnpm fairy replay $result.sid --data-dir $dataDir *> tasks/owner-checks/M3-04/voice-worker-replay.txt
pnpm fairy replay $result.sid --data-dir $dataDir --json *> tasks/owner-checks/M3-04/voice-worker-replay.json
```

Expected: canonical speech/turn events only; no `asr.script`, `tts.script`, ready/bye, raw audio, or base64.

### H. CI and final evidence

After owner commit/push:

1. Save the GitHub Actions run URL and Ubuntu/Windows job verdicts in `tasks/owner-checks/M3-04/M3-04-owner-checks.md`.
2. Record the tested commit SHA.
3. Record any N/A optional checks with the deterministic test that substitutes for them.
4. Do not claim M3-04 closed until primary review, owner evidence, and reviewer countersign are complete.
