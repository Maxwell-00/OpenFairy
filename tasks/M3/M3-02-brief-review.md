# M3-02 Brief Gate — Duplex speech transport protocol + conformance interface

Gate date: 2026-07-09
Reviewer role: task-brief gate (spec fidelity + invariants). **Not** an implementation review — M3-02 is unbuilt.
Brief under review: `tasks/M3-02-duplex-speech-transport.md` (ChatGPT draft, committed at HEAD `29eb1a0`)
Repo state: M3-01 closed (`bf6896e` delivered, countersigned in `tasks/M3-01-review.md`, docs pass landed at `e12d567`).

Method: gated inline. Unlike M3-01, the decisive evidence for this brief was already in hand from this seat's M3-01 gate + countersign (voice-pipeline.md §2 read in full, frames precedent protocol.md §7, `packages/voice` exports, gateway turn-entry path, config schema, event registry). Remaining checks were small and verified directly: voice-pipeline §2 frame vocabulary (line 27), the single `#acceptTurnInput` construction site (`server.ts:751`, voice path via `submitFinalTranscript:878`), no existing `duplex` code anywhere, and the `voice` config block's `additionalProperties: true`.

---

## Verdict

**ACCEPTED WITH REQUIRED EDITS — edits applied in place.**

This is a markedly better draft than M3-01's was. Every M3-01 ruling and seat lesson is correctly threaded: registered schemas authoritative, no `mark_id` enum, `provenance: "user"` + `payload.channel: "voice"`, spoken-remember **hold** (`personal_default_hold` — the acceptance line collision is fixed this time), voice-pipeline.md acknowledged as existing, owner-check substitutions pre-negotiated ("if no standalone CLI smoke, record why"), encoding/tsx rules present, frames-vs-events separation stated, deferred benches never fake-passed, and no M2 deferral lands here (no vector work — the vector benchmark brief-gate precondition is not triggered). Scope matches the owner's stated intent exactly.

Six edits were still required — one of them load-bearing for trust.

## BLOCKER

None.

---

## REQUIRED EDITS (applied in place)

### RE-1 — Frame vocabulary must reconcile with voice-pipeline §2 (MED)

`docs/specs/voice-pipeline.md` §2 (line 27) already names the gateway⇄worker control frames: `start`, `partial`, `final`, `synthesize`, `cancel`, `mark`. The brief's suggested `VoiceControlFrame` kinds diverge (`tts.request` vs `synthesize`; adds `session.start/end`, `utterance.start`, `error`). The suggested names are arguably better — but the spec must not end up carrying two unreconciled vocabularies. Edit: the voice-pipeline docs proposal MUST include an explicit mapping/supersession table (spec §2 name ↔ implemented kind); final names in work-report Decisions.

### RE-2 — Frame-supplied labels never lower the floor (HIGH, trust)

The suggested frames carry `labels: Labels` on `session.start` / `utterance.start` / `tts.request`, and the brief never said who wins when frame labels disagree with the governance floor. This is the derivation-subtlety class this drafter historically misses — and here it is load-bearing: without a clamp, a buggy or hostile client could hand the transport `public / global-ok` frames and launder spoken content below the `personal` floor. Edit: frame labels are advisory metadata; effective labels derive gateway-side (profile floor + content escalation, one-way, exactly as M3-01); acceptance adds a clamp test asserted **on the emitted `speech.asr.final` and `turn.input`** (balanced profile + `public/global-ok` frame ⇒ `personal / region-restricted` + `prefer_local`).

### RE-3 — Single voice→turn envelope construction site (MED)

M3-01 landed exactly one construction path: gateway `submitFinalTranscript` (`server.ts:878`) → `#acceptTurnInput` (`:751`). The brief's Deliverable 4 said "emits the same canonical speech events as M3-01" but did not forbid a second envelope builder. Edit: the duplex path must reuse that chain (or refactor into a shared helper with justification); exactly one voice→turn construction site must remain.

### RE-4 — Frames discipline: golden fixtures + third-family statement (LOW)

protocol.md §7's precedent: transport frames are schema'd + fixture-tested (`packages/protocol/frames/` for the client⇄gateway op plane), deliberately outside the event registry. `packages/voice` is the right home for the worker-plane frames (they are not client protocol), but the discipline travels: runtime validation **plus golden valid/invalid fixtures**, and the docs proposal states voice duplex frames are a third frame family outside both the event registry and the client op-frame set.

### RE-5 — `voice` config block is `additionalProperties: true` (LOW, sharp edge)

Verified at HEAD (`packages/config/src/schema.ts:190-192`): an unregistered `voice.duplex.*` key would pass validation **silently** — "invalid values fail validation" is vacuously true for keys with no schema entry. Edit: any duplex config key needs an explicit schema entry with constraints, invalid-value tests, and voice-pipeline.md registration; `65536`/`64` marked as placeholders (Codex decides, documents in Decisions).

### RE-6 — Cancelled utterance leaves a replayable session (LOW)

Deliverable 3 specified cancel at worker level (suppress `asr.final` / remaining chunks) but nothing said what the *session* looks like after an ASR cancel in the conformance path. Edit: no `turn.input`, no dangling turn, cancellation visible via `speech.mark` / existing event types only; suite coverage adds a cancelled-utterance replay test.

---

## CARRY-IN

- M3-01 countersign notes are all threaded by the draft itself (hold semantics, floor, voice-pipeline existence, owner-check substitution lesson). Nothing further to thread.
- M2 deferral landing-gate check: none lands at M3-02. No vector work present. The next landing gate ahead is S4 ≥20 real sessions at **M4 entry** — voice dogfooding sessions during M3 accumulate toward it; nothing to enforce here.

## NIT

- `pnpm fairy voice conformance` vs the existing root `pnpm conformance` (provider conformance, 18/18 mock): mild namespace overloading of "conformance." Acceptable; the JSON output disambiguates. Codex may prefer `fairy voice duplex` — either is fine.
- Deliverable 6's grep acceptance ("no `voice.frame.*` / `speech.worker.*` event types in JSONL") is test-level on produced session logs — correctly scoped, no brief-self-match risk (standing rule §5.9 satisfied).
- The suggested `error` frame's `code` field: free string is fine at v0; if a taxonomy emerges, it belongs in the voice-pipeline docs proposal, not an enum in this slice.

---

## Reviewer-gate clauses for the delivery countersign

1. Frame-vocabulary mapping table present in the voice-pipeline docs proposal; final names in Decisions. (RE-1)
2. Frame-label clamp: gateway-side floor derivation is the single source of effective labels; clamp test asserts on emitted `speech.asr.final` + `turn.input`, non-vacuous. (RE-2)
3. Exactly one voice→turn envelope construction site (`submitFinalTranscript`→`#acceptTurnInput` or a justified shared-helper refactor); grep-verifiable. (RE-3)
4. Golden valid/invalid control-frame fixtures exist and are tested; no transport-frame types in JSONL or the event registry. (RE-4)
5. Any `voice.duplex.*` config has explicit schema entries + invalid-value tests + docs registration — nothing rides `additionalProperties: true`. (RE-5)
6. Cancelled-utterance session replayable, no dangling turn, no new event types. (RE-6)
7. Standing invariants: one TurnRunner; no vendor SDKs; no sockets/network/device/Python; corrupt-tail test byte-identical; no repo-tree writes; tsx world; weakening scan on all pre-existing test files.

## Dispatch instruction

Owner: diff both files (`tasks/M3-02-duplex-speech-transport.md` patched in place, this gate record new), commit via GitHub Desktop, then dispatch the patched brief to Codex. RE-2 is the load-bearing edit — it closes a genuine label-laundering hole that the draft's own `labels`-bearing frame shapes would otherwise have opened. With the edits in, this is a well-scoped, spec-faithful second M3 slice — dispatch-ready.
