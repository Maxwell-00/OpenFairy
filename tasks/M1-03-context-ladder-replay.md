# Task M1-03 — Context engine (zones + ladder L1–L3) + `fairy replay` inspector

> Paste this entire file as the task brief. Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`. M1-02 is CLOSED (tools + permissions + audit verified on a real provider). This slice makes long sessions survivable and makes every turn inspectable after the fact — the microscope CLAUDE.md/ROADMAP insist on having early.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md` — invariants (append-only history, source-first/tsx, one TurnRunner, mock-parity rule from M1-02).
2. `tasks/M1-02-review.md` — accepted state + **two carry-ins for this task** (below).
3. `docs/specs/context-engine.md` — **normative**: zone model (§1), assembly rules (§2), reduction ladder (§3), cache discipline (§4), the `context.manifest` observability event (§6).
4. `docs/specs/protocol.md` §2 — the new `context.manifest` event family (normative from M1-03) + envelope rules.
5. `docs/ARCHITECTURE.md` §5.1, §6 (event log), §10.

## Carry-ins (must land in this task)

- **Audit e2e gap (M1-02 addendum #2):** `/audit` had zero end-to-end coverage and shipped broken. Add an e2e that drives a turn producing audit rows, then asserts `/audit?limit=N` returns them (exercise the query-string path that 404'd).
- **`context.manifest` event** is registered here (protocol §2) with schema + golden fixtures.

## Deliverables

### 1. `packages/kernel` (or a `context` module): zone-based prompt assembly
Replace the current ad-hoc "system + full history + input" concatenation with the **zone model** (context-engine §1). M1-03 subset of zones (the rest are later milestones, but the structure must be real now):

| Zone | M1-03 content | Budget source |
|---|---|---|
| system | `kernel.system_prompt` + standing quarantine rule | fixed |
| tools | registered tool signatures (already flow via gateway; account their token cost) | fixed |
| history | turns, tool calls/results | remainder |
| input | current user content | as needed |

Memory/persona/skills/task zones are **reserved (empty) placeholders** — leave the ordered structure so later milestones slot in without restructuring. Assembly must obey context-engine §2: **append-only history** (never edit past turns in place), deterministic serialization (stable key order), per-model token accounting via the gateway's tokenizer/estimate.

### 2. Reduction ladder L1–L3 (context-engine §3; L4/L5 complete at M2 per ROADMAP)
Triggered predictively when **projected next-call tokens** exceed `context.reduce_at` (default: 80% of the model's `context_window` from the registry). Projection = prompt tokens **+ output reserve** (`context.output_reserve`, default: the model's declared `max_output`, else 4096) — reducing on prompt size alone still overflows during generation. Apply stages in order until under budget:

| Stage | Action | This task |
|---|---|---|
| L1 output budgeting | oversized tool outputs → artifact + head/tail + path in context | **already exists** (M1-02 32 KiB spillover) — fold it into the ladder as L1, don't duplicate |
| L2 elision | old tool-result *bodies* → one-line digest + artifact ref (keep the call + digest) | implement |
| L3 turn snipping | oldest non-pinned turn ranges → placeholder records | implement |
| L4 micro-compaction | accumulated placeholders → one summary block (summarizer role) | **out of scope (M2)** — leave the seam |
| L5 full compaction | whole history → structured handoff | **out of scope (M2)** — leave the seam |

**The entire M1-03 reduction path is deterministic — zero model calls inside it** (model-written summaries arrive with L4/L5 at M2). L3 semantics, precisely: a snipped range collapses assistant/tool content into one placeholder record (`[turns 3–7 elided: tool bodies dropped, N tokens reclaimed; user said: "<first ~100 chars of each user msg>"]`); **user messages in the range are preserved verbatim in the prompt** (context-engine §3 pinning), as are the last `context.min_recent_turns` turns and the current input. Reductions **replace ranges with explicit placeholder records** (visible, logged — never silent deletion). Each reduction is reflected in the manifest. If a provider still returns `context_overflow` after L3, surface it honestly — without L5 the ladder reduces risk, it doesn't guarantee.

### 3. `context.manifest` event (context-engine §6)
Emit one per assembled prompt (i.e., per model call, including tool-loop iterations): `{zones: [{name, tokens, estimated}], budget, window, reduction_stages_applied: [...], prefix_hash, model}`. Logged like any envelope; it is the replay inspector's primary food. Keep it lean — it's emitted every model call. **Manifests are observability, not conversation: they must never enter the history zone / prompt assembly** (assert this in a test — an event type that feeds itself back into prompts is a context leak).

### 4. `fairy replay` — offline session inspector (the microscope)
New CLI command, reads session logs directly from `<data_dir>/sessions/<sid>/log.jsonl` (**no gateway connection** — pure offline, works on a dead/killed session):

- `fairy replay <sid>` — chronological event view: turn boundaries, deltas collapsed, tool calls/results (with decision + provenance), approvals, interruptions, errors.
- `fairy replay <sid> --manifests` — context manifests as a per-turn table: zone token breakdown + reduction stages, so context growth/compaction is *visible* over the session.
- `fairy replay <sid> --turn <n>` — full detail for one turn (raw-ish, including reasoning deltas).
- `--json` — machine-readable passthrough for each view.
- Reads the same event schemas via `@fairy/protocol` (validate on read; a corrupt/partial trailing line — e.g. from a hard kill — is reported, not fatal).

### 5. Config & token estimation
- Keys: `context.reduce_at` (default `0.8` — fraction of window), `context.output_reserve` (default: model `max_output`, else 4096), `context.min_recent_turns` (never snip the last N turns, default 4). Document keys in report. (No summarizer key this task — the reduction path is model-free until M2.)
- **Token estimator must be CJK-aware**: `chars/4` is roughly right for ASCII but ~2.5× wrong for Chinese (≈ chars/1.6) — the owner's sessions are bilingual, and a zh-heavy session would mis-trigger the ladder badly. Rough per-script weighting is enough; always `estimated: true` unless provider usage confirms; calibrate opportunistically against returned usage.

### 6. Tests
- **Unit (context/kernel):** ladder stages fire at the right thresholds; pinning respected; append-only invariant (past turn records byte-identical before/after a reduction); deterministic assembly (same state ⇒ same prefix_hash); token accounting switches with model window.
- **E2E (mock provider):** a scripted long conversation (mock returns large tool outputs + many turns) drives L1→L2→L3 in sequence; assert manifests show the stages, assert pinned user messages survive verbatim, assert the session still completes turns after reduction. Feed the resulting log to `fairy replay` (spawn the CLI) and assert the `--manifests` table reflects the reductions.
- **Estimator unit test:** zh, en, and mixed strings — estimates within a sane factor of provider-reported usage fixtures (guards the CJK weighting).
- **Audit e2e (carry-in):** turn with a `shell.run` approval → `/audit?limit=5` returns the rows (drives the previously-uncovered query path).
- **Replay robustness:** truncate the last log line mid-JSON → `fairy replay` reports the bad tail and still renders the rest.

## Boundaries — do NOT

- No L4/L5 (both M2). **No model calls anywhere in the reduction path.** No memory/persona/skills content in zones — reserved placeholders only. No second provider / conformance kit / fallback chains (M1-04). No research/MCP/hooks.
- Do not change the append-only log format or add event types beyond `context.manifest`. If you find a genuine schema gap, stop and report.
- No docs/ edits — propose in report. No new runtime deps expected (token estimation can be char-heuristic + any counts the provider returns); justify any exception.
- Keep the mock-parity rule: if a test needs the mock to emit manifests-relevant shapes, extend the mock rather than special-casing the kernel.

## Acceptance

```
pnpm install && pnpm lint && pnpm -r typecheck && pnpm -r test && pnpm dep-check   # green, both CI OSes
```
- Long-conversation e2e drives L1–L3 with manifests proving it; pinned turns survive; audit e2e green; replay robustness test green.
- Manual (owner): after a real multi-tool chat, `pnpm fairy replay <sid>` renders the session; `--manifests` shows zone token growth; `--turn <n>` shows one turn in detail. (A genuinely window-filling real conversation is optional — the mock e2e is the gate; real replay of a normal session is the check.)
- `git grep` still finds exactly one TurnRunner; past-turn log records unchanged across reductions (assertion in the suite).

## Report back (same format)

1. File tree delta. 2. Verification tails (both OS). 3. Decisions (config keys, ladder thresholds, manifest shape choices). 4. Spec ambiguities. 5. Proposed doc edits. 6. A `fairy replay --manifests` sample from the long-conversation e2e (paste the table).
