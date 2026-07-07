# Spec: Context Engine

| | |
|---|---|
| Status | Draft v0.1 |
| Requirements | FR-10, NFR-9 |
| Package | `packages/kernel` (context module) |

The context window is Fairy's scarcest resource, and — because any OpenAI-compatible model can be the brain — its size, tokenizer, and caching behavior vary per model. The context engine makes prompt assembly deterministic, budgeted, cache-friendly, and reducible under pressure.

## 1. Zone model

Every prompt is assembled from ordered **zones**, each with a budget (absolute tokens or % of window) and a priority class:

| # | Zone | Content | Budget (default) | Reduction class |
|---|---|---|---|---|
| 1 | System | Capabilities, rules, output contracts | fixed ~1.5k | never |
| 2 | Persona + affect | Persona core + compact mood state line. *Implemented M2-05: populated from the loaded persona pack + one affect line; disabled persona renders a minimal plain-assistant zone; `context.manifest.zones[]` accounts `persona` tokens* | fixed ~800 | never |
| 3 | Tool schemas | All registered tools (stable set, see §4) | fixed | mask, don't remove |
| 4 | Memory digest | Working blocks + gate-admitted retrieval digest (specs/memory §4a) | ~1.5k | shrink digest first |
| 5 | Skills index | Skill names + one-liners (bodies load on demand) | ~400 | fixed |
| 6 | Task state | Plan/todo recitation block | ~600 | recompute, keep tail |
| 7 | History | Turns, tool calls/results | remainder | the reduction ladder (§3) |
| 8 | Current input | New user content + perception artifacts | as needed | spillover to files. *Implemented M2-06: artifact content parts render as compact `[artifact]` blocks (id/hash/path/mime/labels/provenance/description/OCR excerpt) — never raw base64/blob (test-asserted); artifact labels join effective prompt labels before route clearance, same rule as memory/research/persona; long OCR spills to the structured perception artifact via the standard tool-output budgeting (L1), accounted under existing input/tool zones — no new zone* |

Zones 1–5 form the **stable prefix**: byte-identical across turns of a session wherever possible, maximizing provider KV-cache hits (Manus: cache hit rate is the #1 cost/latency lever). Volatile data (timestamps, mood) is quantized (mood updates only at turn boundaries; no seconds-precision timestamps in the prefix). *Enforced since M2-05b: the affect line renders only the quantized mood bucket `(stance, energy, humor-suppressed)` — the free-text `cause`, raw valence/arousal values, and timestamps never enter the prefix (the per-turn "why" lives in the `affect.updated` event, surfaced via `/affect` and replay). Same-bucket turns are byte-identical; the M2-05 owner smoke test caught the pre-fix violation as a per-turn `prefix_hash` drift.*

## 2. Assembly rules

- **Append-only history.** Past turns are never edited in place (breaks cache + confuses models). Reductions replace ranges with explicit placeholder records (`[3 turns elided: summary …]`) — visible, deterministic, logged as events.
- **Deterministic serialization.** Stable key order in JSON, stable message ordering; same session state ⇒ same prompt bytes.
- **Per-model accounting.** Token counts via the model gateway's tokenizer service (exact where available, calibrated estimate otherwise); budgets recomputed when the role router switches models (a fallback switch can shrink the window mid-session — the ladder handles it).
- **Errors stay.** Failed tool calls and their errors remain in history (Manus: models steer away from repeated failures only if they can see them). They compress last.
- **Memory digest is gate-admitted and label-bearing.** Zone 4 is populated only by MemoryGate-admitted records (specs/memory §4a); the digest carries the max/intersection of admitted-record labels, and those labels join the effective prompt labels **before** route clearance (data-governance §3) — a `personal/local-only` memory forces a local-cleared route or a visible `route.denied`. Digest budget: config `context.memory_digest_budget` (default 600 tokens; *implemented M2-02*).

## 3. Reduction ladder (FR-10)

Triggered predictively (projected next-call tokens > threshold), stages applied in order until under budget:

| Stage | Action | Loss |
|---|---|---|
| L1 Output budgeting | Truncate oversized tool outputs at ingest; full output → artifact file, context keeps head+tail + path | none (recoverable by path) |
| L2 Elision | Old tool-result *bodies* replaced by one-line digest + artifact ref (call + digest retained) | low |
| L3 Turn snipping | Oldest non-pinned turn ranges → placeholder summaries | medium |
| L4 Micro-compaction | Re-summarize accumulated placeholders + stale scratch into one block | medium |
| L5 Full compaction | Whole history → structured handoff (state · decisions · open todos · file refs · recent verbatim tail); new context = prefix + handoff + tail | high, bounded |

Pinning: user messages, the task block, and turns marked `pin` by the agent survive L3/L4. L5 correctness is guarded by the replay regression suite (post-compaction task carry-over tests, PRD accept criterion).

*Implemented M2-07 (ladder complete):* L4 triggers when the post-L1–L3 projection still exceeds budget or accumulated L2/L3 placeholders exceed `context.l4_placeholder_threshold`; L5 only after a successful L4 that still overflows. Compaction is model-backed via the configured `context.compaction_role` (default `summarizer`) through the normal gateway — **the compaction call is itself route-clearance-gated over the source-range labels** (an under-cleared summarizer receives zero request bytes; cleared fallback or fail-closed skip). Compactor input is bounded and scrubbed (secret text hash-omitted, base64/blob stripped, previews truncated); output is schema-validated and **fails closed** — invalid L4 keeps the L1–L3 path, invalid L5 keeps the L4 path, never a silent history drop (visible `context.compaction.skipped` progress). Summaries are appended artifacts (JSONL never rewritten); L5 emits `session.compacted {range, summary_ref}`; L4 is visible via `artifact.created` + `reduction_stages_applied`. L4/L5 projections are pinned implementation metadata so later reduction passes don't erase them; quarantined untrusted content stays quarantine-framed in the handoff (no laundering, E2E-gated by `context.compaction-regression`); summary labels derive max/intersection from source ranges and re-gate the main route post-compaction.

## 4. Cache discipline (Manus lessons, adopted)

- **Mask, don't remove, tools.** The tool zone is stable for the session; availability changes are enforced by the tool router (permission engine) and, where supported, constrained decoding — not by editing schemas (which invalidates cache and confuses models about past calls).
- **Filesystem as context.** Anything bulky (pages, datasets, long outputs) is a file under `sessions/<sid>/artifacts/`; context holds paths + digests; the agent re-reads on demand. Compression must be restorable.
- **Recitation.** The task block (zone 6) is re-rendered near the end of the prompt each turn — the todo-rewriting trick that keeps long tasks on target.
- **Controlled diversity.** Serialization templates include mild structural variation *only* in zones outside the stable prefix, to avoid few-shot rut in repetitive workflows.

## 5. Sub-context isolation

Subagents get fresh contexts built from: their role prompt + a **task brief** composed by the parent (not the parent's raw history) + tool zone scoped to their allowlist. Returns are structured summaries + artifact refs — never raw transcripts (orchestration spec). Loop-mode iterations get *only* files (goal, progress, repo state): the context engine's job there is assembling a clean cold-start prompt cheaply.

## 6. Observability

Every assembled prompt logs a **context manifest** event. Normative payload as of M1-03: `{zones: [{name, tokens, estimated}], budget, window, output_reserve, projected_tokens, reduction_stages_applied, prefix_hash, model}` — `projected_tokens` includes the output reserve (prompt-only projection overflows during generation), and `prefix_hash` covers the stable prefix (system + tools zones; since M2-05 also the persona/affect zone — since M2-05b that zone is bucket-quantized, so the hash changes only on a mood-**bucket** shift, never on mere `cause`/valence/arousal value changes; tests assert byte-identical prefix across same-bucket turns), so it should be constant across a session's turns absent a bucket change. Tokens-by-provenance is a later addition. Manifests are observational only and never enter prompt assembly. The replay debugger (`fairy replay --manifests`) renders them as a per-turn table — context bugs become visible instead of vibes. Ledger correlation of cache-hit rates with cost per provider arrives with the ledger (M4).
