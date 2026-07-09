# M3-04 Brief Gate — Speech worker process scaffold + Python mock worker conformance

Gate date: 2026-07-09
Reviewer role: task-brief gate (spec fidelity + invariants). **Not** an implementation review — M3-04 is unbuilt.
Brief under review: `tasks/M3-04-speech-worker-process.md` (ChatGPT draft, committed at HEAD `68f6517`)
Repo state: M3-03 closed (`524dd33` delivered, countersigned; docs pass landed at `31732b2`).

Method: gated inline. Three decisive anchors verified directly at HEAD: voice-pipeline §9 ("Python workers under **gateway supervision**"), §2 line 31 (gateway⇄workers = "same duplex protocol over **local WS**"), and the voice-package source-scan guard (`packages/voice/test/index.test.ts:658` forbids `node:child_process` in `src/index.ts` — already relaxed once at M3-03).

---

## Verdict

**ACCEPTED WITH REQUIRED EDITS — edits applied in place.**

The slice choice (worker process boundary before real provider binding) is the right cut — providers bring cloud-speech clearance, keys, billing, and audio-egress rules all at once; getting process lifecycle, wire protocol, crash/timeout/cancel, and stderr hygiene stable first is exactly the ordering ROADMAP's M3 implies. And the draft itself is the strongest of the four M3 briefs so far: no-shell spawn with `shell: false` stated, deterministic interpreter discovery with deadlines, crash/timeout/orphan tests, bounded + redacted stderr, wire-labels-can't-lower-floor, no worker-wire types in JSONL, the `additionalProperties` sharp edge, N/A owner-check convention, and stdlib-only Python (dodging pip/conda/uv entirely). It even carries the M3-03 "unauthenticated voice port is forbidden" ruling into worker ingress unprompted.

Five edits were required — one reconciliation the draft half-acknowledged but didn't bind, two Windows/incident-class hardenings, and two standing-rule threads.

## BLOCKER

None.

---

## REQUIRED EDITS (applied in place)

### RE-1 — stdio vs voice-pipeline §2 "local WS": recorded reconciliation + wire↔frame mapping (MED)

§2 says gateway⇄speech-workers run "the same duplex protocol over local WS"; this brief's wire is stdio NDJSON. Fourth instance of the divergence pattern (M3-01 payload shapes, M3-02 frame names, M3-03 binary framing) — and as before, the divergence is fine, the silence is not. Notably, stdlib-only Python *cannot* reasonably speak WS (no stdlib client; hand-rolling RFC 6455 masking in a mock is waste), so stdio is the right v0 call — it just has to be recorded: stdio = v0 wire for locally-supervised child workers; §2's local-WS (with the M3-03 auth machinery) remains the transport for remote/decoupled workers (§9's remote-GPU-box case). Additionally the docs proposal must carry a wire↔frame mapping table that marks `asr.script`/`tts.script` as **mock-conformance-only** kinds (a real worker receives audio frames and synthesize requests, not scripts) so the v0 wire does not ossify mock semantics into the future real-worker contract.

### RE-2 — Windows stdio hygiene: CRLF + pipe-buffer deadlock (MED, incident-class)

NDJSON over Windows pipes has two classic failure modes the draft didn't preempt: Python text-mode stdout writes `\r\n` (TS reader splitting on `\n` gets a trailing `\r` that breaks `JSON.parse` — the M2-05 Windows-translation incident family, new venue), and unflushed stdout + undrained stderr deadlocks both processes on full pipe buffers (deadlines catch it late; the cause must be prevented). Edits: spawn Python with `-u`; worker writes each message via `sys.stdout.buffer.write(... + b"\n")` + flush, never bare `print`; no BOM; TS reader strips trailing `\r`; supervisor drains stdout and stderr concurrently from spawn.

### RE-3 — Supervisor placement: gateway-side, don't erode the voice-package guard (MED)

voice-pipeline §9 already answers where the supervisor lives: "Python workers under **gateway supervision**." Independently, putting it in `packages/voice/src/index.ts` would force a **second** relaxation of that file's source-scan guard (`:658`, forbids `node:child_process`; first relaxation at M3-03 was justified — a second for the same file starts eroding it). Edit: supervisor lives in `apps/gateway` or a dedicated module; the existing guard on `src/index.ts` stays byte-identical.

### RE-4 — `FAIRY_TEST_PYTHON` narrowly scoped (LOW)

The draft's test override is pragmatic but collides with the standing no-env-side-channel rule. Allowed narrowly: read only at supervisor construction, used only as `argv[0]` (never split/parsed as a shell string, never with `shell: true`), surfaced in test logs/JSON so evidence shows which interpreter ran, and explicitly not production config — production uses the fixed candidate list (`python3` → `python` → `py -3`, the last win32-only). Handshake `ready` echoes the Python version for diagnosability.

### RE-5 — Standing-rule threads (LOW)

- Crash tests follow §5.3: kill the worker process itself (direct child-pid kill or a scripted self-exit directive) — never a wrapper.
- Crash-before-final surfaces via existing types only: `progress.update` with a documented stage string (`voice.worker.failed`, following the `egress.denied` stage-string precedent) and/or the `error` envelope — no new canonical event type.
- Python source is ASCII-only: the encoding guard scans `.ts` and protocol `.json`, **not** `.py` — the rule must live in the brief because no tooling enforces it.

---

## CARRY-IN

- M3-03 standing rulings all threaded by the draft itself (auth/loopback rule extended to worker ingress in its own Context §7; single voice→turn path named; wire labels advisory).
- M2 deferral landing gates: none lands at M3-04. No vector work. (Next gate ahead remains S4 ≥20 real sessions at M4 entry.)

## NIT

- `workers/speech/` finally gets real content — note dep-cruiser rule 4 already whitelists it for vendor SDKs, which this slice must NOT use (stdlib-only); the whitelist is for future real workers, not a license here. Countersign will grep imports.
- The wire protocol id string `fairy.speech-worker.v0` is a good, versioned choice.
- Suite runtime: each E2E spawns a Python child; if CI time grows noticeably, share one worker across assertions within a test — Codex's call, not a requirement.

---

## Reviewer-gate clauses for the delivery countersign

1. Docs proposal contains the stdio-vs-§2 reconciliation AND the wire↔frame mapping table with mock-only kinds marked. (RE-1)
2. Python spawned with `-u`, binary-mode writes + per-message flush in the worker, TS reader strips `\r`, concurrent stdout/stderr draining — quoted at code level; Windows CI green is corroborating, not sufficient. (RE-2)
3. Supervisor is gateway-side (or dedicated module); `packages/voice/test/index.test.ts:658` guard byte-identical; no `node:child_process` in `packages/voice/src/index.ts`. (RE-3)
4. `FAIRY_TEST_PYTHON` used as argv[0] only, test-only, surfaced in evidence; production discovery = fixed candidates with deadlines + named errors; `ready` echoes Python version. (RE-4)
5. Crash tests kill the worker itself; crash path emits only existing event types (stage strings, no new types); Python source ASCII-only; stdlib-only import scan on the worker (no socket/network/audio/subprocess modules). (RE-5)
6. Standing invariants: one TurnRunner; single `#submitVoiceFinalTranscript`→`#acceptTurnInput` path; wire messages never in JSONL (grep `speech.worker.*`/`voice.worker.*` clean); label clamp on emitted events; no orphan processes after tests; no shell spawn anywhere; corrupt-tail byte-identical; no repo-tree writes; tsx world; weakening scan on all pre-existing test files.

## Dispatch instruction

Owner: diff both files (`tasks/M3-04-speech-worker-process.md` patched in place, this gate record new), commit via GitHub Desktop, then dispatch the patched brief to Codex. RE-2 is the one most likely to save a debugging round — CRLF-broken NDJSON and pipe-buffer deadlock are exactly the class of Windows failure this project has paid for before, and both are cheap to prevent at spawn time. With the edits in, this is the strongest-drafted slice of M3 so far — dispatch-ready.
