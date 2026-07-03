# Task M1-03 — Context engine (zones + ladder L1–L4) + `fairy replay` inspector

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

### 2. Reduction ladder L1–L4 (context-engine §3)
Triggered predictively when projected next-call tokens exceed `context.reduce_at` (default: 80% of the model's `context_window` from the registry). Apply stages in order until under budget:

| Stage | Action | This task |
|---|---|---|
| L1 output budgeting | oversized tool outputs → artifact + head/tail + path in context | **already exists** (M1-02 32 KiB spillover) — fold it into the ladder as L1, don't duplicate |
| L2 elision | old tool-result *bodies* → one-line digest + artifact ref (keep the call + digest) | implement |
| L3 turn snipping | oldest non-pinned turn ranges → placeholder summary records (`[N turns elided: …]`) | implement |
| L4 micro-compaction | accumulated placeholders + stale scratch → one summary block (uses `summarizer` role) | implement |
| L5 full compaction | whole history → structured handoff | **out of scope (M2)** — leave the seam + a clear TODO |

Rules: reductions **replace ranges with explicit placeholder records** (visible, logged, deterministic — never silent deletion). User turns and the current input are **pinned** (never snipped). Each reduction emits an event and is reflected in the manifest. If a provider still returns `context_overflow` after the ladder, surface it honestly (existing behavior) — the ladder reduces risk, it isn't a guarantee yet without L5.

### 3. `context.manifest` event (context-engine §6)
Emit one per assembled prompt (i.e., per model call, including tool-loop iterations): `{zones: [{name, tokens, estimated}], budget, window, reduction_stages_applied: [...], prefix_hash, model}`. Logged like any envelope; it is the replay inspector's primary food. Keep it lean — it's emitted every model call.

### 4. `fairy replay` — offline session inspector (the microscope)
New CLI command, reads session logs directly from `<data_dir>/sessions/<sid>/log.jsonl` (**no gateway connection** — pure offline, works on a dead/killed session):

- `fairy replay <sid>` — chronological event view: turn boundaries, deltas collapsed, tool calls/results (with decision + provenance), approvals, interruptions, errors.
- `fairy replay <sid> --manifests` — context manifests as a per-turn table: zone token breakdown + reduction stages, so context growth/compaction is *visible* over the session.
- `fairy replay <sid> --turn <n>` — full detail for one turn (raw-ish, including reasoning deltas).
- `--json` — machine-readable passthrough for each view.
- Reads the same event schemas via `@fairy/protocol` (validate on read; a corrupt/partial trailing line — e.g. from a hard kill — is reported, not fatal).

### 5. Config
- `context.reduce_at` (default `0.8` — fraction of window), `context.min_recent_turns` (never snip the last N turns, default 4), `context.summarizer_role` (default `summarizer`; falls back to `main` if unbound this milestone). Document keys in report.

### 6. Tests
- **Unit (context/kernel):** ladder stages fire at the right thresholds; pinning respected; append-only invariant (past turn records byte-identical before/after a reduction); deterministic assembly (same state ⇒ same prefix_hash); token accounting switches with model window.
- **E2E (mock provider):** a scripted long conversation (mock returns large tool outputs + many turns) drives L1→L2→L3→L4 in sequence; assert manifests show the stages, assert pinned turns survive, assert the session still completes turns after reduction. Feed the resulting log to `fairy replay` (spawn the CLI) and assert the `--manifests` table reflects the reductions.
- **Audit e2e (carry-in):** turn with a `shell.run` approval → `/audit?limit=5` returns the rows (drives the previously-uncovered query path).
- **Replay robustness:** truncate the last log line mid-JSON → `fairy replay` reports the bad tail and still renders the rest.

## Boundaries — do NOT

- No L5 full compaction (M2). No memory/persona/skills content in zones — reserved placeholders only. No second provider / conformance kit / fallback chains (M1-04). No research/MCP/hooks.
- Do not change the append-only log format or add event types beyond `context.manifest`. If you find a genuine schema gap, stop and report.
- No docs/ edits — propose in report. No new runtime deps expected (token estimation can be char-heuristic + any counts the provider returns); justify any exception.
- Keep the mock-parity rule: if a test needs the mock to emit manifests-relevant shapes, extend the mock rather than special-casing the kernel.

## Acceptance

```
pnpm install && pnpm lint && pnpm -r typecheck && pnpm -r test && pnpm dep-check   # green, both CI OSes
```
- Long-conversation e2e drives L1–L4 with manifests proving it; pinned turns survive; audit e2e green; replay robustness test green.
- Manual (owner): after a real multi-tool chat, `pnpm fairy replay <sid>` renders the session; `--manifests` shows zone token growth; `--turn <n>` shows one turn in detail. (A genuinely window-filling real conversation is optional — the mock e2e is the gate; real replay of a normal session is the check.)
- `git grep` still finds exactly one TurnRunner; past-turn log records unchanged across reductions (assertion in the suite).

## Report back (same format)

1. File tree delta. 2. Verification tails (both OS). 3. Decisions (config keys, ladder thresholds, manifest shape choices). 4. Spec ambiguities. 5. Proposed doc edits. 6. A `fairy replay --manifests` sample from the long-conversation e2e (paste the table).
