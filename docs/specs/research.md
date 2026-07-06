# Spec: Research Orchestrator

| | |
|---|---|
| Status | Draft v0.1 |
| Requirements | FR-3, FR-3a |
| Package | `packages/research` |

`web.search` + `web.fetch` make a chatbot that can look things up. A *research-grade* Fairy needs query planning, multi-engine bilingual fan-out, deduplication, source grading, immutable snapshots, and claims that resolve to evidence. This subsystem provides that — adopted from external review, with one firm constraint of our own: **it is a library + tool namespace + policies driven by the single TurnRunner (ADR-012/015), never a second agent runtime.**

## 1. Position

```
casual lookup (S1):    main agent → web.search / web.fetch          (unchanged, cheap)
research task (S2):    main agent or researcher subagent → research.* tools
                         → research orchestrator (this package)
                         → search/fetch providers, snapshot store, citation ledger
```

The agent stays in charge of *judgment* (what to pursue, when enough is enough); the orchestrator owns *mechanics* (fan-out, dedup, grading, caching, citation bookkeeping). Escalation is a skill-encoded heuristic: multi-source questions, conflicting claims, or explicit "research/调研" intent.

## 2. Pipeline

| Stage | Behavior |
|---|---|
| **Query planning** | Decompose intent into sub-queries; **zh/en dual-path expansion** (terminology mapping both directions — 中文概念查英文源, vice versa); recency class per sub-query (`live | recent | evergreen`) sets engine params and result weighting |
| **Provider fan-out** | Parallel across configured engines (registry: ≥ 1 international + ≥ 1 China-accessible; per-engine query dialects); per-task budget caps total calls |
| **Normalization + dedup** | URL canonicalization (tracking params, mirrors, AMP), near-dup content signatures (shingling), cross-engine merge keeping best-ranked instance |
| **Source grading** | Type taxonomy `primary | official | news | blog | forum | sns | unknown` via domain rules (user-extendable lists) + heuristics; grade ∈ context for the agent, weight ∈ ranking; independence check (N claims from 1 syndicated source ≠ N sources) |
| **Fetch + clean** | Readability extraction; robots + per-domain policy respected (deny-listed domains never fetched); paywalls surfaced honestly (never bypassed); every fetched body enters context as **quarantined untrusted content** with `web:<domain>` provenance (sandbox-security §4) |
| **Snapshot cache** | Every cited page stored as immutable artifact (content-hashed cleaned text + metadata); re-fetch within TTL hits cache; citations point at snapshots, so link-rot never breaks a report |
| **Citation ledger** | Claims recorded as citation blocks (protocol §6) binding claim → snapshot span; synthesis must emit ledger refs, not bare URLs |
| **Source-set review** | For deep-research tasks: before synthesis, the source list (with grades, dates, independence notes) is presented — to the `critic` subagent by default, to the user on request — catching "10 sources, 8 from one press release" before it becomes a confident report. *v0 since M2-03: deterministic heuristic review only; the critic subagent is a later milestone (§7)* |

## 3. Tools

`research.plan(intent) → sub-queries` · `research.search(sub-query|plan)` · `research.fetch(url) → snapshot` · `research.cite(claim, snapshot, span)` · `research.sources() → graded source set`. Plain `web.search`/`web.fetch` remain for casual use — same providers, no ledger overhead.

## 4. Memory & governance interaction

- Research findings land in **artifacts** (reports) and the workspace **Chronicle** (memory spec §6a) — *not* in personal semantic memory. Facts *about the user* extracted from web content are never auto-persisted (untrusted provenance → MemoryGate default-deny); explicit user confirmation required.
- Snapshots inherit `web:` provenance and default `public` sensitivity label; fetched content from authenticated/personal pages defaults `personal` (data-governance spec).
- Injection defenses apply at full strength: quarantine wrapping, capability narrowing while snapshots are in the working set, egress guard on all outbound args. *M2 ships quarantine wrapping + provenance (asserted by `injection.research-v0`); capability narrowing and the egress guard are separate governance-hardening/M5 work (sandbox-security §4 status notes) — research quarantine must not be read as implying them.*

## 5. Config sketch

```yaml
research:
  engines:
    - { id: intl-a, kind: searx|api, weight: 1.0 }
    - { id: cn-a,   kind: api, weight: 1.0, locale: zh-CN }
  budgets: { default: {searches: 12, fetches: 20}, deep: {searches: 40, fetches: 60} }
  domains: { deny: [...], prefer_primary: [...], grade_overrides: {…} }
  snapshots: { ttl: 7d, max_store: 5GB, evict: LRU }
```

## 6. Evals (→ specs/evals.md)

Citation precision (claims resolving to snapshot spans that actually support them, judge-scored) ≥ 90%; citation coverage (substantive claims carrying citations); dedup effectiveness on seeded mirror sets; zh/en parity (same question asked in both languages reaches comparable source quality); dead-link immunity (reports remain verifiable with sources offline, via snapshots).

## 7. Implementation status — M2-03 (orchestrator v1)

*Shipped as `packages/research` + the `research.*` tool namespace (`packages/tools-std`), driven by the single TurnRunner tool loop. No second agent runtime, no critic subagent, no model call inside the orchestrator.*

- **Deterministic planning v1:** local heuristic decomposition only. Depth `quick | standard | deep` maps to bounded search/fetch budgets; zh intents fan out to zh + en subqueries, en intents add zh only on locale/term signals; plan and subquery IDs are deterministic. Budget exhaustion and fetch/timeout/robots/HTTP failures surface through `progress.update {stage: "research.budget_exhausted" | …}` and fields on the three registered research events (`snapshot.created.payload.fetch_error`, `sourceset.reviewed.payload.warnings[]`) — never silently dropped, no new canonical event type.
- **Snapshot cache v1:** immutable JSON artifacts under `<data-dir>/artifacts/research/snapshots/<snapshot_id>.json`; `snapshot_id` is content-addressed from the cleaned-content hash (cache key = `canonical_url` + `content_hash`); re-fetch within TTL hits cache; deny-listed domains yield honest fetch-error snapshots (never bypassed); snapshot bodies enter prompt context only as quarantined untrusted content (sandbox-security §4).
- **Canonicalization/dedup/grading v1:** scheme/host lowercased, tracking params stripped, remaining params sorted, fragments dropped, deterministic AMP-like variants normalized; dedup keeps one entry per canonical URL or content-equivalence signature; grade taxonomy `primary|official|news|blog|forum|sns|unknown` with explicit config/fixture overrides beating heuristics; `independence_key` defaults to source family/host, overridable.
- **Citation ledger v1:** `research.cite(claim, snapshot_id, span)` requires a stored snapshot, non-empty claim, and an in-bounds non-empty span; emits `citation.recorded` (protocol §6 shape; grade preserves the full 7-value source taxonomy incl. `sns`); bare URLs are not evidence; snapshot refs stay stable across re-fetch and replay.
- **Source-set review v0:** deterministic heuristic review emitting `sourceset.reviewed` (source ids, grades, independence keys, duplicate counts, warnings). An **empty source set returns a plain tool result and emits no `sourceset.reviewed`** — the registered schema requires ≥ 1 source.
- **CI:** mock search/fetch providers only (seeded duplicates, tracking-param variants, a shared zh/en canonical source for parity, and five injection pages); no real network.
