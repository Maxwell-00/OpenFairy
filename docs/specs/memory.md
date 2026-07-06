# Spec: Memory

| | |
|---|---|
| Status | Draft v0.1 |
| Requirements | FR-4, NFR-4 |
| Package | `packages/memory` |

Fairy's memory is what turns a chatbot into a companion: it must get *measurably* better-informed over weeks, stay correctable, and never be creepy. Design synthesizes Letta (agent-managed in-context blocks), Mem0 (extract-and-retrieve), and Zep (temporal validity) — embedded locally, no external memory service.

## 1. Memory model — four stores

| Store | Contents | Lives | Medium |
|---|---|---|---|
| **Working** | Persona block, user block, current-task block, scratch block | In the context window, every turn | Context zones (context-engine spec) |
| **Episodic** | What happened: turn events, per-session summaries, outcome records | Forever (user-controlled) | Session logs + summary rows (SQLite FTS) |
| **Semantic** | Facts, preferences, entities, relationships — with provenance, confidence, temporal validity | Until superseded/decayed/deleted | SQLite + FTS5 + sqlite-vec |
| **Procedural** | Learned skills/how-tos ("how the user likes commit messages") | Until revised | `extensions/skills/learned/` markdown (gated, see §6) |

## 2. Working memory (short-term, FR-4 P0)

Letta-style **agent-editable blocks** with hard size budgets, persisted in session snapshots and surviving compaction:

- `user` block: durable profile digest (name, languages, current projects, hard preferences) — rebuilt by the consolidation daemon, agent-editable in-session via `memory.remember`.
- `task` block: current goals/todo — the recitation mechanism (context-engine spec) keeps attention on it.
- `scratch`: agent's own notes across compaction.

Tools exposed to the agent: `memory.remember(fact, tier)`, `memory.update_block(block, patch)`, `memory.search(query, store?)`, `memory.forget(id|query)`. Writes emit `memory.written` events (auditable, hookable).

## 3. Semantic store & ingestion

**Record shape:** `{id, text, entities[], kind: fact|preference|event-fact, tier: general|personal|secret, confidence, provenance: {sid, turn, quote}, valid_from, valid_to?, superseded_by?, embedding, last_used, use_count}`

**Ingestion pipeline** (async, off the hot path, `memory.extractor` role — a cheap model):

```
turn completed → extractor proposes candidate memories (with quotes)
  → tier filter (`secret` tier → dropped unless explicit user command)
  → dedup/merge: embedding similarity + entity match against existing records
      · duplicate → bump confidence/use_count
      · contradiction → temporal supersession (old fact gets valid_to, not deleted)  [Zep-inspired]
      · novel → insert with provenance
```

Nothing is stored without provenance — every fact can answer "why do you think that?" with a quote and a session link.

## 4. Retrieval

Per-turn **memory digest** assembled within a token budget (context-engine zone):

- Hybrid scoring: FTS (BM25) + vector similarity + recency boost + use-frequency + tier weight.
- Query = current input + task block headline (not the whole history).
- Temporal filter: facts valid *now* unless the query asks about the past.
- Digest renders as compact bullets with confidence markers; agent can pull more via `memory.search` when the digest hints at depth (`…12 more entries about X`).

Targets: retrieval ≤ 80 ms p50 (embedded stores make this easy); digest ≤ 600 tokens default.

### 4a. MemoryGate — admission control

Similarity says *relevant*; the gate decides *admissible*. Recent agent-memory research is blunt about why: retrieval is itself a security and behavior boundary (cross-context leakage, sycophantic reinforcement, memory-induced drift). Between scoring and the digest sits a deterministic gate:

```
admit(record, ctx) where ctx = {channel_trust, workspace, mode, task_class, labels}
  · label rule:    sensitivity ≤ channel/provider clearance (data-governance spec)
  · scope rule:    workspace-scoped records don't cross workspaces; Chronicle ≠ personal
  · mode rule:     loop/workflow turns admit task-relevant tiers only (no ambient personal recall)
  · relevance floor: below-threshold "creepy recall" suppressed even if labels allow
```

Gate decisions (admit/deny + rule) are `memory.gate.decision` events — auditable, and the leakage eval suite asserts on them. Denials are silent to the model (the digest simply omits) — the gate must not become an oracle.

*Implementation status: M2-01 shipped the gate in **admission-only** mode (explicit-remember candidates: secret→deny, personal→hold, internal→allow; no retrieval, no stores, no embeddings). **M2-02 shipped MemoryStore v1 + retrieval-side gating (`phase: retrieval`):** the store is a rebuildable SQLite projection over session JSONL (`memory.written`/`superseded`/`deleted`), never a second source of truth; secret records are rejected at projection insert (both `insert()` and event projection); retrieval denials carry reason code + record id but never the record text; admitted digest labels join the effective prompt labels before route clearance (context-engine §1, data-governance §3). Retrieval reason codes: `admit`, `below_relevance_floor`, `deleted_or_superseded`, `label_clearance_denied`, `scope_mismatch`. Delete is hard-delete + tombstone; rebuild keeps tombstoned ids deleted. CLI: `fairy memory list|search|show|delete|rebuild`. Vector retrieval stays deferred to the ROADMAP M2 sqlite-vec-vs-LanceDB decision gate.*

### 4b. Evidence pull-through

Digest bullets are lossy by design; correction and trust need the original. `memory.evidence(id)` returns the fact's provenance quote **plus the surrounding episode slice** (adjacent turns from the session log), so Fairy can answer "你为什么这么认为？" with receipts, and the user can spot extraction errors at the source. Evidence slices inherit the record's labels and pass the same gate.

## 5. Consolidation daemon — the "dream cycle" (FR-4 P1)

A nightly workflow (orchestration spec) using cheap roles, inspired by sleep-time compute:

1. **Episode summarization:** each day's sessions → structured summaries (what was done, decisions, open loops) → episodic rows.
2. **Promotion:** repeated/high-confidence candidates → stable semantic facts; user-block digest rebuilt.
3. **Contradiction sweep:** conflicting facts resolved by temporal supersession or flagged for user review.
4. **Decay:** `last_used`/`use_count`-based demotion; stale low-confidence facts archived (not deleted) after N days.
5. **Index maintenance:** embeddings refreshed on model change; FTS vacuum.
6. **Memory report artifact:** "what I learned this week" — user-reviewable, part of transparency.

Budgeted (tokens + wallclock), checkpointed, resumable — it's a normal workflow, no special machinery.

## 6. Procedural memory (learned skills)

When Fairy notices a repeated correction/pattern ("always use pnpm", "commit messages in English, imperative"), the consolidation daemon may draft a learned skill file. **Gated:** drafts land in `learned/pending/` and are proposed to the user before activation (prevents self-reinforcing bad habits — cf. Hermes self-improvement, but with a human gate).

## 6a. Workspace Chronicle (project memory)

Personal memory and project memory obey different physics: "user is allergic to shellfish" and "the last three attempts to fix flaky test X failed via approach Y" should never share a scoring model. Each workspace gets a **Chronicle**: an append-only, workspace-local record of attempts, failures, fragile files, decisions, and their outcomes — fed by coder/loop/critic events and consolidation, stored under the workspace (portable with the repo if the user opts to commit it).

- Tools: `chronicle.log(entry)`, `chronicle.query(topic|file)`; auto-brief: coder/loop/reviewer contexts get a Chronicle digest for the files/topics they touch ("approach Y failed twice: see entries 41, 47").
- Loop mode appends an entry per iteration (complements `PROGRESS.md`); the `no_progress` detector reads it.
- Chronicle entries are `internal` sensitivity by default, workspace-scoped at the gate; research findings for a project also land here (research spec §4) rather than in personal memory.

## 7. Privacy tiers & user control (FR-4)

- Tiers: `general` (freely used) · `personal` (used, never leaves local stores, excluded from any telemetry) · `secret` (session-only; never persisted; extractor-filtered).
- User verbs (CLI + clients): `/memory list|search|show <id>|edit|delete|export`. Delete is **hard delete** plus tombstone (hash-only) so consolidation can't resurrect it (PRD accept criterion).
- Everything is local SQLite/Markdown — export = copy files.

## 8. Storage & scale

SQLite (WAL) + FTS5 + sqlite-vec in v1: zero-ops, portable, fine to ~1M records. Interface `MemoryStore` hides the engine; LanceDB is the designated upgrade path if vector scale demands (ROADMAP decision gate at M2). Embeddings via `embedder` role (local model preferred for privacy).

## 9. Evaluation

- **Canary benchmark:** 100 seeded facts across simulated sessions; measure recall precision/at-k after consolidation cycles (PRD target ≥ 80%).
- **Deletion test:** deleted facts must never reappear in digests (0 tolerance).
- **Contradiction test:** updated preferences must win within one dream cycle.
- **Leakage suite:** scripted `personal+` recall attempts on low-trust channels and in loop/workflow modes: zero gate admits (asserted on `memory.gate.decision` events).
- **Creepiness review:** memory report shown to user weekly; relevance-floor suppression sampled by humans.
