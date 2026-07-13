# M3-06 Brief Gate — faster-whisper local ASR worker + offline model environment

Gate date: 2026-07-13
Reviewer role: task-brief gate (spec fidelity + invariants). **Not** an implementation review — M3-06 is unbuilt.
Brief under review: `tasks/M3-06-faster-whisper-local-asr.md` (ChatGPT draft, gated from the working tree pre-commit; integrity-checked — 1680 lines, no NUL/mojibake, complete tail)
Repo state: M3-05 closed (`a2d7f6e` delivered, countersigned; docs pass landed at `e9e88ec`).

Method: gated inline. External fact verified via web search: the full immutable Hugging Face revision for `Systran/faster-whisper-small` short `536b066` is **`536b0662742c02347bc0e980a01041f333bce120`** (confirmed from the HF commit page URL; patched into §7.1). Repo-side anchors held from the M3-05 close (coordinator carry-in text, per-worker scan doctrine, `packages/artifacts` conditions, `speech.asr.final` schema requirements).

---

## Verdict

**ACCEPTED WITH REQUIRED EDITS (small) — edits applied in place.**

The slice is cut right and the drafter has now internalized every standing doctrine unprompted: the M3-05 coordinator carry-in is resolved as a mandatory extraction with a hard `server.ts` net-decrease condition; per-worker source scans extend to a three-family split (mock / MiniMax / faster-whisper) plus a **separate setup-downloader vs runtime-worker capability split** (downloader may touch the pinned HF repo once; runtime is fully offline with `HF_HUB_OFFLINE=1`); the model is pinned by immutable revision + per-file SHA manifest with alias loading (`WhisperModel("small")`) forbidden; uv gives a locked, repo-external, gateway-never-runs-it dependency contract; CI splits deterministic conformance from dependency smoke and never downloads a model; audio still never crosses NDJSON; and the owner check closes a poetic loop — Fairy transcribing her own first spoken words.

Four edits applied; all twenty §23 questions answered below.

## BLOCKER

None.

---

## REQUIRED EDITS (applied in place)

### RE-1 — Full immutable revision filled (§7.1)

`<EXACT_FULL_HF_COMMIT>` → `536b0662742c02347bc0e980a01041f333bce120`. The setup downloader must verify the resolved commit equals this SHA before writing the cache, and the generated per-file SHA-256 manifest is what the runtime loader trusts thereafter.

### RE-2 — `asr.request` approved with conditions (§11.1)

Approved as a durable worker-plane wire kind: no existing kind fits (`asr.script` is mock-only; `utterance.start` + audio frames is the M3-07 streaming path). Conditions: golden valid/invalid fixtures; the docs proposal updates the wire↔frame mapping table marking `asr.request` as the durable **non-streaming artifact-backed** request kind alongside `tts.request`; no synonymous kind ever.

### RE-3 — Owner keyword-check hygiene (§17.4)

Normalize case/whitespace; tolerate benign ASR variants of `M3-05`; and any scripted check targeting `你好` follows standing rule M2-05c (fully-ASCII script with `\uXXXX` escapes — never raw CJK through a Windows terminal). The conformance smoke must not fail on orthography or, worse, false-pass through terminal mangling.

### RE-4 — No canonical payload additions (answers Q20)

Detected language / probability / duration / segment count stay at wire/ack/evidence level. The emitted `speech.asr.final` uses exactly the registered required fields; `audio_ref` points at the input artifact. Future ASR metadata in canon is a separate additive schema+fixture change through the docs process.

---

## Answers to the brief's §23 gate questions

1. **faster-whisper first: YES.** FunASR/SenseVoice bring VAD/streaming/emotion surface that belongs to M3-07+/M3-13; deferring them is scope discipline, not rejection. The zh/en/mixed benchmark at M3-13 chooses defaults by measurement, as evals.md always said.
2. **`faster-whisper==1.2.1`: YES** — pinned in `pyproject.toml`, hash-locked in `uv.lock`.
3. **CPU/int8 only, CUDA deferred: YES.** Conformance needs determinism and installability, not speed; GPU workers are the §9 remote-box future.
4. **Multilingual small: YES** — the smallest profile that honestly exercises zh+en for the owner fixture.
5. **Revision: `536b0662742c02347bc0e980a01041f333bce120`** (RE-1).
6. **Profile + per-file SHA manifest: YES, sufficient** for this slice's supply-chain control — immutable revision at download, local manifest at every load, no aliases, no tokens, no remote-code.
7. **uv `0.11.28`: YES; CI pins it exactly.** Owner machine documents the same version in the setup instructions; drift is a work-report note, not silent.
8. **uv project + committed `uv.lock` + external `UV_PROJECT_ENVIRONMENT`: YES.** No repo `.venv`, no Conda-base mutation, no requirements.txt shadow lock, gateway never runs uv. This matches the owner's environment doctrine (conda/uv habits, Python side only).
9. **Dependency smoke on both OSes: YES** — `uv sync --locked` + import probe + version print, `HF_HUB_OFFLINE=1`, no model, no inference. Installability is exactly the thing CI can prove without weights.
10. **Coordinator shape: YES as specified.** Owns provider routing/clearance/staging/worker lifecycle/results/cleanup; does not own TurnRunner, dispatch, auth, or the voice→turn methods. `server.ts` stays the composition root.
11. **`server.ts` net-decrease as HARD acceptance: YES.** It is crude and that is its virtue — the M3-05 carry-in exists because the file absorbed +607 lines over two slices; moving the TTS orchestration out makes the decrease structurally achievable, and before/after counts + a responsibility table are cheap evidence. If Codex hits a genuine wall it stops and reports rather than self-waiving.
12. **`asr.request`: APPROVED** (RE-2).
13. **`input` artifacts, WAV + MP3 MIME: YES.** WAV support in `packages/artifacts` is additive under the same conditions as M3-05's MP3 (no registry rewrite; perception untouched). TTS `speech` artifacts must be explicitly re-imported as `input` — no silent kind-crossing.
14. **Private gateway staging over direct artifact paths: YES.** The worker never learns the store layout; same boundary philosophy as M3-05's output direction, reversed.
15. **Lazy warm-up + worker reuse: YES for this slice**; §9 warm pools and prewarming belong to the latency work.
16. **Forced termination on non-interruptible inference: YES** — consistent with M3-04 semantics; conditions: no `turn.input`, no model call, replayable session, PID-disappearance + zero-residue checks.
17. **Limits/bounded diagnostics: YES**; exact values are Codex Decisions.
18. **M3-05 MP3 as the owner fixture: YES, preferred.** TTS output → explicit re-import as `input` → ASR transcription is a genuine end-to-end loop with zero new recording apparatus.
19. **Keyword containment over WER/CER: YES** (with RE-3's normalization + escape rules). WER/CER is M3-13's job.
20. **Schema compatibility: no conflict — by decision** (RE-4): no canonical payload additions in M3-06.

---

## CARRY-IN

- **M3-05 speech-coordinator carry-in: SETTLED by this brief** (§5, hard conditions). The countersign verifies the extraction moved M3-05 TTS semantics unchanged (existing `voice.tts-provider-v0` stays green, not weakened) and the net decrease.
- M2 deferral landing gates: none lands at M3-06. No vector work. (S4 keeps accumulating from owner voice sessions.)

## NIT

- The dependency smoke installs ~100–200 MB of wheels per CI run; if it becomes the slowest lane, caching `uv`'s wheel cache is a future CI nicety, not a requirement.
- `av`/`ctranslate2` are native **wheels** — no build step, so no `pnpm approve-builds`-class concern; the work report should confirm wheels-only resolution on both OSes (`--only-binary` behavior or lockfile evidence).
- The three-worker-family scan split (mock stdlib-no-network / MiniMax stdlib-HTTPS-pinned / faster-whisper third-party-offline) is becoming a doctrine worth a voice-pipeline docs line at countersign.

---

## Reviewer-gate clauses for the delivery countersign

1. Coordinator extraction: M3-05 TTS orchestration moved semantically unchanged (suite green, unweakened — diff-checked); `server.ts` net line decrease vs `e9e88ec` with before/after counts; no provider logic left in `server.ts`; no second loop. (§5, Q10/Q11)
2. Model pinning: profile revision equals `536b0662…f0fa2`-full SHA (RE-1 value); setup verifies resolved commit; runtime loads local dir only (no alias, no HF token, no remote-code); per-file manifest verified at load; `HF_HUB_OFFLINE=1` in runtime worker env; runtime worker source scan forbids network modules entirely. (§7, §12)
3. uv contract: committed `pyproject.toml` + `uv.lock`; CI pins uv 0.11.28 exactly; external env; gateway never invokes uv; no pip/`uvx`/requirements.txt. (§6)
4. `asr.request` fixtures + mapping-table update; `asr.script`/`utterance.start` untouched; no canonical payload additions (`speech.asr.final` exact registered fields, `audio_ref` = input artifact). (RE-2/RE-4)
5. Staging boundary: worker receives token + metadata only (no absolute paths/bytes/base64); traversal/symlink/hash/size/MIME rejection mirrors M3-05's `speech-artifact` checks in the input direction; effective labels = artifact labels × voice floor × advisory clamp (raise-only), `canRouteToClearance` before any worker spawn, zero staged bytes on denial. (§9)
6. Deterministic backend: code-enforced flag (NODE_ENV/CI gate), config/CLI/wire cannot enable; `backend:` honestly identified in ready; deterministic suite exercises the full gateway path, not a bypass. (§12)
7. Cancel/crash/timeout/malformed: forced termination acceptable; no `turn.input`, no model call, replayable sessions, PID + temp-root + staging cleanup asserted per class. (§13, Q16)
8. Standing invariants: one TurnRunner; single `#submitVoiceFinalTranscript`→`#acceptTurnInput` path; mock + MiniMax workers and their scans byte-identical; all prior suites green; no docs/docs-zh edits; no `.only`/`.skip`; suite name `voice.asr-local-v0` only; tsx world; weakening scan across all pre-existing tests (esp. `voice.tts-provider-v0` through the extraction).

## Dispatch instruction

Owner: this brief was gated from the working tree — commit it together with this gate record via GitHub Desktop, then dispatch to Codex. The two structural risks worth watching at delivery are the coordinator extraction (the first time M3 code is *moved*, not added — the weakening scan earns its keep) and the offline-loading discipline (an alias or a stray hub call is the difference between "pinned supply chain" and "CI-invisible network dependency"). With the edits in: dispatch-ready.
