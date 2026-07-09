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
| **Voice protocol loopback** | deterministic loopback: registered-schema conformance of emitted speech events, partial/final ordering + id linkage, exactly one `turn.input` per final transcript, voice label floor + zero-byte under-cleared denial, MemoryGate hold/deny for spoken remember, egress denial with redacted diagnostics, TTS visibility boundary, replay incl. corrupt-tail | voice-pipeline | M3-01+ every PR |
| **Voice duplex transport** | deterministic worker-plane conformance: control-frame encode/decode + golden valid/invalid fixtures fail-closed, in-memory transport FIFO/close/overflow/max-frame-bytes, mock worker partial/final/TTS/cancel, frame-label one-way clamp on emitted events, cancelled utterance replayable with no `turn.input` and zero provider requests, no transport-frame types in JSONL, trust stack inherited (route/MemoryGate/egress/TTS boundary) | voice-pipeline | M3-02+ every PR |
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

**M3-02 registration status:** `voice.duplex-transport-v0` — deterministic PR-tier suite in `packages/testing` (4 gateway E2E tests, mock only; no socket/network/device/Python/provider/LLM judge): duplex frame protocol + max-frame-bytes guard, frame-label one-way clamp asserted on emitted `speech.asr.final`/`turn.input` (`public/global-ok` frame under balanced profile still floors at `personal/region-restricted` + `prefer_local`), cancelled-ASR session (`asr-cancelled` mark, no `turn.input`, zero provider requests, replay-clean), full trust inheritance (under-cleared deny + fallback, `personal_default_hold`/`secret_denied` spoken remember, egress block with redaction, TTS visibility boundary), and no `voice.frame.*`/`speech.worker.*`/base64 in JSONL. Package/CLI-level coverage (14 `@fairy/voice` unit tests + CLI duplex JSON tests) backs the suite. Voice latency, interrupt/barge-in, ASR zh/en/mixed, and real ASR/TTS provider conformance remain **future M3 slices — visibly deferred, never fake-passed**.

**M3-01 registration status:** `voice.protocol-loopback-v0` — deterministic PR-tier gateway E2E suite in `packages/testing` (mock providers, no audio device/network/LLM judge): emitted speech events schema-validated against the registered `speech.*.v1` schemas; loopback ordering + `utterance_id`/`chunk_id`/`mark_id` linkage; exactly one `turn.input` (provenance `user`, channel `voice`) per final transcript with ASR partials producing zero model calls; balanced voice floor on the emitted turn.input with under-cleared-primary zero-request denial + cleared fallback; spoken remember → MemoryGate `personal_default_hold` (safe) / `secret_denied` (secret), no `memory.written`; spoken-secret egress denial with redacted diagnostics; TTS chunks derived only from visible `turn.final` text (hidden reasoning/denial text asserted absent); replay text/JSON rendering with corrupt-tail tolerance unchanged. The three M3 voice benches above (latency, interrupt, ASR quality) remain **future M3 slices — visibly deferred, never fake-passed**.

**M2-03 registration status:** `research.citation-precision` (deterministic v1 — each cited claim must resolve to a snapshot span containing required support terms; **no LLM judge in CI**, judge + human sampling stubbed for later), `research.zh-en-parity` (seeded bilingual fixtures; asserts comparable source grades plus ≥ 1 overlapping canonical source / source family), and `injection.research-v0` (research-page corpus asserted through the TurnRunner tool loop; see sandbox-security §4) run as named deterministic suites in `packages/testing` on every PR, mock providers only.

**M2-08 registration status:** `chronicle.workspace-v0` (append/query/list through the tool loop, workspace scoping, secret rejection with no record created, digest relevance + label routing with zero-byte under-cleared denial, no personal-memory auto-write) and `dream-cycle.consolidation-v0` (deterministic report artifact with content-derived labels, provenance quotes, secret redaction receipts, pending-only learned-skill drafts, idempotent re-run, no scheduler/model calls) — deterministic PR-tier gateway E2E suites, mock only. The memory canary and contradiction benchmarks remain **visibly deferred** (`describe.skip` + throw) until model-backed consolidation lands.

**M2-07 registration status:** `context.compaction-regression` — deterministic PR-tier suite in `packages/testing` (gateway E2E): forced L4→L5 with task/decision/todo carry-over, artifact + memory/research/perception ref survival, failed-tool information retention, quarantine no-laundering across compaction, summary label inheritance gating the main route (zero bytes to an under-cleared primary post-compaction), compactor-call clearance (zero bytes to an under-cleared summarizer), and replay/manifest rendering. Mock providers only; no LLM judge.

**M2-06 registration status:** `perception.quarantine-v0` — deterministic PR-tier suite in `packages/testing` (gateway E2E): benign screenshot describe + bilingual OCR + long-OCR spillover, malicious screenshot injection quarantine (request-body role partition), fake-API-key OCR escalation with under-cleared-primary route denial + local fallback, and OCR-derived secret egress denial with redacted diagnostics. Mock perception only; no real vision/OCR API in CI.

**M2-05 registration status:** `persona.consistency` (deterministic PR-tier fixture suite: persona style markers in allowed contexts, distress ⇒ humor suppression; the style-judge ≥ 90% version in the table above is deferred until a frozen judge is configured) and `substance.invariance` (same task at affect extremes ⇒ identical tool calls, permission decisions, route decisions, and factual payload; deterministic diff, no LLM judge) run in `packages/testing` on every PR.

**M2-04 registration status:** `label.conformance` (derivation laws, category escalation + near-miss non-escalation, provider clearance, egress blocking, redaction diagnostics) and `governance.friction-canary` v0 (deterministic route-denied-recovery report; **PR-tier fixture suite for now** — the nightly cadence and soak thresholds in the table above activate with real workloads) run as named deterministic suites in `packages/testing`, mock providers/tools only.

## 3. Judges & humans

LLM judges run on the `critic` role with **frozen judge model versions per release** (judge drift invalidates trend lines; version bumps re-baseline). Human protocol: weekly sample review (tone/cringe/creepiness — the things judges are worst at), plus sign-off checklists at milestone gates. Judge-vs-human agreement is itself tracked; divergence > threshold triggers judge prompt revision.

## 4. Data hygiene

Eval fixtures from real sessions are label-scrubbed (`personal+` content excluded or synthesized); the memory canary and leakage suites use fully synthetic personas. Eval runs write to an isolated workspace — they must never touch (or train reflexes on) the owner's real memory stores.

## 5. Reporting

Every run emits a scorecard artifact (per-suite pass/fail + trends); nightly failures notify via the owner's preferred channel (dogfooding workflows); milestone gates in ROADMAP.md reference suite names in this registry — a gate is green when its listed suites are green, no judgment calls at tag time.
