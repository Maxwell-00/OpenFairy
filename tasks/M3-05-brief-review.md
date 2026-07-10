# M3-05 Brief Gate — MiniMax T2A v2 non-streaming TTS worker + governed audio artifacts

Gate date: 2026-07-10
Reviewer role: task-brief gate (spec fidelity + invariants). **Not** an implementation review — M3-05 is unbuilt.
Brief under review: `tasks/M3-05-minimax-tts-provider-v2.md` (ChatGPT v2 draft, committed at HEAD `dd420fb`)
Repo state: M3-04 closed (`e3e8089` delivered, countersigned; docs pass landed at `bce1d65`).

Method: gated inline. Decisive checks verified directly at HEAD: `artifact.created.v1.json` payload schema (the `kind` field is **not in the canonical schema at all** — it rides as an M2-06 additive free field under `additionalProperties: true`), `packages/perception/src/index.ts:13` (`kind: "input" | "perception"` is a TypeScript union, not a schema constraint), `docs/specs/` listing (12 specs — **no `config.md`**), and `docs/` root (PRD/ARCHITECTURE/ROADMAP live under `docs/`).

---

## Verdict

**ACCEPTED WITH REQUIRED EDITS (small) — edits applied in place. This is the best-drafted brief of the project so far.**

The architecture dispute is settled on the record: this reviewer's earlier TS-direct-adapter suggestion is **withdrawn** — voice-pipeline §7/§9 put speech-provider I/O in gateway-supervised workers, a TS cloud path would have created a second provider execution world and split conformance, and the Python floor lands here exactly as the M3-04 landing gate recorded. The v2 revisions (closed endpoint profiles, `regions: [cn]` clearance fix, 2056-as-quota-not-auth, provider-invalid vs adapter-unsupported fake boundary, exact success contract, `tts.request` reuse, 3000-char pre-I/O ceiling, credential-class-agnostic Token Plan handling) are all endorsed — several are the drafter catching its own historical blind-spot classes unprompted.

Four small edits were required, one of them the mirror image of this seat's own recorded lesson.

## BLOCKER

None.

---

## REQUIRED EDITS (applied in place)

### RE-1 — Read-list paths corrected (cosmetic)

`ROADMAP.md`/`PRD.md`/`ARCHITECTURE.md` → `docs/ROADMAP.md`/`docs/PRD.md`/`docs/ARCHITECTURE.md`.

### RE-2 — `docs/specs/config.md` does not exist (existence-claim error, the inverted M3-01 lesson)

The brief referenced a nonexistent spec twice (read list + docs proposals). Verified by `ls-tree`: 12 specs, no `config.md`; the project has no dedicated config spec — keys register in their owning feature spec (standing convention since M2). Removed from the read list; the docs-proposal entry now routes speech provider/role config-key registration into `voice-pipeline.md`.

### RE-3 — Proxies explicitly disabled (decision on the brief's open question)

§5.3 left proxy env passthrough as "unless the gate explicitly approves." Decided: **not approved.** Proxy env vars are excluded from the deliberately-constructed child environment, AND the worker disables proxies in code (Python `urllib` honors proxy env by default — a clean environment alone is not a guarantee). Direct connection only this slice; a proxy-aware path is a future explicit decision.

### RE-4 — Per-worker static-scan scoping

The M3-04 import scan on `mock_worker.py` (forbids socket/network/subprocess/audio) stays byte-identical; `minimax_tts_worker.py` gets its own scan allowing the stdlib HTTPS client it needs (`urllib`/`http`/`ssl`) while still forbidding direct `socket`, `subprocess`, audio/device modules, vendor names, and non-stdlib imports. The provider worker's network allowance must never be achieved by weakening the mock worker's guard.

---

## Answers to the brief's §16 gate questions

1. **TTS-only as first real-provider slice: YES.** Smallest independently closable vertical slice; egresses governed visible text rather than user voice audio; settled in the planning round.
2. **Python speech-worker boundary retained: YES.** The reviewer's TS-direct suggestion is withdrawn on the record (see Verdict). One provider execution world, per voice-pipeline §7/§9.
3. **Model subset `speech-2.8-turbo`/`speech-2.8-hd`, non-streaming hex, system voice, MP3 defaults: YES.** Turbo default for interactive latency is right; do not widen.
4. **≤3000 text ceiling: YES.** Two-layer contract (provider hard <10000, adapter ≤3000 per official streaming recommendation) is correct; pre-I/O rejection with the text turn preserved is the load-bearing part.
5. **Closed endpoint profiles: YES.** Same philosophy as the M3-03 binding ruling: a config key that can widen a network surface is a standing hole. Backup as an explicit configured candidate, never invisible retry — endorsed.
6. **Clearance example with `residency: [region-restricted, global-ok]` + `regions: [cn]`: YES, valid.** Balanced voice-floored text (`personal/region-restricted(home)`, home `[cn]`) routes via the regions check; ordinary `global-ok` text routes; `local-only` and `secret` correctly deny. Owner declares regions; hostnames imply nothing.
7. **hex → worker temp file → gateway artifact flow: YES.** Audio bytes never cross stdio or JSONL; the §5.7 ten-step lifecycle with traversal/symlink/hash/size rejection is the right shape.
8. **§2 compact framing deferred: YES.** No client/gateway stream exists in this slice; the framing decision stays bound to the first real streaming-audio slice (expected M3-07), as recorded at M3-03/M3-04. "Do not silently invent an interim binary frame" — kept.
9. **Artifacts: neutral `packages/artifacts` extraction — APPROVED (option 1).** Verified: `artifact.created.v1.json` has no `kind` constraint (additive free field, `additionalProperties: true`); the `"input" | "perception"` union is TypeScript-only. Adding `"speech"` is a type-union + directory + MIME addition — no canonical schema change at all. Hard conditions: pure extraction (perception behavior and its tests unchanged — the countersign weakening scan will diff them), perception consumes/re-exports the neutral package, scope is exactly "move + speech kind + `audio/mpeg`/`.mp3`" — any registry-logic rewrite in the diff is scope creep and gets bounced. `packages/artifacts` must not be imported by `packages/protocol` (dep-cruiser rule 1 direction).
10. **Owner live Token Plan call mandatory for final close: YES.** M2 tradition stands: real-provider manual checks are irreplaceable; CI stays keyless with the fake. A `2056` outcome records `token_plan_resource_limit` and leaves live close pending — never claimed from the fake.
11. **Python 3.11 floor lanes on both OSes: YES.** Both, scoped to the focused suites; normal-discovery coverage retained independently; no patch pin. This settles the M3-04 named carry-in.
12. **Error classification without new event types: YES.** Bounded internal categories via existing types (`progress.update` stage strings per the `egress.denied`/`voice.worker.failed` precedent); no code authorizes routing/declassification/retry.
13. **Provider metadata retention: nothing beyond bounded, redacted trace ID + internal category, as support diagnostics only** — never canonical, never authorization. As §5.3 already states; no expansion.
14. **64 MiB response / 32 MiB decoded-audio caps: ACCEPTED.** Generous (~7× headroom over a 3000-char MP3) but they are DoS ceilings, not targets — bounded and validated is what matters. Codex may propose tighter values in Decisions.

---

## CARRY-IN

- M3-04 Python-floor carry-in: **settled by this brief** (§5.9) — the landing gate recorded at M3-04 close is discharged here; countersign verifies enforcement (probe rejection, handshake mismatch rejection, CI lanes).
- M2 deferral landing gates: none lands at M3-05. No vector work.
- New for this slice's countersign: TTS artifact labels derive from the synthesized visible text's labels (§5.7/Case D — present in the brief; verify non-vacuously).

## NIT

- `aigc_watermark: false` is an owner decision appropriate for local personal artifacts; if TTS audio is ever distributed beyond the owner's machines, revisit against CN synthetic-content marking rules. One line for the record, no action.
- `voice_id: male-qn-qingse` is a placeholder owner preference — config, not architecture.
- The credential env var name `FAIRY_MINIMAX_T2A_TOKEN` deliberately does not use the `FAIRY_SECRET_*` prefix (avoiding broad-set inheritance) — good; the work report should state this naming rationale so it doesn't look accidental.

---

## Reviewer-gate clauses for the delivery countersign

1. Credential hygiene: fake credential seeded and proven absent from argv/NDJSON/JSONL/stdout/CLI JSON/errors/fixtures/artifact metadata; child env deliberately constructed; single narrow env var; Authorization header redacted everywhere. (§5.4)
2. Proxy disable proven in code (opener with proxies off) AND env exclusion; endpoint profiles closed with the test seam unreachable from production config/CLI. (RE-3, §5.1/5.3)
3. Per-worker scans: mock worker's scan byte-identical; provider worker's scan present with the allowed/forbidden module split. (RE-4)
4. Python floor: probe rejects <3.11 with named error; handshake version-mismatch rejection; CI 3.11 lanes green on both OSes; `FAIRY_TEST_PYTHON` still test-only literal argv0. (§5.9)
5. Zero-byte denial: under-cleared provider gets zero connections (counting fake server), fallback exactly once, per-candidate at-most-once, no auth/quota/safety retries. (§5.2, Case C/E)
6. Success contract enforced field-by-field (status_code 0, data.status 2, hex validity/evenness, decoded-size vs audio_size, metadata echo, SHA-256 match); no HTTP-200-equals-success shortcut. (§5.6, Case D)
7. Artifact extraction is pure: perception tests unchanged (weakening scan), no registry rewrite, speech kind additive TS-only, `speech.tts.chunk.audio_ref` resolves in replay; temp lifecycle leaves zero residue in all failure classes; artifact labels inherit visible-text labels (non-vacuous assertion). (§5.7, Case D/F)
8. `tts.request` reused (no synonymous kind); `tts.script` untouched mock-only; wire mapping table in the work report; worker never emits canonical events directly. (§5.5)
9. TTS receives only visible final text — Case G fixture actually contains hidden reasoning/tool trace/audit/denied secret and the fake server asserts their absence from the request body. (Case G)
10. Standing invariants: one TurnRunner; single voice→turn path; no new canonical event families (registry diff clean); no vendor SDKs; no pip deps; corrupt-tail byte-identical; no repo-tree writes; tsx world; source-first exports for `packages/artifacts`; weakening scan across all pre-existing tests (esp. perception + M3-04 worker suite).

## Dispatch instruction

Owner: diff both files (`tasks/M3-05-minimax-tts-provider-v2.md` patched in place, this gate record new), commit via GitHub Desktop, then dispatch to Codex. This is the first slice where a real credential, a real network egress, and real provider bytes exist — the countersign will be correspondingly heavy on §5.4/RE-3/Case B evidence. With the edits in: dispatch-ready.
