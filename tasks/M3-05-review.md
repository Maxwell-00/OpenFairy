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
