# Review: M1-01 delivery — ACCEPTED with resolution fix (CI red → fixed)

Reviewer: Claude (Cowork) · 2026-07-02 · verdict on `tasks/M1-01-work.md` (commit `37a568c`), reviewed from git objects

## Verified

- **One TurnRunner ✓** — echo responder deleted; kernel runner is the single loop: per-session AbortController, one-turn-in-flight (concurrent input → `UserError` event), tool seam present-but-empty, abort → `turn.interrupted{last_heard_mark, reason:user_cancelled}`, provider errors mapped to taxonomy on `error` events.
- **Transport ✓** — raw HTTP+SSE, zero vendor SDKs (dep-check + grep clean); `reasoning_content` **and** `<think>`-tag extraction to `reasoning.delta`; retry ≤ 3 on 429/5xx; idle watchdog; usage fallback `estimated: true`; `secret://` resolved only inside the transport; clearance recorded trace-only in `model_trace`.
- **Resume ✓ (real, not cosmetic)** — boot scans all session logs, appends synthetic `turn.interrupted(gateway_restart)` to open turns, rebuilds turn counters **and prompt history** from events. `session.attach` replays then goes live.
- **E2E ✓** — 3 scenarios (stream+JSONL validity, restart/resume/next-turn-number, cancel) against the mock OpenAI-compat server; no secrets in CI.
- Honesty note: Codex declined to fabricate a real-provider transcript when no endpoint was configured — correct behavior, carried to owner verification below.

## CI failure root cause & fix (both OS)

`@fairy/protocol` `exports.import` pointed at `./dist/index.js` (build output). `packages/testing` had been working around it with a `pnpm --filter @fairy/protocol build &&` test prefix — and the workaround had already metastasized to `kernel` and `model-gateway` test scripts. M1-01's new `apps/cli` → protocol import had no such prefix → fresh CI checkout has no `dist/` → resolution failure. Local green was stale-artifact false confidence.

**Fix (root cause, not another prefix):** all workspace packages now resolve **source-first** (`exports.import` → `./src/index.ts`); the three build-prefix hacks removed; `build` scripts retained for the M5 packaging milestone only. Convention added to CLAUDE.md/AGENTS.md: never point exports at `dist/`, never gate tests on sibling builds.

## Also fixed by reviewer

- Kernel default system prompt de-personalized (owner's name doesn't belong in a public repo's default string; per-user identity arrives with config/persona).

## Doc edits applied (per contract)

- protocol §7: `session.attach` row; transport-frames-vs-envelopes ruling (op acks are raw frames, never logged; session facts stay envelopes); HTTP endpoint auth; **replay boundary: `session.resumed` sentinel is normative from M1-02** (M1-01 streams without a marker — carry-in below).
- ARCHITECTURE §7: `/sessions` endpoint + boot-resume semantics. model-gateway spec: v0 implementation-status notes.

## Carry-ins for M1-02 (small, listed so they don't evaporate)

1. Emit `session.resumed` after attach replay (protocol §7 normative-from-M1-02); CLI gates input on it.
2. Consider ack frame for `session.create`… no — deferred; revisit at M1-04 conformance pass alongside op-ack uniformity.
3. Acceptance-grep lesson for future briefs: scope `git grep` assertions to code paths (`-- packages apps`), not the whole tree.

## Owner manual verification (pending — the one open acceptance item)

Configure a real provider in `%APPDATA%\fairy\fairy.yaml`, then `pnpm --filter @fairy/gateway start` + `fairy chat`: stream a few turns, kill the gateway, `fairy chat --session <sid>`, confirm history + continuation. Config sketch in the review conversation.

## Verdict

Implementation quality high; the CI failure was a pre-existing latent defect that this task's growth exposed, now removed class-wide. After owner push: expect green both OS → **M1-01 closed**, M1-02 (tools + permission engine v1) is next.
