# Task M3-04 — Speech worker process scaffold + Python mock worker conformance

> Paste this entire file as the task brief after Fable/Opus brief-gate review.
> Gated 2026-07-09 by the reviewer (Claude Fable 5); gate record in `tasks/M3-04-brief-review.md`; edits RE-1..RE-5 applied in place.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M0, M1, M2, M3-01, M3-02, and M3-03 are closed.
>
> This is the fourth M3 slice. It introduces the **speech worker process boundary** and a deterministic Python mock worker under `workers/speech/`, while continuing to use mock/scripted ASR/TTS behavior.
>
> This task is **not** a real ASR/TTS provider binding task. It is **not** a VAD, endpointing, two-lane, ack-bank, barge-in, latency benchmark, or desktop client task. It proves that the gateway can supervise a speech worker process, exchange deterministic voice frames/control messages, shut it down safely, and preserve the M2/M3 trust stack.

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
   - M3-03 is closed.
   - M3 trust property: every voice path inherits the full label / clearance / egress / replay stack.
   - Standing M3-03 rule: every voice listener needs auth and loopback-only binding unless a future TLS+auth slice explicitly gates external exposure.
   - Owner commits/pushes before review.
   - Docs reviewer-owned unless explicitly instructed.

3. `tasks/M3-03-review.md`
   - M3-03 is closed.
   - Local WebSocket adapter exists and is token-authenticated on connect.
   - WebSocket v0 binary envelope is `uint32 header_len + JSON header + raw payload`; compact `4-byte channel id + payload` remains reserved for the real-audio/Opus slice.
   - Two-stream FIFO interleave is test-gated.
   - No transport frames are canonical JSONL events.
   - `voice.websocket-transport-v0` is live.

4. `docs/specs/voice-pipeline.md`
   - Architecture: client mic → gateway voice coordinator → ASR worker → kernel → TTS worker → client playback queue.
   - M3-01: in-process loopback.
   - M3-02: internal duplex frame contract and in-memory mock worker.
   - M3-03: local WebSocket adapter over the duplex frame contract.
   - Next worker-plane step: a supervised speech worker process under `workers/speech/`, still deterministic/mock.
   - Real ASR/TTS providers, VAD, endpointing, Lane A/B, ack bank, barge-in cascade, desktop client, and latency/quality benches remain future M3 slices.

5. `docs/specs/protocol.md`
   - Runtime canon is normative.
   - Speech worker wire messages are not canonical events.
   - Binary audio frames are not JSONL events.
   - Canonical voice replay surface remains:
     - `speech.asr.partial`
     - `speech.asr.final`
     - `speech.tts.chunk`
     - `speech.mark`
   - Do not invent new canonical event types for worker-process messages.

6. `packages/protocol/schemas/speech.*.v1.json`
   - Registered speech event schemas are authoritative.
   - Do not rename or restructure required fields.
   - No enum narrowing on `speech.mark.payload.mark_id`.
   - Additive optional fields only if absolutely required, with schema + fixture pairing and work-report Decisions.

7. `docs/specs/data-governance.md`
   - Voice floor:
     - balanced: `personal / region-restricted(home)` + `prefer_local`;
     - sovereign: `personal / local-only`;
     - cloud-friendly: `personal / global-ok`.
   - Frame labels are advisory and can only raise, never lower, the floor.
   - Route clearance, MemoryGate, egress guard, redaction, and replay apply identically to all voice-originated turns.
   - An unauthenticated voice port is an unlabeled ingress and is forbidden; worker process ingress must also be controlled by the gateway supervisor, not arbitrary user commands.

8. `docs/specs/evals.md`
   - Live M3 suites:
     - `voice.protocol-loopback-v0`
     - `voice.duplex-transport-v0`
     - `voice.websocket-transport-v0`
   - Future benches remain deferred:
     - voice latency bench;
     - interrupt quality / barge-in <= 250 ms;
     - ASR zh/en/mixed benchmark;
     - real ASR provider conformance;
     - real TTS provider conformance.
   - M3-04 may add a deterministic PR-tier worker-process conformance suite, but must not fake-pass acoustic/provider/latency benchmarks.

9. `docs/specs/model-gateway.md`
   - M3 mock worker paths are not provider roles.
   - Real ASR/TTS roles, including `voice.fastpath`, remain future M3 provider work.
   - No vendor audio SDKs.

## Deliverables

### 0. Preserve M2 and M3 invariants

Required:

- Existing M2 named suites remain visible and green:
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
- Existing M3 suites remain visible and green:
  - `voice.protocol-loopback-v0`
  - `voice.duplex-transport-v0`
  - `voice.websocket-transport-v0`
- `memory.canary` remains visibly skipped/deferred; do not fake-pass.
- Future voice latency/barge-in/ASR/provider benches remain future/deferred; do not fake-pass.
- One TurnRunner.
- No provider-specific branches in kernel.
- No vendor SDKs.
- No docs-zh edits.

Acceptance:

- `pnpm --filter @fairy/testing test -- --reporter=verbose` shows the existing M2/M3 suites.
- `git diff --name-only -- docs-zh` has no output.
- No runtime source unrelated to voice worker process changes unless justified in `tasks/M3-04-work.md`.

### 1. `workers/speech` Python mock worker skeleton

Add a workspace worker directory:

```text
workers/speech/
```

Suggested files:

```text
workers/speech/mock_worker.py
workers/speech/README.md
workers/speech/fixtures/
```

Required behavior:

- Python standard library only.
- No pip dependencies.
- No ASR/TTS provider package.
- No microphone/speaker/device access.
- No network or socket access from the Python worker in this slice.
- No subprocess spawning from the worker.
- Deterministic scripted behavior only.
- Reads a small worker wire protocol from stdin and writes responses to stdout.
- Stderr may be used for diagnostics, but diagnostics must be redacted/safe and must not contain raw secret/personal input.
- Exits cleanly on shutdown.
- Exits non-zero on malformed fatal startup input.
- Does not write generated files into the repo tree.

Acceptance:

- Worker can be launched from tests on Windows and Linux.
- Worker responds to a health/ready handshake.
- Worker can process scripted ASR/TTS control messages.
- Worker can shut down cleanly.
- Worker uses no non-stdlib import outside its own files.
- Static/source scan proves no socket/network/audio/subprocess modules are imported.
- Tests prove no repo-tree writes.

### 2. Worker wire protocol v0 over stdio

Define a deterministic process wire protocol between the TS supervisor and the Python mock worker.

This wire protocol is internal. It is not canonical JSONL and not the M3-02 frame family itself, though it should carry M3-02-compatible control-frame semantics.

Preferred:

- newline-delimited JSON control messages over stdin/stdout;
- no binary audio bytes in this slice;
- synthetic audio references / fixture ids instead of raw audio;
- frame ids / request ids for correlation.

Suggested message kinds:

```ts
type SpeechWorkerWireMessage =
  | { kind: "hello"; protocol: "fairy.speech-worker.v0"; worker_id?: string }
  | { kind: "ready"; worker_id: string; capabilities: string[] }
  | { kind: "asr.script"; request_id: string; utterance_id: string; audio_ref: string; partials: string[]; final: string; labels?: Labels }
  | { kind: "asr.partial"; request_id: string; utterance_id: string; text: string }
  | { kind: "asr.final"; request_id: string; utterance_id: string; text: string; audio_ref: string }
  | { kind: "tts.script"; request_id: string; utterance_id: string; text: string; chunk_chars?: number; labels?: Labels }
  | { kind: "tts.chunk"; request_id: string; chunk_id: string; text: string; audio_ref?: string }
  | { kind: "cancel"; request_id: string; target: "asr" | "tts" | "all"; reason?: string }
  | { kind: "error"; request_id?: string; code: string; message: string; retryable?: boolean }
  | { kind: "shutdown"; reason?: string }
  | { kind: "bye"; reason?: string };
```

You may adjust the exact names, but document the final shape in `tasks/M3-04-work.md`.

**(gate RE-1)** `docs/specs/voice-pipeline.md` §2 (line 31) states gateway⇄speech-workers run "the same duplex protocol over **local WS**". This slice's stdio wire diverges from that sentence and the divergence must be a recorded reconciliation, not a silent one (fourth instance of this pattern — same rule as M3-01 payload shapes, M3-02 frame names, M3-03 binary framing). The voice-pipeline docs proposal MUST state: stdio NDJSON is the **v0 wire for locally-supervised child workers**; §2's local-WS duplex (with the M3-03 auth machinery) remains the transport for **remote/decoupled workers** (§9's remote-GPU-box case) and is not replaced. The docs proposal must also include a **mapping table** between `SpeechWorkerWireMessage` kinds and the M3-02 `VoiceControlFrame` kinds, explicitly marking which wire kinds are **mock-conformance-only** (`asr.script`, `tts.script` — a real worker receives audio frames and synthesize requests, not scripts) and which are durable protocol (`asr.partial`, `asr.final`, `tts.chunk`, `cancel`, `error`, lifecycle). The v0 wire must not silently ossify mock semantics into the future real-worker contract.

**(gate RE-2 — Windows stdio hygiene; incident-class)** Newline-delimited JSON over Windows pipes has two classic failure modes this brief must preempt: (a) **CRLF translation** — Python text-mode stdout writes `\r\n`, and a TS reader splitting on `\n` gets a trailing `\r` that breaks `JSON.parse`; (b) **pipe-buffer deadlock** — unflushed Python stdout + an undrained stderr fills the pipe and both processes wait forever (deadlines would catch it late; the root cause must be prevented). Therefore: spawn Python with `-u` (unbuffered) AND the worker writes each message as UTF-8 via `sys.stdout.buffer.write(... + b"\n")` (or equivalent explicit binary-mode write + flush per message), never bare `print`; no BOM; the TS reader strips a trailing `\r` before parse; the supervisor drains stdout and stderr **concurrently** from spawn. A test must run a full session on Windows CI (the acceptance matrix already requires it) — treat any `\r`-related parse failure as this clause's regression.

Required behavior:

- Runtime validation for every inbound/outbound message on the TS side.
- Python worker validates minimum required fields before acting.
- Invalid messages fail closed and produce redacted `error` responses or process shutdown depending on severity.
- Wire messages may carry advisory labels but cannot lower the gateway-side voice floor.
- Wire messages are not appended to session JSONL.
- No base64/raw audio in wire JSON.

Acceptance:

- Unit tests for valid/invalid wire messages.
- Golden valid/invalid fixtures.
- Tests for stable encode/decode.
- Tests that malformed messages do not trigger turns.
- Tests that raw audio/base64 is rejected.
- Tests that wire labels cannot lower the voice floor when converted into canonical speech events/turn input.

### 3. TS speech worker supervisor

Implement a TypeScript supervisor that launches and manages the Python mock worker.

Suggested API:

```ts
class SpeechWorkerProcess {
  start(): Promise<void>;
  requestAsr(script): Promise<...>;
  requestTts(script): Promise<...>;
  cancel(requestId): Promise<void>;
  shutdown(): Promise<void>;
}
```

**(gate RE-3 — placement)** The supervisor lives **gateway-side** (`apps/gateway`, per voice-pipeline §9: "Python workers under gateway supervision") or in a new dedicated module — NOT in `packages/voice/src/index.ts`. Reason: the voice package's source-scan guard (`packages/voice/test/index.test.ts:658`) forbids `node:child_process` in that file and was already relaxed once at M3-03 for `ws`/`node:http`; a second relaxation of the same guard for the same file starts eroding it. If a dedicated `packages/voice` submodule is used instead of the gateway, the guard must keep covering `src/index.ts` unchanged and the new module gets its own explicit scan scope — do not weaken the existing assertion.

Required behavior:

- Spawns Python without shell interpolation.
  - Use `spawn(command, args, { shell: false })`.
  - No user-provided shell strings.
- Python executable discovery is deterministic:
  - **(gate RE-4)** test override may use `FAIRY_TEST_PYTHON`, narrowly: read only at supervisor construction, used **only as `argv[0]`** (never split/parsed as a shell string, never combined with `shell: true`), and its use surfaced in test logs / JSON output so evidence shows which interpreter ran. This is a test-only escape hatch, not production config — the production path uses only the fixed candidate list below.
  - otherwise documented candidates such as `python3`, `python`, `py -3` (in that order; `py -3` on win32 only).
  - Discovery must have explicit deadlines and clear error messages, and the `ready` handshake should echo the Python version for diagnosability.
- Worker path is controlled by the repo/package, not arbitrary config.
- Handshake deadline.
- Per-request deadline.
- Shutdown deadline.
- Crash handling:
  - visible safe error;
  - no dangling process;
  - no partially emitted turn if ASR final was not completed.
- Stderr capture is bounded and redacted.
- No unbounded queues.
- No repo-tree writes.
- Works on Windows and Linux CI.

Acceptance:

- Unit/integration tests for start, handshake, ASR, TTS, cancel, shutdown, crash, timeout.
- Test that malformed worker output fails closed.
- Test that secret text in worker stderr/error is redacted.
- Test that supervisor kills worker on timeout.
- Test that no child process remains after tests.
- Test that no shell is used for spawn.
- Test that worker path cannot be controlled by user CLI input.

### 4. Worker-backed voice conformance path

Expose a minimal developer/test path that exercises the Python worker through the existing voice pipeline.

Preferred CLI:

```powershell
pnpm fairy voice worker --script <fixture.json> --json
```

Alternative name is acceptable if documented.

Required behavior:

- Uses the TS supervisor + Python mock worker.
- Produces the same canonical session shape as M3-03 for a basic utterance:
  - `speech.asr.partial`
  - `speech.asr.final`
  - one normal `turn.input`
  - normal TurnRunner model path
  - `speech.tts.chunk`
  - speech marks.
- Converts only ASR final into one normal `turn.input` through the existing `#submitVoiceFinalTranscript` -> `#acceptTurnInput` path.
- ASR partials remain observability-only.
- TTS chunks remain output-only.
- JSON output includes:
  - session id;
  - worker process id or worker id;
  - request ids;
  - speech event counts;
  - model request count;
  - transcript text;
  - TTS chunk count;
  - cancel/error status if applicable;
  - log path or replay command.
- No raw audio/base64 in JSON output or JSONL.
- No repo-tree writes by default; temp/data-dir only.

Acceptance:

- CLI test with temp data dir.
- JSON parse test.
- Test exactly one normal turn for a non-cancelled ASR final.
- Test ASR partials do not create model calls.
- Test TTS chunks do not re-enter prompt.
- Test no raw audio/base64 in JSON output or JSONL.
- Test no worker-wire message types appear in JSONL.
- Works on Windows and Linux CI.

### 5. Trust stack integration

The worker-backed path must inherit M3-03 and M2 trust properties.

Required behavior:

- Worker/wire labels are advisory only.
- Effective labels derive gateway-side from profile floor + one-way advisory clamp + content escalation.
- Under-cleared primary receives zero request bytes when transcript labels exceed clearance.
- Cleared fallback can complete if configured.
- MemoryGate remains inherited:
  - spoken safe remember with default personal floor is `personal_default_hold`;
  - spoken secret remember is denied;
  - no automatic memory write just because content was spoken.
- Egress guard remains inherited:
  - spoken secret outbound attempt is blocked before outbound tool execution.
- TTS derives only from visible `turn.final`.
- Worker errors/stderr must not leak hidden reasoning, audit internals, raw route-denial secrets, or tool traces.

Acceptance:

- E2E: worker path with advisory `public/global-ok` under balanced profile still emits `speech.asr.final` + `turn.input` labels `personal / region-restricted` plus `prefer_local`.
- E2E: spoken secret via worker path denies under-cleared primary with zero provider request bytes, visible denied candidate, fallback completes.
- E2E: spoken safe remember via worker path is `personal_default_hold`, no `memory.written`.
- E2E: spoken secret remember denied, no `memory.written`.
- E2E: spoken secret outbound attempt blocked and redacted.
- Test: TTS chunks do not contain hidden reasoning, audit internals, route-denial raw secret, or tool traces.
- Test: worker stderr/error redaction prevents raw secret leakage.

### 6. Cancel / crash / timeout replayability

Worker failures and cancellation must leave clean, replayable sessions.

Required behavior:

- Cancel before ASR final:
  - no `turn.input`;
  - no model request;
  - visible speech mark or existing speech event only;
  - session replayable.
- Worker crash before ASR final:
  - no `turn.input`;
  - no model request;
  - visible safe error/progress **via existing event types only** — **(gate RE-5)** use `progress.update` with a documented stage string (e.g. `stage: "voice.worker.failed"`, following the `egress.denied` stage-string precedent) and/or the existing `error` envelope; no new canonical event type;
  - session replayable.
- **(gate RE-5)** Crash simulation follows standing rule §5.3: kill the **worker process itself** (direct child-pid kill, or a scripted worker self-exit directive in the fixture) — never a wrapper process, and there is no shell wrapper to begin with (`shell: false`).
- Worker timeout:
  - supervisor terminates worker;
  - no dangling process;
  - no raw secret in diagnostics;
  - session replayable.
- No new canonical event types for worker lifecycle unless already registered and explicitly justified.

Acceptance:

- Tests for cancel before final.
- Tests for crash before final.
- Tests for timeout before final.
- Replay tests for each failure class.
- Grep/test proving no `speech.worker.*`, `voice.worker.*`, or worker-wire event types appear in JSONL.

### 7. Eval suite

Register deterministic PR-tier suite in `packages/testing`.

Required suite name:

```text
voice.worker-process-v0
```

Required coverage:

- Python worker handshake.
- Worker wire protocol validation.
- ASR/TTS deterministic script behavior.
- TS supervisor lifecycle/deadlines.
- cancel/crash/timeout cleanup.
- worker-backed ASR final enters normal TurnRunner path exactly once.
- partials do not call the model.
- TTS output-only.
- label clamp + route clearance.
- MemoryGate/egress inherited.
- worker stderr/error redaction.
- no raw audio/base64 in JSONL.
- no real provider, microphone, speaker, external network, Python package dependency, or OS audio device in CI.

Also continue to report as future/deferred, not pass:

```text
voice latency bench
interrupt quality / barge-in <= 250 ms
ASR zh/en/mixed benchmark
real ASR provider conformance
real TTS provider conformance
real desktop/tray client
```

Acceptance:

- `voice.worker-process-v0` appears in `pnpm --filter @fairy/testing test -- --reporter=verbose`.
- `voice.protocol-loopback-v0`, `voice.duplex-transport-v0`, and `voice.websocket-transport-v0` remain green.
- Non-vacuous assertions.
- No LLM judge.
- No real audio/provider/external network.

### 8. Config surface

Keep config minimal.

Preferred:

- No user-facing config if CLI/test-local worker path can locate the repo's mock Python worker.
- If config is needed, make it explicit, local-only, and test-only.

Rules:

- Do not add arbitrary worker command config.
- Do not accept user-provided shell strings.
- Do not add provider API keys.
- Do not add ASR/TTS provider endpoints.
- Do not add external network host config.
- If any `voice.worker.*` config key is added, it must have explicit schema entries and invalid-value tests. Nothing may ride `additionalProperties: true`.
- Document final choice in `tasks/M3-04-work.md`.

Acceptance:

- Config tests only if config changed.
- Invalid-value tests if config changed.
- No side-channel config.
- No provider config.
- No shell-string command config.

### 9. Docs proposals only

Default: do not edit `docs/` or `docs-zh/`. Put proposed docs edits in `tasks/M3-04-work.md`.

Propose docs edits for:

- `docs/specs/voice-pipeline.md`
  - Python mock worker status;
  - worker process lifecycle;
  - stdio wire protocol v0;
  - supervisor deadlines and cleanup;
  - no real ASR/TTS provider yet;
  - real provider binding remains a separate slice.

- `docs/specs/protocol.md`
  - worker wire messages are not canonical events;
  - canonical replay surface remains `speech.*`.

- `docs/specs/evals.md`
  - register `voice.worker-process-v0`;
  - keep latency/barge-in/ASR provider benches deferred.

- `docs/specs/data-governance.md`
  - worker path inherits voice floor/clamp/route/egress rules;
  - worker stderr/error redaction requirement.

- `docs/specs/model-gateway.md`
  - Python mock worker is not `voice.fastpath` and not a provider role;
  - real ASR/TTS provider binding remains future M3 work and must carry cloud-speech clearance rules.

If reviewer asks for docs pass, they will apply it after delivery.

## Boundaries — do NOT

- Do not implement real microphone capture.
- Do not implement real speaker playback.
- Do not implement real ASR provider.
- Do not implement real TTS provider.
- Do not call cloud audio APIs.
- Do not import vendor audio SDKs.
- Do not add pip dependencies.
- Do not implement VAD or endpointing.
- Do not implement two-lane Lane A/Lane B.
- Do not implement ack bank.
- Do not implement sentence-chunked real TTS.
- Do not implement barge-in cascade beyond protocol-level cancel semantics.
- Do not claim interrupt quality / barge-in <= 250 ms.
- Do not implement latency benchmark as pass.
- Do not implement ASR quality benchmark as pass.
- Do not implement desktop tray client.
- Do not implement M4 scheduler/workflows/proactivity.
- Do not create a second TurnRunner.
- Do not bypass model-gateway route clearance.
- Do not send ASR partials to the model.
- Do not TTS hidden reasoning/traces/audit internals.
- Do not store raw audio/base64 in JSONL.
- Do not add canonical event types for worker wire messages.
- Do not edit `docs-zh/`.
- Do not write generated fixtures/artifacts into the repo tree from tests or CLI; owner evidence belongs under `tasks/owner-checks/M3-04/`.
- Do not expose arbitrary worker command execution through config/CLI.
- Do not spawn with `shell: true`.

## Encoding and Windows rules

- Use PowerShell 7 / UTF-8 no-BOM evidence where possible.
- Valid UTF-8 Chinese text in fixtures is permitted only if testing zh behavior; otherwise prefer English.
- **(gate RE-5)** Python source files are **ASCII-only** (the repo's encoding guard scans `.ts`/protocol `.json` but not `.py` — do not rely on it; use `\uXXXX`-style escapes inside Python strings if non-ASCII is ever needed).
- New `.ts` regex literals with CJK must use `\uXXXX` escapes.
- Verification commands targeting non-ASCII strings must use ASCII `node -e` scripts with escapes.
- New CLI tests must use the existing source-first TS execution world (`scripts/run-cli.mjs` / `node --import tsx`), not plain `node` on `.ts`.
- All process waits and Python discovery attempts must have explicit deadlines and named failure errors.

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
git diff --name-only -- docs docs-zh
```

GitHub Actions must be green on ubuntu + windows.

## Manual owner checks

Owner should run after CI is green. Deterministic fixture/mock evidence is acceptable. No real audio device, provider, external network, or Python package dependency required.

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M3-04 | Out-Null
```

### 1. Voice worker suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Expected:

- `voice.worker-process-v0` appears and passes.
- `voice.websocket-transport-v0` remains green.
- `voice.duplex-transport-v0` remains green.
- `voice.protocol-loopback-v0` remains green.
- All M2 named suites remain green.
- Future latency/barge-in/ASR provider benchmarks are not fake-passed.

Save:

```text
tasks/owner-checks/M3-04/testing-voice-worker.txt
```

### 2. Focused worker suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose -t "voice.worker-process-v0"
```

Expected:

- focused suite appears and passes.
- worker handshake, wire protocol, supervisor, cancel/crash/timeout, route gate, MemoryGate, egress, replay are covered.

Save:

```text
tasks/owner-checks/M3-04/voice-worker-focused.txt
```

### 3. Package / CLI tests

Run:

```powershell
pnpm --filter @fairy/voice test -- --reporter=verbose
pnpm --filter @fairy/cli test -- --reporter=verbose
```

Save:

```text
tasks/owner-checks/M3-04/voice-package.txt
tasks/owner-checks/M3-04/cli-voice-worker.txt
```

Expected:

- voice package tests green.
- CLI/replay tests green.
- corrupt-tail replay still green.

### 4. Optional CLI smoke

Run the chosen CLI command if exposed, for example:

```powershell
pnpm fairy voice worker --script <fixture.json> --json
```

Expected:

- JSON parseable.
- worker id / request ids visible.
- speech event counts visible.
- model request count visible.
- exactly one normal turn for non-cancelled ASR final.
- no raw audio/base64.
- no external network/device/provider.

Save if run:

```text
tasks/owner-checks/M3-04/voice-worker-cli.json
```

If no stable standalone CLI smoke exists, mark N/A and rely on deterministic E2E tests.

### 5. Replay smoke

Replay a worker-produced session if a stable session/data-dir is exposed.

Save if available:

```text
tasks/owner-checks/M3-04/voice-worker-replay.txt
tasks/owner-checks/M3-04/voice-worker-replay.json
tasks/owner-checks/M3-04/voice-worker-manifests.txt
```

If not available, mark N/A and point to deterministic replay tests.

## Report back

Use the established format:

1. File tree delta.
2. Verification tails:
   - local commands;
   - CI link/status;
   - conformance verdict;
   - named suite names.
3. Decisions:
   - worker directory/package shape;
   - Python executable discovery;
   - worker wire protocol;
   - supervisor lifecycle/deadline behavior;
   - cancel/crash/timeout semantics;
   - gateway/CLI worker path;
   - label/provenance behavior;
   - replay rendering;
   - config/no-config choice.
4. Spec ambiguities.
   - Non-empty; at minimum explain what is worker wire message vs canonical event, how Python availability is handled in CI/dev, and why real ASR/TTS providers remain deferred.
5. Proposed docs edits.
6. Manual owner checklist with exact commands and evidence paths.
