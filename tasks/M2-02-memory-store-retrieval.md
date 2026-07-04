# Task M2-02 — MemoryStore v1 + gated retrieval digest + memory CLI verbs

> Paste this entire file as the task brief.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M1 is closed. M2-01 is closed at task level: governance route gate, semantic escalation v0, MemoryGate v0 admission, strict live conformance, and replay visibility are accepted.
>
> This task is the second trust slice. It turns M2-01's `memory.written` events into a durable local memory projection and makes retrieval enter the context through a gate. The memory zone stops being an empty placeholder, but only with gate-admitted records.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md`
   - One TurnRunner.
   - Event-sourced JSONL sessions are the source of truth.
   - Source-first TS workspace until M5.
   - No dist exports.
   - No sibling-package build dependency in tests.
   - Gateway/CLI spawned processes use the same TS execution world.
   - Raw HTTP/SSE model transport; no provider SDK.
   - Provider quirks only at transport + fixture boundary.
   - CI never uses real API keys.
   - Do not read/edit `docs-zh/`.

2. `tasks/M2-01-review.md`
   - M2-01 accepted and closed.
   - Docs pass is reviewer-owned; Codex may propose docs edits only.
   - Replay evidence proved route-deny and MemoryGate admission behavior.
   - M2-02 must not regress route clearance or MemoryGate deny semantics.

3. `docs/specs/memory.md`
   - §1 memory stores.
   - §3 semantic record shape and provenance requirement.
   - §4 retrieval digest.
   - §4a retrieval MemoryGate.
   - §4b evidence pull-through.
   - §7 user controls.

4. `docs/specs/data-governance.md`
   - Sensitivity: `public < internal < personal < secret`.
   - Residency: `local-only | region-restricted | global-ok` closed enum.
   - `region-restricted(home)` resolves from `governance.home_regions`.
   - Derivation rule: outputs inherit max sensitivity and residency intersection.
   - Memory retrieval is an enforcement point.

5. `docs/specs/context-engine.md`
   - Zone 4 is the memory digest.
   - Zones 1–5 form the stable prefix.
   - `context.manifest` reports zone sizes and effective labels.
   - Manifests are observational only and never enter prompt assembly.

6. `docs/specs/protocol.md`
   - Existing memory events: `memory.written`, `memory.superseded`, `memory.deleted`, `memory.gate.decision`.
   - Event logs are canonical facts; transport frames are not events.

7. `docs/ROADMAP.md`
   - M2 trust milestone includes memory stores, retrieval digest, MemoryGate, `/memory` verbs, canary/deletion/leakage suites.
   - Research, persona, proactivity, voice, and full context L4/L5 are separate slices.

## Deliverables

### 0. Preserve M2-01 invariants

Before changing memory behavior, add or preserve tests that prove:

- Secret route-deny still happens before provider I/O.
- Secret explicit remember still emits `memory.gate.decision` deny and no `memory.written`.
- Safe explicit remember still emits `memory.gate.decision` allow and `memory.written`.
- Kernel provider-special-case guard still passes.
- `memory.gate.decision` and `memory.written` remain visible in `fairy replay --json`.

Acceptance:

- Existing M2-01 tests remain green.
- Add at least one regression test that would fail if a denied secret memory candidate is written to any durable memory projection — **it must attempt a direct `MemoryStore.insert` of a secret-labeled record (bypassing the gate) and assert the store itself rejects it**, in addition to the end-to-end gate-deny path. The projection layer is its own defense line, not a trusting consumer of the gate.

### 1. MemoryStore v1 as a rebuildable projection

Implement a local `MemoryStore` behind `packages/memory`.

Required semantics:

- The source of truth remains session JSONL events.
- The store is a projection/index over accepted memory events, not a second truth source.
- It must be rebuildable from `memory.written`, `memory.superseded`, and `memory.deleted` events.
- It must live in the existing local data directory / `core.db` world; do not add external memory services.
- Use SQLite tables and deterministic indexes. FTS5 is allowed; vector embeddings/sqlite-vec are **not** in this task. *Why (spec-anchored, not an oversight): ROADMAP M2 has a dedicated decision gate (sqlite-vec vs LanceDB, ≥200k-record benchmark) for the vector layer, and sqlite-vec is a native loadable extension — pulling it in under `node:sqlite` would break the repo's build-free/native-free posture. This slice's scorer is therefore BM25(FTS5) + recency + use-frequency + tier weight, an interim subset of memory.md §4's hybrid scorer; vector similarity joins at the decision-gate slice.*
- Tests must not depend on a prior build or stale local database.

Minimum record shape:

```ts
type MemoryRecord = {
  id: string;
  text: string;
  kind: "fact" | "preference" | "event-fact";
  labels: { sensitivity: "public" | "internal" | "personal" | "secret"; residency: "local-only" | "region-restricted" | "global-ok" };
  scope: { kind: "personal" | "workspace"; workspace_id?: string };
  provenance: { sid: string; turn: number; event_id: string; quote?: string };
  confidence: number;
  valid_from: string;
  valid_to?: string;
  superseded_by?: string;
  created_at: string;
  updated_at: string;
  last_used?: string;
  use_count: number;
};
```

Rules:

- `secret` records are not persisted. A `memory.written` event for secret content should be impossible after M2-01; M2-02 must also guard the projection layer.
- Every persisted record must carry provenance back to a session/turn/event.
- IDs must be stable enough for replay/tests. Prefer deterministic IDs derived from the `memory.written` event id or existing `memory_id`.
- Deletion is hard delete from the projection plus a tombstone event in the log. Do not resurrect deleted records during rebuild.

Acceptance:

- Unit tests for insert/update/delete/rebuild.
- A rebuild-from-JSONL test starts from a temporary data dir with only session logs and reconstructs the same records.
- A deleted-memory rebuild test proves a tombstoned record does not reappear.
- No vector, embedding, LanceDB, sqlite-vec, or external memory dependency appears in dependencies.

### 2. Explicit remember writes a durable projection

Wire M2-01's safe explicit remember path into `MemoryStore`.

Required behavior:

- On `memory.gate.decision allow`, emit `memory.written` as before and update the projection.
- If projection write fails, the turn must remain honest:
  - log an `error` event or safe failure payload,
  - do not pretend memory was stored,
  - do not corrupt the event log.
- Memory projection writes must be idempotent: replaying/rebuilding must not duplicate rows.

Acceptance:

- E2E: `remember that my favorite shell is pwsh` produces `memory.gate.decision allow`, `memory.written`, and a retrievable MemoryStore row.
- E2E: repeating the same remembered preference does not create unbounded duplicates. It may bump confidence/use_count or supersede deterministically.
- E2E: fake API key remember denies and creates no projection row.

### 3. Retrieval gate v1

Implement retrieval-side MemoryGate. This is distinct from M2-01 admission.

Required behavior:

- Candidate retrieval records are scored first, then passed through a deterministic gate before any digest is assembled.
- Gate context must include:
  - current assembled request labels,
  - target model/provider clearance,
  - channel trust: CLI trusted for M2-02, but still label-gated,
  - scope: personal vs workspace,
  - mode/task class if already available; otherwise default to normal chat.
- The gate may admit only records whose labels are allowed by the current route and channel.
- Denied retrieval records must not appear in the prompt, memory digest, model messages, or tool results.
- Denials are silent to the model. The model should not learn that a denied record existed.
- Denials are auditable via `memory.gate.decision` events.

Event shape requirements:

- Reuse `memory.gate.decision`.
- Add a payload discriminator such as `phase: "admission" | "retrieval"` or equivalent.
- For retrieval denials, payload must include reason codes and record id, but must **not** include denied record text when the record is personal/secret.

Minimum reason codes:

- `label_clearance_denied`
- `scope_mismatch`
- `below_relevance_floor`
- `deleted_or_superseded`
- `admit`

Acceptance:

- Unit tests cover allow/deny for sensitivity, residency, scope, deletion, and relevance floor.
- E2E: a personal/local-only memory is not injected into a cloud/internal/global-only route.
- E2E: if a local/secret-capable fallback is configured, the same memory may be admitted only after the cleared route is selected.
- Replay JSON shows retrieval gate decisions without leaking denied text.

### 4. Memory digest in context zone

Populate the context-engine memory zone with a compact retrieval digest.

Required behavior:

- Query = current user input + current task headline if available. Do not use the whole history as query.
- Default digest budget: 600 estimated tokens, config key **`context.memory_digest_budget`** (pinned — name it exactly this and include it in the §8 context-engine docs proposal; config keys must be spec-registered).
- **Integration seam (the subtle part):** digest assembly must run inside/adjacent to `assemblePrompt` so that admitted-record labels flow into `deriveMessageLabels` **before** `canRouteToModel` runs — the memory zone stops being `tokens: 0` and contributes both tokens and labels. An admitted `personal` memory must be able to force a route-deny/fallback exactly like `personal` history content does (M2-01's composition rule extends to the digest).
- Render admitted records as compact bullets with:
  - stable memory id,
  - kind,
  - confidence marker,
  - short text,
  - provenance pointer compact enough for evidence pull-through later.
- The digest itself inherits labels from admitted memory records. Effective prompt labels must include memory digest labels before model route clearance.
- `context.manifest` must show non-zero memory zone tokens when a digest is included.
- If no records are admitted, the memory zone remains empty and does not add filler text.

Acceptance:

- E2E: safe remembered preference in session A is retrieved into session B's memory zone when relevant.
- E2E: `context.manifest` memory zone token count becomes non-zero for the retrieval case.
- E2E: irrelevant memory is not injected because of relevance floor.
- E2E: admitted memory can raise effective labels and force route denial or allowed fallback.
- Tests assert `context.manifest` itself never enters prompt/history, preserving M1-03 invariant.

### 5. Evidence pull-through v0

Implement a minimal evidence API inside `packages/memory` and expose it through CLI.

Required behavior:

- `memory.evidence(id)` returns:
  - memory id,
  - record text,
  - labels,
  - provenance session id / turn / event id,
  - quote if available,
  - a small surrounding episode slice from the source JSONL log.
- Evidence reads must pass the same label/scope gate as retrieval.
- Evidence for denied records must return a safe not-found/denied result without leaking text.

Acceptance:

- Unit test: evidence lookup returns source event pointer and adjacent turns for an allowed record.
- Unit test: denied evidence lookup does not leak record text.
- Replay/truncated-tail tolerance must not be weakened.

### 6. CLI memory verbs

Add `pnpm fairy memory ...` commands.

Minimum commands:

```powershell
pnpm fairy memory list
pnpm fairy memory search <query>
pnpm fairy memory show <id>
pnpm fairy memory delete <id>
pnpm fairy memory rebuild
```

Required behavior:

- Commands operate on the same data dir/config discovery path as the gateway.
- `list` shows id, kind, short text, labels, confidence, source session/turn.
- `search` uses the same retrieval scorer and gate; JSON mode preserves payloads.
- `show` includes evidence/provenance for allowed records.
- `delete` emits `memory.deleted`, removes the projection row, and writes a tombstone sufficient to prevent rebuild resurrection.
- `rebuild` reconstructs the projection from session logs and tombstones.
- Add `--json` to at least `list`, `search`, and `show`.

Acceptance:

- CLI tests for list/search/show/delete/rebuild with a temp data dir.
- Delete + rebuild test: deleted record stays gone.
- JSON output is parseable and stable enough for owner evidence.

### 7. Replay and audit visibility

Extend `fairy replay` rendering for memory retrieval.

Required behavior:

- Text replay should distinguish:
  - `memory.gate.decision phase=admission`
  - `memory.gate.decision phase=retrieval`
  - `memory.written`
  - `memory.deleted`
- JSON replay preserves full payloads.
- Retrieval-denied events must not expose denied text.

Acceptance:

- Synthetic replay tests for retrieval admit/deny and memory deleted.
- Existing replay tests for route-deny, context manifests, and truncated tail remain green.

### 7b. Named eval suites (evals.md registry — M2 gates on these, not on ad-hoc tests)

Register two named suites in `packages/testing` matching the evals.md registry rows, implemented over the tests this brief already requires:

- **`memory.deletion-permanence`** — deleted facts: 0 resurrections across delete → rebuild → retrieval (asserts on store rows AND retrieval results).
- **`memory.leakage`** — scripted `personal+` retrieval attempts against under-cleared routes: 0 admits, asserted on `memory.gate.decision phase=retrieval` events (never on absence of output alone).
- **`memory.canary`** (100-fact recall precision) is explicitly **stubbed/deferred** with a tracking note — it needs consolidation cycles that don't exist until the dream-cycle slice. The stub must fail loudly if invoked, not fake-pass.

Acceptance: `pnpm -r test` runs both suites; their names appear in output so the M2 exit gate can reference them.

### 8. Docs proposals only

Do not edit `docs/` or `docs-zh/` in this task.

In `tasks/M2-02-work.md`, propose docs edits for reviewer application:

- `docs/specs/memory.md`
  - MemoryStore v1 projection semantics.
  - Retrieval gate phase and reason codes.
  - Memory digest rendering shape.
  - CLI memory verbs.
- `docs/specs/context-engine.md`
  - Memory zone now populated by gate-admitted digest.
  - Effective labels include admitted memory digest labels.
- `docs/specs/protocol.md`
  - `memory.gate.decision` phase discriminator.
  - `memory.deleted` tombstone requirements.
- `docs/specs/data-governance.md`
  - Retrieval gate route-clearance rule.

## Boundaries — do NOT

- Do not implement research orchestration.
- Do not implement persona packs or affect.
- Do not implement proactivity quotas or delivery.
- Do not implement Chronicle v1 yet.
- Do not implement dream-cycle consolidation.
- Do not implement automatic model-based memory extraction.
- Do not implement embeddings, sqlite-vec, LanceDB, vector search, or external memory services.
- Do not add MCP/hooks.
- Do not add a second TurnRunner.
- Do not add vendor SDKs.
- Do not use real API keys in CI.
- Do not edit `docs-zh/`.
- Do not edit `docs/`; propose docs edits only.
- Do not let denied memory text enter the prompt, logs intended for the model, or provider requests.
- Do not silently declassify labels.

## Acceptance commands

```powershell
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm dep-check
pnpm conformance
```

GitHub Actions must be green on the existing CI matrix.

## Manual owner checks

Owner should run after CI is green.

### 1. Safe memory persists and is recalled

1. Start gateway with a cleared model.
2. Chat:

```text
remember that my favorite shell is pwsh
```

3. Start a new session and ask:

```text
what shell do I prefer?
```

Expected:

- `memory.gate.decision phase=admission decision=allow`
- `memory.written`
- later `memory.gate.decision phase=retrieval decision=allow`
- `context.manifest` memory zone has non-zero tokens
- final answer uses the memory

### 2. Fake secret is not persisted or recalled

Chat:

```text
remember that my API key is sk_test_1234567890abcdef
```

Expected:

- admission decision deny
- no `memory.written`
- no MemoryStore row
- no future recall

### 3. Retrieval gate blocks disallowed provider

Configure one cloud/internal/global provider and one local/secret-capable provider if available.

Seed a personal/local-only memory. Ask a relevant question.

Expected:

- cloud provider receives zero request bytes for prompt containing that memory
- allowed local fallback may receive it
- denied candidates visible in trace/progress
- retrieval-denied events do not leak record text

### 4. CLI memory verbs

Run:

```powershell
pnpm fairy memory list --json
pnpm fairy memory search shell --json
pnpm fairy memory show <memory-id> --json
pnpm fairy memory delete <memory-id>
pnpm fairy memory rebuild
pnpm fairy memory search shell --json
```

Expected:

- list/search/show return parseable JSON
- show includes provenance/evidence
- delete removes the record
- rebuild does not resurrect deleted memory

### 5. Replay evidence

Run:

```powershell
pnpm fairy replay <session-id> --json
```

Expected:

- admission and retrieval `memory.gate.decision` events visible
- `memory.written` visible for safe memory
- `memory.deleted` visible after delete
- no denied memory text is present in retrieval-denied events

## Report back

Use the established format:

1. File tree delta.
2. Verification tails:
   - local commands,
   - CI link/status,
   - mock conformance verdict.
3. Decisions:
   - MemoryStore schema,
   - rebuild semantics,
   - retrieval scoring/gating semantics,
   - digest budget/rendering,
   - CLI command shapes.
4. Spec ambiguities.
5. Proposed docs edits.
6. Manual owner checklist with exact commands and evidence paths.
