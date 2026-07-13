# M3-05 Final Primary Review

**Task:** M3-05 — MiniMax T2A v2 non-streaming TTS worker + governed audio artifacts  
**Gated baseline:** `1fc2f98a8440bfdbab27a05076ec3d9fdf35b68e`  
**Main implementation commit:** `80726ea3f32179491999fbfc5081bce1577fa9a1`  
**CI invocation repair:** `0512c530da7d6350edabd81f4f8f287a9ccea6d4`  
**Owner-evidence ACK repair:** `a2d7f6e380918a16db0c3b2a480675e3a036ba6e`  
**Owner evidence commit:** `68e9b93998cdfd88bde1741b888cd3f8db3537af`  
**Implementation CI:** `29198783063` — PASS  
**Owner-evidence CI:** `29233777667` — PASS  
**Verdict:** **ACCEPTED WITH NOTES**  
**Primary status:** **CLOSED**  
**Remaining workflow:** Fable/Opus code-level countersign and reviewer-owned English docs pass

---

## 1. Final decision

M3-05 is accepted and closed at the primary-review stage.

The implementation and committed owner evidence establish the first real speech-provider slice:

- MiniMax T2A v2 synchronous non-streaming TTS;
- gateway-supervised Python provider worker;
- raw HTTP with no vendor SDK and no pip dependencies;
- closed endpoint profiles;
- narrow credential delivery;
- explicit proxy disablement;
- provider clearance and egress before I/O;
- zero-byte denial for under-cleared providers;
- Python `>=3.11` enforcement and dual-OS floor lanes;
- field-by-field provider success validation;
- bounded response/audio handling;
- temporary-file confinement and cleanup;
- content-addressed speech artifacts;
- canonical `speech.tts.chunk.audio_ref`;
- replay preservation;
- one real owner MiniMax Token Plan request.

No implementation or owner-evidence BLOCKER remains.

---

## 2. Findings

### BLOCKER

None.

### CARRY-IN — M3-05-C1: speech orchestration file-size pressure

`apps/gateway/src/server.ts` and `apps/gateway/src/speech-worker-process.ts` are now large composition/supervision units.

Do not refactor them retroactively in M3-05. For the next real speech-worker/provider slice:

- if another substantial provider/ASR path adds roughly 200–300 lines of orchestration to `server.ts`, evaluate extracting a gateway-owned `SpeechRuntime` or `SpeechProviderCoordinator`;
- if another worker family materially expands `speech-worker-process.ts`, evaluate separating codec/validation from generic process supervision;
- any extraction must preserve one TurnRunner, one gateway execution world, and gateway ownership of workers.

This is a maintainability landing gate, not a closure blocker.

### NIT — M3-05-N1: replay evidence file is not strict JSON

`replay.json` contains the Node SQLite experimental warning before the JSONL replay records because stderr was merged into stdout.

The replay evidence is still readable and proves the canonical `speech.tts.chunk.audio_ref`, but future owner scripts should:

- capture stderr separately; or
- filter warning lines before writing a file named `.json`.

### NIT — M3-05-N2: raw CLI evidence retains local session paths

`cli.json` and `cli-raw.txt` include the local `log_path` and replay data-directory path.

They do not contain the MiniMax credential, Authorization header, raw provider response, or artifact absolute path. This is not a security blocker, but future owner evidence should prefer a bounded projection that omits workstation paths unless they are necessary for review.

### NIT — M3-05-N3: CI action runtime warning

All four CI jobs pass, but GitHub reports that `pnpm/action-setup@v4` targets deprecated Node 20 and is being forced onto Node 24. Handle this as repository CI maintenance outside M3-05.

---

## 3. Final acceptance matrix

| Area | Result | Evidence |
|---|---|---|
| Scope discipline | PASS | No ASR, microphone/speaker, playback, VAD, streaming framing, lanes, barge-in, benchmarks, tray, or M4 work. |
| Provider execution boundary | PASS | MiniMax runs in the gateway-supervised Python speech worker; no second TS-direct provider path. |
| One TurnRunner | PASS | Existing voice final → existing turn path → visible final → TTS. |
| Python worker hygiene | PASS | Standard library only, ASCII-only, `-u -B`, `shell:false`, repo-external cwd, bounded stdio/lifecycle. |
| Python floor | PASS | Python `>=3.11` enforced; Ubuntu and Windows Python 3.11 lanes green; normal discovery retained. |
| Closed endpoint profiles | PASS | `cn-primary` / `cn-backup`; no arbitrary production URL or proxy path. |
| Credential hygiene | PASS | Narrow child env; owner scan records zero credential/header leaks. |
| Proxy discipline | PASS | Proxy env excluded and Python proxy handler disabled. |
| Provider clearance | PASS | Under-cleared provider gets zero connections/request bytes; deterministic fallback is explicit. |
| Speech egress | PASS | Egress is checked before provider I/O. |
| Visible-only TTS | PASS | Hidden reasoning/tool/audit/denied-secret fixtures excluded from provider body. |
| MiniMax request subset | PASS | Supported models, system voice, non-streaming hex, MP3/32k/128k/mono. |
| Success contract | PASS | `base_resp.status_code == 0`, `data.status == 2`, valid hex, matching metadata/size/hash. |
| Error classification | PASS | Required MiniMax provider classes and retry rules covered. |
| Artifact extraction | PASS | Neutral source-first artifact package; perception behavior preserved; speech MP3 supported. |
| Temp-file safety | PASS | Fixed token, traversal/symlink/non-file/hash/size/format checks and cleanup. |
| Canonical discipline | PASS | One `speech.tts.chunk`; no vendor/worker event family; audio bytes absent from JSONL. |
| Artifact labels | PASS | `personal / region-restricted`, inherited from visible final rather than reset to public. |
| Replay | PASS | Replay contains `speech.tts.chunk` with `art_dab01c1e7ff96621969c`. |
| Deterministic suite | PASS | `voice.tts-provider-v0`: 13/13. |
| Implementation CI | PASS | Four job classes green at `29198783063`. |
| Real MiniMax request | PASS | Exactly one request, route `minimax-owner-live:selected`, no hidden retry. |
| Live provider success | PASS | Bounded ACK confirms both success conditions. |
| Live artifact | PASS | MP3, 76,020 bytes, valid header, matching SHA-256, owner-confirmed intelligible. |
| Leak scan | PASS | Zero credential/header/provider-envelope/audio-encoding/temp-token findings. |
| Process cleanup | PASS | Checked PIDs gone; zero new temporary roots. |
| Owner-evidence CI | PASS | Four job classes green at `29233777667`. |

---

## 4. CI evidence

### Implementation CI

Run `29198783063` passed:

- Ubuntu normal discovery;
- Windows normal discovery;
- Ubuntu Python 3.11 speech floor;
- Windows Python 3.11 speech floor.

### Owner-evidence CI

Run `29233777667` passed the same four job classes after commit `68e9b93`.

The evidence commit adds only files under `tasks/owner-checks/M3-05/`; it does not alter implementation code.

---

## 5. Owner evidence

The owner evidence records:

- implementation/repair target `a2d7f6e`;
- MiniMax Token Plan credential class;
- available speech resources before the call;
- one selected provider route;
- one real provider request;
- no fallback/retry;
- endpoint profile `cn-primary`;
- model `speech-2.8-turbo`;
- successful MiniMax envelope checks;
- one canonical TTS chunk;
- speech artifact `art_dab01c1e7ff96621969c`;
- MP3 byte count `76020`;
- SHA-256 `sha256:dab01c1e7ff96621969c06ed38778632ac348e203ecbf242468516a24f1f0fa2`;
- owner confirmation that the generated MP3 was intelligible;
- zero public/persistent credential, Authorization, provider-envelope, audio-hex, audio-base64, or worker-token findings;
- checked worker PIDs terminated;
- zero new temporary roots;
- replay preserving the artifact reference.

The generated MP3, raw provider response, Token Plan credential, artifact registry, and artifact absolute path were not committed.

---

## 6. Architecture confirmation

M3-05 preserves the accepted architecture:

- speech provider routing and roles are separate from model roles;
- provider-specific logic remains at the provider worker/adapter boundary;
- the gateway owns worker supervision, credentials, clearance, egress, artifacts, and canonical events;
- `tts.request` is reused;
- `tts.script` remains mock-only;
- binary audio never crosses stdio or enters JSONL;
- non-streaming audio becomes a local content-addressed artifact;
- compact channel-ID streaming framing remains deferred;
- no second TurnRunner or provider execution world was introduced.

---

## 7. Closure

**Final primary verdict: ACCEPTED WITH NOTES.**

**M3-05 primary review is CLOSED at owner evidence commit `68e9b93`.**

No further Codex implementation work or owner live checks are required for primary closure.

Remaining workflow:

1. Fable/Opus performs the code-level countersign.
2. Reviewer applies the approved English docs pass.
3. The countersign/docs-pass commit becomes the authoritative M3-05 close commit.
4. Proceed to the gated M3-06 task.

---

## Countersignature — Claude (Fable 5), 2026-07-10

Code-level cross-check delegated to an opus subagent (13-item checklist over the cumulative diff `1fc2f98..a2d7f6e`, file:line evidence, reads via `git show` only); the two highest-stakes surfaces (the `governance.ts` refactor and the worker's proxy/TLS code) additionally spot-checked directly by this reviewer. **13/13 PASS, zero FAILED/PARTIAL/vacuous items material; all 10 reviewer-gate clauses from the brief gate confirmed in code.**

### The two hot spots

- **`packages/model-gateway/src/governance.ts` (±21, M2-frozen territory): PASS — pure parameterization.** `canRouteToModel` now delegates to a new exported `canRouteToClearance(labels, clearance, governance, hints)`; the sensitivity-rank, residency-set, region-set, and `prefer_local` logic are byte-for-byte the same expressions with only the accessor path changed (`model.data_clearance.X` → `clearance.X`); reason strings unchanged; pre-existing model-gateway/governance/label suites untouched; the registry is SHA-256-pinned byte-identical in the test. This is exactly how "speech providers share one clearance law" should have been built — no fork, no copy.
- **Perception extraction: PASS — verbatim move.** Registry logic moved unmodified to `packages/artifacts` (hash, `art_` ids, path guard, register/list/get); additive deltas only (`speech` kind, `audio/mpeg`/`.mp3`, `speech/` directory); `packages/perception/test/**` **byte-identical** (empty diff, additionally SHA-256-pinned by the new suite); perception's public API preserved via extension/re-export; consumers (cli, tools-std) unchanged; `packages/protocol` does not import `@fairy/artifacts` (grep + guard test).

### Gate clauses (all confirmed; highlights)

- **Credential hygiene:** `secret://` resolved gateway-side; single narrow `FAIRY_MINIMAX_T2A_TOKEN`; allowlist child env (proxy vars excluded); redaction proven **non-vacuously** — the fake error envelope embeds the credential in `status_msg` and it is asserted absent from every surface (rawLog/artifact registry/CLI/public errors).
- **Proxy/network:** `ProxyHandler({})` + `NoRedirectHandler` + `ssl.create_default_context()` in worker code (spot-checked); the proxy test pollutes all 8 proxy env vars and still gets exactly one direct request; endpoint profiles closed with the loopback seam double-gated (worker `FAIRY_PROVIDER_TEST_MODE` + supervisor test/CI check); config rejects raw URLs.
- **Per-worker scans:** `mock_worker.py` byte-identical (SHA-pinned); the provider worker's own scan allows `urllib/http/ssl` and forbids `socket`/`subprocess`/audio/vendor; imports are exactly `{hashlib, json, os, re, ssl, sys, time, urllib.error, urllib.request}`; ASCII-only.
- **Python floor (M3-04 carry-in DISCHARGED):** `SPEECH_WORKER_PYTHON_UNSUPPORTED` on `<3.11` at probe AND handshake; `python-311-speech` CI lanes on both OSes scoped to the focused suite; no patch pin.
- **Zero-byte denial:** transport-level — `primary.connections === 0` counted at the fake server's `connection` event, not merely zero requests; fallback exactly once; the retryability taxonomy classifies auth/quota/balance/safety/parameter/voice/rate-limit as non-retryable with per-class fixtures (2056 → `token_plan_resource_limit`, one request, no retry).
- **Success contract:** field-by-field including MP3 magic-byte check; SHA-256 verified twice (worker report + gateway re-hash); HTTP 200 alone is never success.
- **Artifact lifecycle:** traversal/symlink/non-regular/realpath-escape/TOCTOU (re-stat size+mtime+ino)/hash/size/format all rejected with distinct codes and individually exercised; labels inherited from the visible text and asserted on the registered record; zero residue across all seven failure classes; `audio_ref` resolves in replay. The "exactly one chunk" invariant is triple-layered (worker, supervisor, gateway).
- **TTS visibility (Case G):** poison fixtures (`HIDDEN_REASONING_M305`/tool trace/audit/denied secret/`sk_test_…`) actually seeded, request body asserted equal to the exact supported subset, raw body asserted free of every marker.
- **Invariants:** one production TurnRunner (test-asserted `=== 1`); single voice→turn path with TTS keyed off `submitted.assistantFinalText` after it; no new canonical event types; only pre-existing test file touched is `apps/cli/test/voice.test.ts` (additions-only); no docs changes; suite name `voice.tts-provider-v0` only.

### Notes for the record

1. **`a2d7f6e` micro-fix:** binds the ack's `success_checks` to the actual success-path evidence object instead of a hardcoded literal — a hardening (prevents false-success emission) with matching negative assertions added. Its work-report note covers the CI repair but not this micro-change; immaterial, noted for completeness.
2. **Worker connect/read deadlines are coalesced** (urllib's single socket timeout = min(connect, read), total enforced by a monotonic loop) — both configured bounds respected; acceptable under stdlib-only; recorded so the future streaming slice doesn't inherit the assumption unexamined.
3. **Owner-live evidence verified in content** (not just summarized): one request, `cn-primary`, turbo, `status_code 0` + `data.status 2`, one `speech.tts.chunk`, `art_dab01c1e…` (`speech`/`audio/mpeg`/76020 B, hash match, MP3 header valid, owner-confirmed playable), leak scans all zero, 2 PIDs gone, 0 temp roots, replay preserves `audio_ref` with labels `personal / region-restricted`. Two distinct CI runs (implementation `29198783063`, evidence `29233777667`), both 4 jobs green incl. the floor lanes. The primary review's NITs (SQLite stderr prefix in replay.json; workstation paths in cli.json) confirmed harmless.
4. **Primary review CARRY-IN endorsed and sharpened:** `server.ts` has absorbed +365 lines this slice on top of M3-04's +242; the next real speech slice's **brief gate should require a `speech coordinator` extraction decision** (own module or justified stay) before more provider logic lands in `server.ts`. Threaded to the M3-06 gate.
5. Docs proposals for `docs/ROADMAP.md`/`PRD.md`/`ARCHITECTURE.md` are **deferred to M3 exit consolidation** (milestone-level docs move at milestone gates, per M2 practice) — not lost, recorded here.

### Docs pass — applied with this countersignature

`voice-pipeline.md` (M3-05 status note: first real provider; **`speech.providers`/`speech.roles` config registration — this spec is the owning feature spec**; shared clearance law; floor settled; artifact pipeline; §2 framing still deferred), `protocol.md` (provider stdio non-canonical; `audio_ref` → local `art_*` artifact), `data-governance.md` (speech-provider egress as an enforcement point; zero-connection denial; label inheritance — synthesis never declassifies; credential/proxy rules), `model-gateway.md` (separate speech registry sharing `canRouteToClearance`; zero semantic change to model routing; floor settled), `evals.md` (`voice.tts-provider-v0` registry row + M3-05 registration status), `workers/speech/README.md` (rewritten: floor, both workers, provider hard rules, scan split).

### Verdict: M3-05 ACCEPTED WITH NOTES / CLOSED

Fairy spoke for the first time through a real provider — with the same discipline the text spine has carried since M2: the credential can't leak (poison-tested), the endpoint can't wander (closed profiles, proxies dead in code), an under-cleared provider never sees a byte (counted at the socket), the audio can't cross a boundary it shouldn't (artifact-backed, label-inheriting, replay-resolvable), and every failure class dies clean. Five slices, five countersigns, zero FAILs. **Next: gate the M3-06 brief** (local ASR worker per the agreed plan — faster-whisper/FunASR/SenseVoice pick one; it must carry: pip/uv dependency management decision for `workers/speech`, model download/caching strategy with CI staying mock, `speech.asr` role + clearance, ASR-side audio artifact input path, and the speech-coordinator extraction decision from note 4. The per-gate M3 trust property stands; M2 deferral landing gates remain in force).
