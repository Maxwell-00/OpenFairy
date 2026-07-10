# M3-04 Primary Implementation Review

**Task:** M3-04 — Speech worker process scaffold + Python mock worker conformance  
**Brief baseline:** `db0556f`  
**Reviewed commit:** `e3e8089f996f810f6722537225eca0d411391646`  
**CI:** GitHub Actions run `29071874462` — Ubuntu and Windows jobs succeeded  
**Review stage:** Primary implementation review, before owner/manual evidence  
**Verdict:** **ACCEPTED WITH NOTES**  
**Milestone closure:** **PENDING** owner evidence, final primary close, and Fable/Opus countersign + reviewer-owned docs pass

## 1. Decision

The committed implementation satisfies the gated M3-04 scope closely enough to proceed to owner checks.

No M3-04 **BLOCKER** was found in the committed diff, implementation structure, deterministic tests, or published CI status.

The reported Python `3.13.9` is not a project requirement and is not pinned by the implementation. It is the interpreter that the Windows workstation's fixed production discovery order selected through `python`. The mock worker does not visibly use Python 3.13-only syntax or APIs.

The implementation does, however, leave the supported Python floor undefined. That is recorded below as a **CARRY-IN**, not as a reason to reject M3-04.

## 2. Findings

### BLOCKER

None.

### CARRY-IN — M3-04-C1: supported Python floor is not declared or tested explicitly

**Observed**

- Production discovery probes the fixed ordered candidates:
  1. `python3`
  2. `python`
  3. `py -3` on Windows
- The selected interpreter/version is surfaced in handshake and CLI evidence.
- The Codex workstation selected `python` / Python `3.13.9`.
- Discovery accepts a syntactically valid `major.minor.patch` version string but does not enforce a minimum supported Python major/minor.
- CI uses whichever compatible Python is present on the hosted runner; the workflow does not establish a declared lower-bound compatibility lane.

**Assessment**

This does not violate the gated brief, which required deterministic candidate discovery and version evidence but did not define a minimum Python version. It also does not mean OpenFairy now requires Python 3.13.9.

The gap matters before this scaffold becomes a real ASR/TTS worker contract. Without a declared floor, compatibility can drift silently and an old `python` executable can be discovered before a usable launcher fallback.

**Recommended disposition**

- Declare a minimum supported Python version in the reviewer-owned English docs pass or the next relevant speech-worker task.
- Recommended baseline: **Python 3.11 or newer**.
- Add an explicit version-floor check to interpreter probing when the compatibility contract is formalized.
- Add one explicit CI compatibility lane at the chosen floor, while retaining the normal runner-discovery lane.
- For M3-04 owner evidence, run the focused suite once with an exact Python 3.11 executable path through `FAIRY_TEST_PYTHON` when available. This is compatibility evidence, not a request to pin production to Python 3.11.

### NIT — M3-04-N1: Actions runtime deprecation warning

The successful Actions run reports Node 20 deprecation warnings for `pnpm/action-setup@v4`, which GitHub is forcing toward Node 24. This is CI maintenance outside the M3-04 implementation and does not affect acceptance.

## 3. Acceptance review

| Area | Result | Primary evidence |
|---|---|---|
| Scope discipline | PASS | Diff contains the worker scaffold, gateway supervisor/integration, CLI path, fixtures, tests, and work report; no real ASR/TTS provider, device, cloud audio, VAD, Lane A/B, ack bank, barge-in, benchmarks, tray, or M4 workflow was added. |
| Worker location and dependencies | PASS | `workers/speech/mock_worker.py` is repository-owned; source uses Python standard-library modules only; tests enforce ASCII-only source and reject forbidden provider/device/network imports and file writes. |
| Windows stdio hygiene | PASS | Worker uses binary stdout writes with newline and per-message flush; supervisor launches with `-u`, strips trailing `\r`, and attaches stdout/stderr drains immediately after spawn. |
| NDJSON wire validation | PASS | Exact-field runtime validation, stable encoding, CRLF decoding, request correlation, raw-audio/base64 rejection, bounded line/queue/stderr handling, and valid/invalid fixtures are present. |
| stdio vs local WebSocket reconciliation | PASS | Work report states stdio NDJSON is the v0 wire for a gateway-supervised local child, while authenticated local WebSocket remains for future remote/decoupled workers. |
| Mock-only wire kinds | PASS | Work report explicitly marks `asr.script` and `tts.script` as mock-conformance-only and includes the required wire-to-frame mapping table. |
| Supervisor placement | PASS | Child-process ownership is in `apps/gateway/src/speech-worker-process.ts`; `packages/voice/src/index.ts` was not given child-process ownership and its guard was not weakened. |
| Spawn and interpreter discovery | PASS WITH NOTE | `shell:false`, fixed candidates, bounded probes, literal test-only `FAIRY_TEST_PYTHON`, repository-controlled worker path, and interpreter/version evidence are implemented. Python floor remains undeclared; see M3-04-C1. |
| Lifecycle deadlines and cleanup | PASS | Startup, discovery, handshake, request, cancellation, shutdown, termination, and forced-kill paths have explicit deadlines; tests exercise shutdown, timeout, malformed output, direct child kill, and no-orphan behavior. |
| Crash discipline | PASS | The conformance suite directly terminates the actual `SpeechWorkerProcess` child and waits for its PID to disappear; it does not merely kill a wrapper process. |
| Pre-final cancel/crash/timeout | PASS | Tests assert no `speech.asr.final`, no `turn.input`, zero model requests, no dangling worker process, and successful replay. |
| Canonical event discipline | PASS | Failure visibility uses existing `progress.update` with stage `voice.worker.failed`; tests reject `speech.worker.*` and `voice.worker.*` canonical event types. |
| One TurnRunner / one voice-to-turn path | PASS | Worker `asr.final` enters the existing `#submitVoiceFinalTranscript` → `#acceptTurnInput` path; ASR partials remain observability-only and TTS remains output-only. |
| Voice provenance and labels | PASS | Worker-backed final transcripts use the existing voice payload/provenance path; tests cover raise-only floor behavior and advisory frame labels. |
| Governance inheritance | PASS | Deterministic E2E tests cover route clearance, zero bytes to an under-cleared primary, fallback routing, MemoryGate behavior, egress blocking/redaction, and visible-only TTS. |
| Replay and JSONL hygiene | PASS | Tests assert wire messages and raw audio/base64 do not enter JSONL, failed pre-final sessions replay, and normal worker sessions retain canonical speech/turn output. |
| CLI/test path | PASS | `fairy voice worker` is exposed, its JSON summary includes worker/interpreter/request/event/model/replay evidence, and command/worker-path injection surfaces are rejected. |
| Deterministic suite | PASS | `voice.worker-process-v0` contains four focused tests covering wire/lifecycle, normal TurnRunner path, failure replayability, and trust-stack inheritance. |
| Cross-platform CI | PASS | Actions run `29071874462` completed successfully for both Ubuntu and Windows jobs. |

## 4. Code-level observations

### 4.1 Supervisor and process boundary

The supervisor is correctly located at the gateway composition boundary. It owns:

- fixed interpreter discovery;
- repository-controlled worker path resolution;
- `shell:false` child creation;
- bounded stdout/stderr consumption;
- handshake and request correlation;
- explicit deadlines;
- redacted public diagnostics;
- graceful shutdown and forced termination.

This preserves `packages/voice` as a transport/protocol layer rather than introducing Node process ownership into the package.

### 4.2 Worker wire and Python hygiene

The Python worker:

- is deterministic and stdlib-only;
- does not open microphones, speakers, sockets, cloud APIs, or repository files;
- writes protocol responses through `sys.stdout.buffer.write(... + b"\n")`;
- flushes each response;
- uses stderr only as bounded/redacted diagnostic input to the supervisor;
- supports deterministic normal, wait, crash, and malformed-output behavior for conformance.

The TypeScript side validates both outbound and inbound wire messages and rejects unknown fields, malformed JSON, uncorrelated messages, oversized output, queue overflow, and raw audio/base64.

### 4.3 Failure semantics

The implementation preserves the key pre-final boundary:

- cancellation before ASR final resolves without a normal turn;
- crash, malformed output, and timeout reject pending work;
- no `turn.input` is appended;
- the model provider receives zero requests;
- the child PID is gone;
- the session remains replayable;
- visibility is represented through existing speech marks or `progress.update`, not new canonical worker event types.

### 4.4 Governance and output-only TTS

The worker is only an ingress/egress process scaffold. It does not become a second policy engine.

Final transcript handling still flows into the existing gateway governance stack and TurnRunner. TTS is generated only from visible final text. Hidden reasoning, tool traces, raw denied secrets, and audit internals are covered by deterministic negative assertions.

## 5. Evidence separation

### 5.1 CI evidence

Verified independently from GitHub:

- run: `29071874462`;
- commit: `e3e8089`;
- overall result: success;
- Ubuntu job: success;
- Windows job: success.

The unauthenticated Actions view exposes job completion/status but not every raw step log. Therefore this review treats the published matrix result as CI evidence and separately inspects the committed test source rather than repeating Codex's local command claims as CI facts.

### 5.2 Committed implementation evidence

Inspected from the committed GitHub state:

- commit diff and changed-file set;
- gated task brief;
- gateway supervisor;
- Python mock worker;
- worker-process conformance suite;
- gateway voice-to-turn bridge;
- CLI changes and tests;
- work-report decisions, mapping table, and proposed docs edits.

Codex's work report was used as an index and claim source only where corroborated by committed code/tests or GitHub status.

### 5.3 Owner/manual evidence

**Not yet supplied.**

Required next evidence is defined in `M3-04-owner-manual-checks.md`. The owner run should produce artifacts under:

`tasks/owner-checks/M3-04/`

Owner checks must remain separate from the CI section and should include:

- full named-suite output;
- focused worker suite;
- voice and CLI package tests;
- actual production-discovery interpreter/version evidence;
- Python ASCII/import and stdio/spawn static evidence;
- no-orphan process evidence;
- recommended lower-bound compatibility smoke;
- optional CLI/replay smoke only when a deterministic local/mock text provider is already configured.

## 6. Closure status

**Primary implementation review: ACCEPTED WITH NOTES.**

M3-04 is not yet final-closed. Final closure requires:

1. owner checks executed against committed `e3e8089`;
2. evidence committed under `tasks/owner-checks/M3-04/`;
3. final primary review update confirming the evidence;
4. Fable/Opus code-level countersign;
5. reviewer-owned English docs pass applying the approved proposals without reading or editing `docs-zh/`.

The Python `3.13.9` observation does not require reopening Codex implementation by itself. Resolve it as a compatibility-contract carry-in, not as an M3-04 scope change.
