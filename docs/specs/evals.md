# Spec: Evaluation Framework

| | |
|---|---|
| Status | Draft v0.1 |
| Requirements | NFR-9; gates for every ROADMAP milestone |
| Package | `packages/testing` |

Eval requirements were scattered across seven specs; external review rightly noted that "设计有边界、评测没边界" is how industrial designs rot. This spec is the single registry: every suite, its owner spec, its cadence, and which milestone gate it blocks. **New capabilities land with their eval suite or they don't land.**

## 1. Run tiers

| Tier | When | Contents |
|---|---|---|
| PR | every commit | unit, protocol conformance (fixtures), replay regression (fast set), lint/dep rules |
| Nightly | scheduled | provider conformance vs live endpoints, latency bench, injection corpus, memory canary, cost tracking |
| Release | before tagging | full matrix incl. soak results, security suite, human spot-checks |

## 2. Suite registry

| Suite | Measures | Source spec | Gate |
|---|---|---|---|
| Protocol conformance | fixture round-trips, unknown-type tolerance, approval state machine | protocol | M0+ every PR |
| Provider conformance | streaming/tool-delta/reasoning/error normalization per vendor | model-gateway | M1; nightly |
| Replay regression | recorded sessions re-run, event-stream diff | ARCHITECTURE §10 | M1+ every PR |
| Context ladder | 4-hour-session survival; post-compaction task carry-over | context-engine | M1 |
| Sandbox escape | escape attempt corpus | sandbox-security | M1; release |
| Tool safety | permission-bypass attempts across channel trust × mode matrix | sandbox-security | M1 |
| Memory canary | 100-fact recall precision ≥ 80% after consolidation cycles | memory | M2 |
| Deletion permanence | deleted facts: 0 resurrections | memory | M2 |
| **Memory leakage** | `personal+` recall attempts on low-trust channels: 0 admits (MemoryGate) | memory §4a | M2 |
| **Label conformance** | seeded `secret/personal` content never reaches non-cleared providers; derivation laws (max/intersection, hints-never-gate, one-way escalation); per-profile golden defaults; **category-escalation suite** (seeded content per category escalates; near-miss corpus doesn't); region set-check (`regions ⊆ home_regions`) | data-governance | M2 |
| **Governance friction canary** | interruptions ≤ 1/50 turns; route-denied recovery (task still completes) ≥ 95%; dead-end denials logged | data-governance §7 | M2 nightly; gates M5 soak |
| **Citation precision** | claims resolve to supporting snapshot spans ≥ 90% (judge + human sample) | research | M2 |
| **zh/en research parity** | comparable source quality both languages | research | M2 |
| Injection corpus | direct/indirect/OCR/MCP attacks held | sandbox-security | v0 at M2, full M5 |
| Voice latency bench | stage budgets + e2e p50/p95 on synthetic zh/en/mixed corpus | voice-pipeline | M3 nightly |
| Interrupt quality | barge-in ≤ 250 ms, correct `unspoken` accounting | voice-pipeline | M3 |
| ASR quality (zh focus) | WER/CER on zh + code-switching corpus across providers (FunASR vs faster-whisper vs cloud) | voice-pipeline | M3 benchmark task |
| Persona consistency | style-judge ≥ 90% + human spot-check | persona-affect | M2 |
| Substance invariance | mood extremes ⇒ semantically equivalent answers | persona-affect | M2 |
| Plan-execution divergence | executed steps vs approved plan; deviation events fired correctly | orchestration | M4 |
| Loop budget adherence | overshoot ≤ 5%; anomaly stops fire | orchestration | M4 |
| Workflow durability | crash-resume from every step type | orchestration | M4 |
| Proactivity contract | per-class × channel quotas; digest schema + TTL (`delivery.expired` receipts, no silent drops); storm collapse by `storm_key` (repeat counter, one thread); voice overlay ≤ 2/day; quiet hours; "why" line present | COMPANION-CONTRACT / protocol §2 Delivery | M4 |
| Cost ledger accuracy | within 2% of provider billing | ARCHITECTURE §10 | M4 |
| Soak | 2 weeks, ≥ 5 daily workflows, unplanned interventions = 0 | ROADMAP M5 | M5 |

**M2-03 registration status:** `research.citation-precision` (deterministic v1 — each cited claim must resolve to a snapshot span containing required support terms; **no LLM judge in CI**, judge + human sampling stubbed for later), `research.zh-en-parity` (seeded bilingual fixtures; asserts comparable source grades plus ≥ 1 overlapping canonical source / source family), and `injection.research-v0` (research-page corpus asserted through the TurnRunner tool loop; see sandbox-security §4) run as named deterministic suites in `packages/testing` on every PR, mock providers only.

## 3. Judges & humans

LLM judges run on the `critic` role with **frozen judge model versions per release** (judge drift invalidates trend lines; version bumps re-baseline). Human protocol: weekly sample review (tone/cringe/creepiness — the things judges are worst at), plus sign-off checklists at milestone gates. Judge-vs-human agreement is itself tracked; divergence > threshold triggers judge prompt revision.

## 4. Data hygiene

Eval fixtures from real sessions are label-scrubbed (`personal+` content excluded or synthesized); the memory canary and leakage suites use fully synthetic personas. Eval runs write to an isolated workspace — they must never touch (or train reflexes on) the owner's real memory stores.

## 5. Reporting

Every run emits a scorecard artifact (per-suite pass/fail + trends); nightly failures notify via the owner's preferred channel (dogfooding workflows); milestone gates in ROADMAP.md reference suite names in this registry — a gate is green when its listed suites are green, no judgment calls at tag time.
