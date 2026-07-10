# M3-04 Final Primary Implementation Review

**Task:** M3-04 — Speech worker process scaffold + Python mock worker conformance  
**Brief baseline:** `db0556f`  
**Implementation commit:** `e3e8089f996f810f6722537225eca0d411391646`  
**Owner-evidence commit:** `d170407`  
**Evidence-hygiene fix:** `ac3a2e438fd5a333f3452fcef2a8d5eb80528a06`  
**Implementation CI:** GitHub Actions run `29071874462` — Ubuntu and Windows PASS  
**Owner-evidence CI:** GitHub Actions run `29079889389` — Ubuntu and Windows PASS  
**Review stage:** Final primary implementation review  
**Verdict:** **ACCEPTED WITH NOTES**  
**Primary status:** **CLOSED**  
**Remaining workflow:** Fable/Opus code-level countersign and reviewer-owned English docs pass

## 1. Final decision

M3-04 is accepted and closed at the primary-review stage.

The committed implementation satisfies the gated scope:

- repository-owned, standard-library-only Python mock worker;
- gateway-side TypeScript supervisor;
- supervised stdio NDJSON v0 wire;
- handshake, request, cancel, and shutdown lifecycle;
- bounded discovery, startup, request, cancellation, shutdown, and forced-kill deadlines;
- Windows-safe stdio handling;
- crash, timeout, malformed-output, stderr-redaction, and cleanup behavior;
- worker-backed gateway/CLI path;
- deterministic `voice.worker-process-v0` conformance;
- inherited route clearance, MemoryGate, egress, replay, and visible-only TTS behavior.

No implementation BLOCKER remains. The owner evidence closes production interpreter discovery, Python 3.11 compatibility, focused conformance, package tests, static source guards, and zero-orphan process verification.

## 2. Findings

### BLOCKER

None.

### CARRY-IN — supported Python floor remains a future contract decision

M3-04 demonstrates:

- production discovery with Python `3.13.9`;
- explicit test-override compatibility with Python `3.11.15`;
- no observed use of Python 3.13-only syntax or APIs.

The project still does not formally declare or enforce a minimum supported Python version.

Recommended future disposition:

- declare `Python >= 3.11` when the worker compatibility contract is formalized;
- enforce the lower bound during interpreter probing;
- add one explicit CI lane at the declared floor;
- do not pin a specific patch version such as `3.11.15` or `3.13.9`.

This is not an M3-04 closure blocker.

### NIT — owner evidence commit naming

The owner summary records `d170407` as the main owner-evidence commit. The later `ac3a2e4` commit adds the missing zero-orphan evidence and corrects the summary. This review records both commits explicitly, so no further edit is required.

### NIT — optional replay smoke

The optional CLI smoke passed. The optional manual replay smoke is correctly recorded as `NOT RUN` because no committed replay output was preserved. Deterministic replay coverage in the worker-process suite is authoritative.

## 3. Final acceptance matrix

| Area | Result | Final evidence |
|---|---|---|
| Scope discipline | PASS | No real speech provider, device, VAD, lanes, ack bank, barge-in, benchmark, tray, or M4 workflow. |
| Python worker | PASS | Repository-owned `workers/speech/mock_worker.py`; stdlib-only and ASCII-only. |
| Windows stdio | PASS | Binary stdout, newline, flush, `python -u`, CR stripping, concurrent stdout/stderr drains, `shell:false`. |
| Supervisor placement | PASS | Process ownership remains gateway-side; voice/protocol boundaries were not widened. |
| Interpreter discovery | PASS | Fixed candidates, explicit deadlines, repository-controlled path, interpreter/version evidence. |
| Test override | PASS | `FAIRY_TEST_PYTHON` is a literal test-only `argv[0]`, not a shell command string. |
| Production discovery | PASS | `python`, source `discovered`, Python `3.13.9`, followed by `alive:false`. |
| Python 3.11 compatibility | PASS | Exact Conda executable, source `test-override`, Python `3.11.15`, clean shutdown, three integration tests passed. |
| NDJSON wire | PASS | Exact-field validation, CRLF handling, correlation, bounds, malformed-output and raw-audio rejection. |
| Lifecycle | PASS | Handshake, ASR, TTS, cancel, shutdown, crash, malformed output, timeout, forced cleanup. |
| Crash discipline | PASS | Tests terminate the actual worker child and verify PID disappearance. |
| Pre-final failure | PASS | No `turn.input`, no model request, no orphan, replayable session. |
| Canonical events | PASS | No new `speech.worker.*` or `voice.worker.*` canonical event family. |
| One TurnRunner | PASS | Final transcript uses `#submitVoiceFinalTranscript` → `#acceptTurnInput`. |
| Governance | PASS | Route clearance, zero-byte under-cleared provider behavior, MemoryGate, egress redaction, visible-only TTS. |
| Replay/JSONL | PASS | Worker wire and binary audio stay out of JSONL; normal and failed sessions replay. |
| CLI path | PASS | Parseable worker/interpreter evidence; user-controlled executable/script injection rejected. |
| Focused suite | PASS | `voice.worker-process-v0`: 4 tests passed in production-discovery mode. |
| Full testing | PASS | 82 passed, 2 intentionally skipped/deferred. |
| Voice package | PASS | 22 tests passed. |
| CLI package | PASS | 19 tests passed. |
| No orphan | PASS | Committed evidence records `matching_worker_processes=0`. |
| English docs boundary | PASS | No English docs implementation edits. |
| `docs-zh/` boundary | N/A | Directory was already removed by the owner and was not reintroduced. |

## 4. Evidence separation

### CI evidence

- Implementation CI run `29071874462`: Ubuntu PASS; Windows PASS.
- Owner-evidence CI run `29079889389`: Ubuntu PASS; Windows PASS.
- `ac3a2e4` changes only the owner summary and `processes-after-focused.txt`; it does not change implementation code, tests, workflow definitions, package metadata, or docs.

### Owner/manual evidence

Committed owner evidence includes:

- frozen commit/environment record;
- production interpreter discovery and clean shutdown;
- full named testing suites;
- focused `voice.worker-process-v0`;
- Python 3.11.15 override compatibility;
- `@fairy/voice` and `@fairy/cli` tests;
- ASCII-only and stdlib/mock-only source checks;
- Windows stdio/spawn evidence;
- gateway-side supervisor placement;
- CLI smoke;
- explicit `matching_worker_processes=0`.

The initial Python 3.11 command failed only because a production-discovery assertion expected `source: "discovered"` while the explicit override correctly reported `source: "test-override"`. A corrected override handshake and three-test integration subset passed. This was an owner-check design deviation, not an implementation failure.

## 5. Architecture confirmation

M3-04 preserves:

- stdio NDJSON as the v0 wire for a gateway-supervised local child;
- authenticated loopback WebSocket for future decoupled/remote workers;
- `asr.script` and `tts.script` as mock-conformance-only kinds;
- transport frames as non-canonical;
- binary audio outside JSONL;
- voice provenance and label-floor behavior;
- one-way label clamp;
- the existing TurnRunner and governance stack;
- no second speech policy engine.

## 6. Closure

**Final primary verdict: ACCEPTED WITH NOTES.**

**M3-04 primary review is CLOSED at `ac3a2e4`.**

No further Codex implementation work or owner manual checks are required for primary closure.

Remaining workflow:

1. Fable/Opus performs code-level countersign.
2. Reviewer applies the approved English docs proposals.
3. The countersign/docs-pass commit becomes the authoritative M3-04 close commit.
4. Proceed to the next gated M3 task.

Python version resolution:

- Python `3.13.9` is workstation production-discovery evidence, not a pinned requirement.
- Python `3.11.15` compatibility is demonstrated.
- Formal minimum-version enforcement remains a future carry-in.

---

## Countersignature — Claude (Fable 5), 2026-07-10

Code-level cross-check delegated to an opus subagent (12-item checklist at `e3e8089` vs parent `db0556f`, file:line evidence, reads via `git show` only); the load-bearing RE-2 evidence (spawn args, Python write path, CR strip) additionally spot-checked directly by this reviewer. **12/12 PASS, zero FAILED/PARTIAL/vacuous items; every reviewer-gate clause from the brief gate is confirmed in code:**

- **(RE-2, the load-bearing gate)** Spawn: `spawn(argv0, [...args, "-u", "-B", workerPath], {cwd: tmpdir(), shell: false, windowsHide: true})` with both stream handlers attached immediately and stderr bounded at 8 KiB (`speech-worker-process.ts:520-538`). Worker writes exclusively via `sys.stdout.buffer.write(msg + b"\n")` + flush with `ensure_ascii=True` (`mock_worker.py:22-31`) and reads `sys.stdin.buffer` line-based — no bare `print`, no BOM possible. TS reader strips a trailing `\r` before `JSON.parse` (`:364`), and CRLF tolerance is **explicitly tested by injection**, not just via Windows CI. `cwd: tmpdir()` is defense beyond the gate: the child cannot even see the repo tree as its working directory.
- **(RE-3)** Supervisor is gateway-side (`apps/gateway/src/speech-worker-process.ts`, per voice-pipeline §9); `packages/voice` is completely untouched and the `:658` source-scan guard is **byte-identical** to parent; no `node:child_process` anywhere under `packages/voice/src`.
- **(RE-4)** Fixed candidate order `python3` → `python` → `py -3` (win32-only) with per-candidate deadlines and named errors (`SPEECH_WORKER_INTERPRETER_REJECTED/_INVALID/_PYTHON_NOT_FOUND`). `FAIRY_TEST_PYTHON` is **code-enforced test-only** (gated on `NODE_ENV==="test" || CI==="true"` — stronger than the gate's "documented test-only"), used solely as `argv0`, never parsed, never `shell:true`; discovery source + version flow into the ack JSON and owner evidence. The `ready` handshake echoes the Python version and the supervisor **rejects on mismatch** (`SPEECH_WORKER_VERSION_MISMATCH`) — again beyond the gate.
- **(RE-5)** Crash tests kill the actual child (`child.kill()` / scripted `os._exit(17)` directive) and verify PID disappearance via `process.kill(pid, 0)` polling; crash surfaces as `progress.update` stage `voice.worker.failed` — grep confirms zero new canonical event types. Python source is ASCII-only (byte-scan + test), imports exactly `json/os/re/sys/time`, the static test additionally forbids socket/subprocess/audio/vendor modules and `open(`, and the worker performs no filesystem writes (E2E `readdir` before/after equality). Malformed fatal startup input exits `2`.
- **(RE-1)** Wire validation is exact-field fail-closed (unknown keys rejected per kind); golden fixtures 12 valid / 8 invalid (incl. `data:audio/...;base64` rejection and an unregistered `speech.worker.started` kind); the clamp on the worker path is the same `clampVoiceFrameLabels`; the work report's docs proposal contains the stdio-vs-§2 reconciliation, the full 13-row wire↔frame mapping table, and `asr.script`/`tts.script` marked mock-conformance-only. Landed in the docs pass below.
- **Trust E2Es (4 tests, all non-vacuous):** clamp asserted on emitted `speech.asr.final` + `turn.input`; under-cleared primary zero additional requests + fallback completes; `personal_default_hold`/`secret_denied` with empty MemoryStore; egress blocked at `outbound.requests() === 0` with redacted diagnostics; TTS exactly the visible final with hidden/secret fixture text asserted absent; **all four failure classes** (cancel/crash/malformed/timeout before final) produce no `turn.input`, zero model requests, and land in one session replayed clean. Worker stderr redaction is layered: scrubbed at the Python `write_diagnostic` layer **and** independently proven at the gateway/kernel layer via the egress test.
- **Invariants + weakening scan:** one production `new TurnRunner`; single `#submitVoiceFinalTranscript`→`#acceptTurnInput` path (unchanged, context-only in diff); CLI rejects `--python`/`--worker-command`/`--worker-path` (worker path is repository-resolved); no pip manifests; no docs changes; no `it.only`/`.skip`; only new suite name `voice.worker-process-v0`; all changed pre-existing files additions-only; `packages/voice/**`, all three prior voice suites, and `replay.test.ts` untouched. Benign notes: `NODE_ENV`/`CI` reads exist only to gate the test override, and `childEnvironment()` passes a standard OS-env allowlist (`HOME`/`PATH`/`TEMP`…) to the child — neither is a config knob.

### Defense-in-depth worth recording (beyond the brief)

Bounded stdout queue (64) + bounded line size + `maxPendingRequests` (16) with uncorrelated-output rejection; truncated-stdout-on-exit detection; serialized stdout processing; `child.stdin.destroy()` before kill; ASR partial/final rejected on `utteranceId` mismatch; `tts.done` rejected unless the chunk count matches — silent truncation fails closed. Codex built more spine into this supervisor than the gate demanded; noted with approval.

### Named carry-in — minimum supported Python version (landing gate: first real speech-worker slice)

Demonstrated today: 3.13.9 via production discovery, 3.11.15 via override; no floor declared or enforced. Disposition per the primary review, endorsed: declare `Python >= 3.11` when the real-worker compatibility contract is formalized, enforce the bound during interpreter probing, add one CI lane at the floor, never pin a patch version. **This carry-in must be threaded into the first real ASR/TTS worker brief at its gate** — recorded in model-gateway.md and the handbook.

### Owner evidence & incident note

`d170407` + `ac3a2e4` are tasks-only; 82 passed / 2 intentionally skipped, all prior voice suites + 13 M2 suites green, `memory.canary` visibly deferred; `matching_worker_processes=0` committed. The initial Python-3.11 check failure was an **owner-check design deviation** (the check hardcoded `source:"discovered"` while the override correctly reports `source:"test-override"`) — the implementation behaved correctly and the reconciled run passed 3/3; disclosed transparently in the evidence, which is exactly the norm this project wants. Also for the record: `docs-zh/` (parent-folder, owner-maintained) has been removed by the owner — the per-close re-translation flag is discontinued unless the owner recreates it.

### Docs pass — applied with this countersignature

`voice-pipeline.md` (M3-04 status note: worker boundary live, stdio-vs-§2 reconciliation, Windows stdio hygiene stated as normative for any stdio worker, lifecycle/orphan rules, Python-floor carry-in), `protocol.md` (§7 third-family note extended: stdio NDJSON is another worker-plane encoding — wire ids/receipts are transport facts, never events; `voice.worker.failed` stage documented), `data-governance.md` (worker = controlled ingress under the gateway; stderr/protocol errors are untrusted diagnostics, redacted before any surface), `evals.md` (`voice.worker-process-v0` registry row + M3-04 registration status), `model-gateway.md` (mock worker not a provider role; real binding must declare the Python floor + cloud-speech clearance rules).

### Verdict: M3-04 ACCEPTED WITH NOTES / CLOSED

The worker process boundary is live with the trust stack intact end-to-end: the child is spawned shell-less into a repo-external cwd, speaks a fail-closed exact-field wire, cannot lower a label, cannot leave an orphan, cannot write the repo tree, and cannot be pointed at an arbitrary executable — and every failure class dies into a replayable session. Four M3 slices, four clean countersigns. **Next: gate the M3-05 brief** (the natural candidate is now the first REAL speech worker/provider slice — which must carry: cloud-speech data-clearance + audio-egress rules per data-governance, provider conformance per model-gateway, the Python version floor carry-in, and the §2 compact channel-id framing decision if real audio flows; alternatively VAD/endpointing or two-lane can precede it. The per-gate M3 trust property stands; the M2 deferral landing gates remain in force).
