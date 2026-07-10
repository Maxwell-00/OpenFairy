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
