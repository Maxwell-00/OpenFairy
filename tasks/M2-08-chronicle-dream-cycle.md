# Task M2-08 — Chronicle v1 + hand-triggered dream-cycle consolidation

> Paste this entire file as the task brief.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M0–M1 closed. M2-01 through M2-07 are closed at task level.
>
> This task implements the remaining M2 memory/Chronicle slice: workspace-local Chronicle v1, hand-triggered consolidation v0, transparent memory report artifacts, and deterministic eval coverage.
>
> Do not implement M4 scheduler/workflows. Do not implement autonomous nightly jobs. Do not start M3 voice. Do not create a second TurnRunner.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md`
   - One TurnRunner. Modes are policies, not extra loops.
   - Event-sourced JSONL sessions are the source of truth for sessions.
   - Source-first TS workspace until M5.
   - No dist exports.
   - No sibling-package build dependency in tests.
   - Gateway/CLI spawned processes use the same TS execution world.
   - Raw HTTP/SSE model transport; no provider SDK.
   - CI never uses real API keys.
   - Do not read or edit `docs-zh/`.

2. `REVIEWER-HANDBOOK.md`
   - Review/brief-gate discipline.
   - Mount staleness and git-lock caveats.
   - Docs reviewer-owned.
   - Deterministic fixture evidence is acceptable for non-live tasks.
   - Real-provider checks are owner-run only.

3. `tasks/M2-07-review.md`
   - M2-07 is closed.
   - L4/L5 compaction is accepted.
   - Carry-ins: compaction fail-closed integration cases may still be listed for M2 exit.
   - M2-07 docs pass is reviewer-owned.

4. `docs/ROADMAP.md`
   - M2 includes Memory stores, MemoryGate, evidence pull-through, **Chronicle v1**, and **dream-cycle consolidation (hand-triggered)**.
   - M2 exit includes trustworthy memory/research/governance, screenshot flow, and long-session correctness.
   - M4 owns scheduler/workflows/proactivity; do not implement those here.

5. `docs/specs/memory.md`
   - Chronicle is workspace/project memory, distinct from personal memory.
   - Chronicle is append-only and workspace-local.
   - Chronicle entries record attempts, failures, fragile files, decisions, and outcomes.
   - Coder/loop/reviewer contexts can use Chronicle digest for relevant files/topics.
   - Dream-cycle consolidation includes episode summarization, promotion, contradiction sweep, decay, index maintenance, and a user-reviewable memory report.
   - Procedural/learned skills are gated: drafts land pending and require user approval before activation.

6. `docs/specs/data-governance.md`
   - Chronicle entries default to `internal` and workspace-scoped.
   - Labels derive by max sensitivity and residency intersection.
   - No automatic declassification.
   - Personal/secret content must not leak into workspace Chronicle unless explicitly scoped and label-gated.

7. `docs/specs/protocol.md`
   - Do not invent canonical event types.
   - Use existing `memory.written`, `memory.deleted`, `artifact.created`, `context.manifest`, and related registered events where appropriate.
   - `artifact.created` is available for reports.
   - If existing schemas require additive fields, update schema + valid/invalid fixtures.

8. `docs/specs/evals.md`
   - Existing M2 suites must remain green.
   - New memory capabilities require deterministic PR-tier coverage.
   - Memory canary may remain deferred if full consolidation benchmark is not implemented, but this task must not fake-pass it.

9. `docs/specs/context-engine.md`
   - M2-07 L4/L5 compaction is now part of context assembly.
   - Chronicle digest, if injected, must be label-bearing and must participate in route clearance like memory/research/perception digests.
   - Context manifest remains observational only.

## Deliverables

### 0. Preserve existing invariants

Before adding Chronicle/consolidation behavior, preserve or add regression tests proving:

- All M2 named suites remain visible and green:
  - `memory.leakage`
  - `memory.deletion-permanence`
  - `research.citation-precision`
  - `research.zh-en-parity`
  - `injection.research-v0`
  - `label.conformance`
  - `governance.friction-canary`
  - `persona.consistency`
  - `substance.invariance`
  - `perception.quarantine-v0`
  - `context.compaction-regression`
- M2-05b affect prefix stability remains green.
- M2-05c encoding guard remains part of `pnpm lint`.
- M2-07 L4/L5 compaction tests remain green.
- No provider-specific branches in kernel.
- No vendor SDKs.
- No `docs/` or `docs-zh/` edits.

Carried-in from the M2-07 countersignature (two small tests; logic already exists and is correct — tests only, no runtime changes for these):

1. E2E for the terminal compaction fail-closed branch: NO cleared summarizer candidate at all ⇒ model-backed compaction is skipped, the turn completes on the uncompacted (L1–L3) path, denial visible. (The existing governance E2E always has a cleared fallback.)
2. Integration test driving an invalid-compactor-output turn to completion on the original context path (currently only unit-tested at the validators).

Acceptance:

- Existing tests green.
- Suite names visible in `packages/testing` output.
- The two M2-07 carry-in tests above exist and pass (inside existing suites; no new suite names for them).
- `git diff --name-only -- docs docs-zh` has no output.
- `pnpm lint` includes encoding guard.

### 1. ChronicleStore v1

Implement a workspace-local Chronicle store.

Required behavior:

- Chronicle is **project/workspace memory**, not personal memory.
- Store location must be deterministic and workspace-local:
  - default under the existing Fairy data dir for the workspace, or a repo-local opt-in path if already supported by config;
  - do not silently write hidden files into arbitrary repos without config/owner intent.
- Chronicle source-of-truth is append-only records, not a mutable summary table.
- Records must include:
  - `id`,
  - `created_at`,
  - `kind`: `attempt | failure | decision | outcome | fragile-file | note`,
  - `summary`,
  - optional `details`,
  - `labels`,
  - `workspace`,
  - `files[]`,
  - `topics[]`,
  - `provenance`: `{sid?, turn?, event_id?, source?}`,
  - `supersedes?` / `related?` where useful.
- Labels default to `internal/global-ok` or workspace configured default; no `secret` Chronicle write is allowed.
- Chronicle must reject or hold entries whose content escalates to `secret`. Detection reuses the existing governance escalation/secret patterns (kernel `governance.ts`, M2-04/05c) — do not write a new secret detector.
- Chronicle entries never become personal semantic memory automatically.
- Deleting/redacting Chronicle entries is not required in v1, but if delete exists it must tombstone, not rewrite.
- If a SQLite projection is used for search, it must be rebuildable from the append-only Chronicle records.

Acceptance:

- Unit tests for append-only writes, ids, labels, provenance, workspace scoping, and secret rejection.
- Unit tests for rebuildable projection if a projection exists.
- Unit tests that Chronicle cannot auto-write personal memory.
- No session JSONL is rewritten.

### 2. Chronicle tools and CLI

Add minimal Chronicle access.

Minimum tool namespace:

```text
chronicle.log(entry)
chronicle.query(topic_or_file)
```

Minimum CLI:

```powershell
pnpm fairy chronicle log --kind <kind> --summary <text> [--file <path>] [--topic <topic>] --json
pnpm fairy chronicle query <query> --json
pnpm fairy chronicle list --json
pnpm fairy chronicle show <id> --json
```

Required behavior:

- Tool calls go through the existing TurnRunner tool loop.
- Tool results use provenance `tool:chronicle.*`.
- Tool result labels inherit Chronicle labels.
- `chronicle.log` is allowed only for workspace/internal scoped content by default.
- A `secret`-like entry is denied/held and does not create a Chronicle record.
- `chronicle.query` returns compact digest entries with ids, summaries, files/topics, labels, and provenance.
- CLI commands use existing config/data-dir discovery.
- JSON output is stable and parseable.

Acceptance:

- Unit/CLI tests with temp workspace/data dir.
- E2E: mock model calls `chronicle.log`, then `chronicle.query`; canonical `tool.call` / `tool.result` events visible in replay.
- E2E: secret-like Chronicle log attempt is denied/held and creates no record.
- CLI JSON parse tests.
- Replay renders Chronicle tool calls/results normally.

### 3. Chronicle digest for project context

Add a bounded Chronicle digest into context when relevant.

Required behavior:

- Digest is file/topic relevant, not ambient personal recall.
- Query inputs may include:
  - current user input,
  - touched file paths,
  - task headline if available,
  - recent failed tool/error hints.
- Digest must be bounded by config, e.g. `context.chronicle_digest_budget`.
- Digest carries labels derived from admitted Chronicle records.
- Chronicle digest labels join effective prompt labels before route clearance.
- Under-cleared providers receive zero request bytes if Chronicle digest labels exceed clearance.
- Digest must not include secret entries.
- Digest must not include personal entries unless explicitly workspace-scoped and route-cleared.

Acceptance:

- Context tests for digest injection, budget, labels, and effective label raising.
- E2E: `internal/local-only` Chronicle entry raises prompt labels and denies under-cleared primary before provider I/O; cleared fallback completes.
- E2E: irrelevant Chronicle entries are not injected.
- `context.manifest` accounts Chronicle digest tokens, either under memory/task/context zone or a clearly named zone. Do not make ambiguous accounting.

### 4. Hand-triggered dream-cycle consolidation v0

Implement manual consolidation. No scheduler.

Minimum CLI:

```powershell
pnpm fairy memory consolidate --from <date-or-session> [--to <date>] --json
pnpm fairy memory report --json
```

Or an equivalent command shape, documented in the work report Decisions. Do not create a background daemon.

Required behavior:

- **Consolidation v0 is fully deterministic — no model calls.** The memory spec's nightly dream cycle (§5) uses cheap model roles, but this hand-triggered v0 uses deterministic extraction only (structured summaries from event fields, not LLM prose). Model-assisted consolidation is a later slice and, when it comes, inherits the M2-07 compactor rules (clearance over source-range labels, bounded input, fail-closed output validation). Do not call the summarizer or any model role in this task.
- **Explicitly deferred §5 steps (record in work report + docs proposal):** promotion into semantic memory (v0 lists promotion CANDIDATES in the report only; actual writes go only through existing MemoryGate/explicit-remember paths), decay, and index maintenance are NOT implemented. The evals.md memory canary and contradiction test remain deferred — visibly skipped, never fake-passed.
- **No auto-supersession, no auto-deletion:** contradiction sweep v0 produces suggestions in the report; it never writes `memory.superseded`/`memory.deleted` or mutates records by itself.
- Reads session JSONL logs, MemoryStore, Chronicle records, research/perception artifacts where relevant.
- Produces a user-reviewable memory report artifact, emitted via `artifact.created`. **The report artifact carries labels derived (max sensitivity / residency intersection) from its included content — a report containing personal/local-only material is itself personal/local-only, and its export/egress obeys the same gates as any artifact.**
- Performs deterministic v0 steps:
  1. episode summary from selected sessions;
  2. candidate memory observations with provenance quotes;
  3. contradiction candidates / supersession suggestions;
  4. Chronicle candidate entries for project decisions/failures;
  5. learned-skill draft candidates in a pending location, not active skills.
- No automatic activation of learned skills.
- No automatic personal memory write unless it goes through existing MemoryGate admission and existing explicit-memory semantics.
- Secret content must be dropped/redacted from reports and never persisted.
- Personal content remains local-only and route-cleared.
- Consolidation must be restartable/idempotent for the same input range.

Acceptance:

- Unit tests for report artifact shape, deterministic ids/content hash, provenance quotes, secret redaction, and idempotence.
- E2E/CLI: run manual consolidation over fixture sessions; report artifact created; JSON output parseable.
- Test: learned-skill draft created under pending path and not active.
- Test: candidate personal memory is held/denied unless explicit admission path allows it.
- Test: no scheduler/background task is started.

### 5. Evidence pull-through integration

Expose receipts for Chronicle and consolidation outputs.

Required behavior:

- Note: `MemoryStore.evidence()` already exists since M2-02 (source event pointer + adjacent episode slice, deny-safe) — extend it rather than inventing a parallel path.
- `memory.evidence(id)` or an equivalent CLI/tool path can show:
  - original session quote,
  - adjacent episode slice,
  - Chronicle provenance,
  - report artifact reference.
- If an exact existing command is not suitable, add minimal CLI:
  - `pnpm fairy memory evidence <id> --json`
  - or document why evidence is limited to `memory show` / Chronicle show in v1.
- Evidence slices inherit labels and pass gates.
- Denied evidence does not become an oracle for personal/secret text.

Acceptance:

- CLI tests for evidence JSON.
- Test denied personal/local-only evidence is omitted or redacted for under-cleared context.
- Replay remains sufficient to trace report output back to source event ids.

### 6. Eval suites

Register deterministic PR-tier suites in `packages/testing`.

Required suite names:

```text
chronicle.workspace-v0
dream-cycle.consolidation-v0
```

Coverage:

`chronicle.workspace-v0`:
- append/query workspace entries;
- workspace scoping;
- secret rejection;
- digest relevance;
- labels gate routing;
- no personal-memory auto-write.

`dream-cycle.consolidation-v0`:
- episode summary from fixture session logs;
- memory report artifact;
- provenance quotes;
- secret redaction;
- learned-skill draft remains pending;
- idempotent repeated run;
- no scheduler/background task.

Acceptance:

- Suite names appear in `pnpm --filter @fairy/testing test -- --reporter=verbose`.
- Non-vacuous assertions.
- No real provider calls.
- No LLM judge in CI.
- Existing M2 suites remain visible and green.

### 7. Config surface

Add only minimal config.

Suggested keys:

```yaml
chronicle:
  enabled: true
  digest_budget: 500
  max_results: 6
  storage: data-dir

memory:
  consolidation:
    enabled: true
    learned_skill_pending_dir: extensions/skills/learned/pending
```

Rules:

- Extend existing config loader + schema validation path.
- Defaults must be deterministic and safe.
- Invalid values fail validation.
- No side-channel config.
- Document final shape in work report Decisions.

Acceptance:

- Config tests for defaults and invalid values.
- No invented label/residency values.
- No docs edits by Codex.

### 8. Docs proposals only

Do not edit `docs/` or `docs-zh/`.

In `tasks/M2-08-work.md`, propose exact docs edits for reviewer application:

- `docs/specs/memory.md`
  - Chronicle v1 implementation status.
  - Hand-triggered dream-cycle consolidation v0.
  - Evidence pull-through.
  - Learned-skill pending gate.
  - Explicit boundary: no scheduler yet.

- `docs/specs/context-engine.md`
  - Chronicle digest zone/accounting.
  - Label participation in effective prompt labels.

- `docs/specs/data-governance.md`
  - Chronicle/workspace labels and routing gates.
  - Consolidation report redaction and retention.

- `docs/specs/evals.md`
  - `chronicle.workspace-v0`
  - `dream-cycle.consolidation-v0`

- `docs/specs/protocol.md`
  - Event usage notes if existing schemas are extended additively.

## Boundaries — do NOT

- Do not implement M4 scheduler/workflow engine.
- Do not implement autonomous nightly consolidation.
- Do not start background jobs.
- Do not activate learned skills automatically.
- Do not implement Chronicle auto-brief for subagents beyond a simple context digest.
- Do not implement embeddings/vector store/sqlite-vec/LanceDB.
- Do not implement M3 voice.
- Do not create a second TurnRunner.
- Do not auto-persist research findings into personal memory.
- Do not write secret content into Chronicle, report artifacts, or memory.
- Do not declassify content by summarizing it.
- Do not add vendor SDKs.
- Do not use real API keys or real providers in CI.
- Do not add new canonical event types unless already registered and schema/fixtures are updated additively.
- Do not edit `docs/`.
- Do not edit `docs-zh/`.

## Acceptance commands

```powershell
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm dep-check
pnpm conformance
git diff --check
git diff --name-only -- docs docs-zh
```

GitHub Actions must be green on the existing ubuntu + windows matrix.

## Manual owner checks

Owner should run after CI is green. Deterministic fixture evidence is acceptable for this task; no real provider is required.

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M2-08
```

### 1. Chronicle suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Expected:

- `chronicle.workspace-v0` appears and passes.
- Existing M2 suites still pass.

Save:

```text
tasks/owner-checks/M2-08/testing-chronicle.txt
```

### 2. Chronicle CLI

Run:

```powershell
pnpm fairy chronicle log --kind decision --summary "Use source-first TS execution" --topic m2 --json
pnpm fairy chronicle query source-first --json
pnpm fairy chronicle list --json
```

Expected:

- JSON parseable.
- entry has id, labels, provenance/workspace.
- query returns the logged entry.
- no secret labels.

Save:

```text
tasks/owner-checks/M2-08/chronicle-log.json
tasks/owner-checks/M2-08/chronicle-query.json
tasks/owner-checks/M2-08/chronicle-list.json
```

### 3. Dream-cycle consolidation suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose -t "dream-cycle.consolidation-v0"
```

Expected:

- suite appears and passes.
- report artifact created.
- learned skill remains pending.
- secret redacted.
- repeated run idempotent.

Save:

```text
tasks/owner-checks/M2-08/dream-cycle-consolidation.txt
```

### 4. Manual consolidation CLI

Run fixture/manual consolidation command chosen by Codex, for example:

```powershell
pnpm fairy memory consolidate --from <fixture-session-or-date> --json
pnpm fairy memory report --json
```

Expected:

- JSON parseable.
- report artifact ref visible.
- provenance quotes visible.
- no secret raw text.
- no active learned skill created.

Save:

```text
tasks/owner-checks/M2-08/consolidate.json
tasks/owner-checks/M2-08/memory-report.json
```

## Report back

Use the established format:

1. File tree delta.
2. Verification tails:
   - local commands,
   - CI link/status,
   - conformance verdict,
   - named eval suite names.
3. Decisions:
   - Chronicle storage path and source-of-truth semantics,
   - Chronicle record shape,
   - query/digest scoring,
   - consolidation command shape,
   - report artifact shape,
   - learned-skill pending gate,
   - labels/governance behavior,
   - config shape.
4. Spec ambiguities.
   - Non-empty; at minimum explain how Chronicle append-only records relate to session JSONL source-of-truth.
5. Proposed docs edits.
6. Manual owner checklist with exact commands and evidence paths.
