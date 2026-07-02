# Architecture Decision Records

Format: context → decision → consequences. Statuses: `accepted` | `proposed` | `superseded`.
New ADRs append; never rewrite history.

---

## ADR-001 — TypeScript core + Python speech workers · `accepted`

**Context.** Agent tooling ecosystem (pi, OpenClaw, Claude Code lineage, MCP SDKs) is strongest in TypeScript; local speech ML (faster-whisper, CosyVoice, GPT-SoVITS, Silero) is Python-only.
**Decision.** Gateway/kernel/clients in TypeScript (Node ≥ 22). Speech runs in separate Python worker processes behind a versioned duplex protocol. No other Python in the core.
**Consequences.** Two runtimes to package (accepted cost; workers are optional when using cloud speech). Clean seam doubles as the remote-GPU deployment boundary. Rust rewrite of hot paths remains possible later behind the same protocols.

## ADR-002 — OpenAI Chat Completions as primary wire format · `accepted`

**Context.** Requirement: any OpenAI-compatible LLM must work; main and subagents may be different vendors. Chat Completions is the industry lingua franca; Responses/Anthropic APIs are richer but vendor-specific.
**Decision.** Internal model = superset of Chat Completions. All providers via transports (`openai-chat` primary; `openai-responses`, `anthropic` secondary). Normalization at the gateway edge only; vendor SDKs allowed nowhere else.
**Consequences.** Fairy runs against vLLM/Ollama/DeepSeek/Qwen/OpenRouter/etc. out of the box. We own a normalization layer and a per-provider conformance suite — this is the tax, paid once, tested forever.

## ADR-003 — Resident gateway control plane; thin clients · `accepted`

**Context.** "Always-on companion" needs presence: multi-device, proactive routines, long-running work while UIs are closed. (OpenClaw/Hermes gateway patterns.)
**Decision.** One daemon owns sessions, memory, scheduling, tools. Clients (CLI/desktop/web/IM) speak one WS+HTTP protocol and hold zero business logic.
**Consequences.** Any-device continuity and proactivity come free. Cost: users must run a daemon (installer + docs must make this painless); localhost-by-default posture (sandbox-security §7).

## ADR-004 — Event-sourced sessions (append-only JSONL + snapshots) · `accepted`

**Context.** Sessions must survive crashes, render identically on every client, and be debuggable after the fact.
**Decision.** Every observable fact is an event envelope appended to a per-session JSONL log; snapshots bound replay cost; UIs are pure renderers of the stream.
**Consequences.** Replay debugging, regression-by-replay, and multi-client sync fall out naturally. Cost: discipline (schema versioning, no side-band state) and log hygiene (blobs must go to artifacts).

## ADR-005 — SQLite family for all structured storage · `accepted`

**Context.** Single-user local-first system; ops burden must be ~zero (NFR-4/6).
**Decision.** SQLite (WAL) for core/memory/audit/ledger; FTS5 + sqlite-vec for search; filesystem for artifacts. No server database in v1.
**Consequences.** Zero-ops, trivially portable and backupable, adequate to ~1M memory rows. Escape hatch: `MemoryStore` interface; LanceDB evaluated at M2 gate if vectors outgrow sqlite-vec.

## ADR-006 — Turn-based streaming voice pipeline (not end-to-end S2S) · `accepted`

**Context.** Realtime speech-to-speech models (e.g., OpenAI Realtime) minimize latency but lock the brain to specific vendors — violating the model-freedom requirement — and bypass Fairy's tools/memory/persona machinery.
**Decision.** VAD → streaming ASR → text brain → incremental TTS, with a two-lane design (fast ack + agentic) and semantic endpointing to close the latency gap. Speech stages are roles with pluggable providers.
**Consequences.** Any text model can be Fairy's brain; custom local voice (GPT-SoVITS/CosyVoice) possible. We accept ~200–400 ms latency disadvantage vs. best S2S and mitigate in the pipeline. A future `s2s` transport can slot in behind the voice coordinator without redesign.
*Amendment (2026-07-02, post external review):* WebRTC implementation stays post-v1, but the client audio transport must be behind a conformance-tested interface from M3 (loopback second implementation); v1 mobile voice reach = IM voice notes.

## ADR-007 — Hybrid embedded memory (blocks + episodic + semantic + procedural) · `accepted`

**Context.** Letta-style blocks give in-context continuity; Mem0-style extraction gives cheap recall; Zep-style temporal validity handles contradictions. External memory services conflict with local-first privacy.
**Decision.** Implement all four tiers natively over SQLite (memory spec), with agent-managed blocks, async extraction, temporal supersession, and a nightly consolidation workflow. No external memory service.
**Consequences.** We own more code than adopting one library, but memory is a core differentiator and privacy boundary; benchmarks (canary suite) keep us honest.

## ADR-008 — Container-first sandbox; disable rather than weaken · `accepted`

**Context.** Model-authored code is untrusted (Codex precedent: OS-level enforcement). Fairy targets Windows too, where kernel-level sandboxing primitives differ.
**Decision.** Per-session containers with profiles (`safe/dev/trusted`); process-isolation fallback (Landlock/Seatbelt) where containers are unavailable; on bare Windows without Docker/WSL2, execution tools are disabled, not degraded.
**Consequences.** Docker Desktop/WSL2 becomes a Windows prerequisite for execution features (documented onboarding); in exchange, one coherent security story and testable escape suite.

## ADR-009 — MCP as the external tool protocol · `accepted`

**Context.** MCP is the emerging cross-vendor standard with a large server ecosystem; inventing a proprietary plugin API duplicates it badly.
**Decision.** Fairy is an MCP *client* with per-server trust levels; native tools use the internal registry; skills/hooks/personas remain file-based extensions.
**Consequences.** Instant tool ecosystem; injection surface widens — mitigated by provenance + trust levels (sandbox-security §6). Serving Fairy itself *as* an MCP server is deferred (post-v1).

## ADR-010 — Affect is a bounded presentation layer · `accepted`

**Context.** Requirement FR-5 ("有情感") vs. honesty and user-wellbeing risks of simulated emotion.
**Decision.** Deterministic clamped state machine (valence/arousal/stance) updated by appraisals; expression limited to tone/voice/acks; hard rails: no substance changes, no dark patterns, full disclosure, one-line off switch.
**Consequences.** Believable moods without deception; testable (substance-invariance suite). Rejects the alternative (letting the LLM improvise feelings), which is unbounded and unauditable.

## ADR-011 — Roles, not models, throughout the system · `accepted`

**Context.** Cross-vendor main/subagents (FR-7/12) and per-task cost/latency tiers need indirection.
**Decision.** Every model consumer names a role (`main`, `subagent.research`, `summarizer`, `perception.vision`, `voice.fastpath`, `embedder`, …); config binds roles to registry models with fallback chains.
**Consequences.** Vendor mixing is pure config; budgets/latency policies attach to roles; testing can bind all roles to a mock provider.

## ADR-012 — One TurnRunner; modes are policies · `accepted`

**Context.** Subagents, plan, loop, workflows, and voice could each grow bespoke agent loops (multiplied maintenance, divergent bugs — anti-pattern observed across the ecosystem).
**Decision.** Exactly one agent-loop implementation. Plan mode = tool-policy wrapper; loop mode = fresh-context re-invocation policy; subagents = scoped spawn of the same runner; workflows call it as a step type.
**Consequences.** Fixes and instrumentation land everywhere at once; policies are independently testable; slight generality tax in the runner API.

## ADR-013 — Docs-first, English-primary · `accepted`

**Context.** Owner works zh/en; industrial practice and the widest reviewer/tooling audience favor English design docs.
**Decision.** Design docs and code identifiers in English; UI strings, persona style guides, and ASR/TTS treat zh-CN and en-US as co-first-class (NFR-10).
**Consequences.** Occasional translation overhead for zh-native concepts (e.g., 代行 rendered as "proxy actions") — glossary kept in persona style guides.

---

*ADR-014 through ADR-018 respond to an external design review (`ChatGPT_Suggestions/deep-research-report.md`, 2026-07). Suggestions were adopted selectively; each ADR records where we diverged from the review and why.*

## ADR-014 — Runtime event canon is the internal IR; Chat Completions is a boundary dialect · `accepted`

**Context.** The review warned that a Chat-Completions-shaped internal abstraction turns approvals, progress, citations, and voice into bolt-on side channels ("chat wrapper drift"). Partially a misreading of ADR-002 — our sessions were already event-sourced — but the underlying risk is real because the canon was informal: no normative type registry, no payload schemas, no fixtures.
**Decision.** Three planes, formalized in specs/protocol.md: runtime event canon (normative, versioned, golden fixtures — the only language of kernel/orchestrator/clients/logs); model-boundary dialect (CC superset, existing *only* inside model-gateway transports); client protocol (a filtered view of the canon). Approvals, progress, citations, gate decisions, route denials are first-class event types. ADR-002 stands unchanged for the model boundary — it is the root of the "any OpenAI-compatible LLM" requirement and is not up for renegotiation.
**Consequences.** Schema governance overhead (fixtures per type, evolution rules) — paid at M0–M1 when it's cheap. Clients, replay, and tests share one contract; voice/approval/workflow can't drift into parallel protocols.

## ADR-015 — Research is a subsystem, not a tool pile — and not a second runtime · `accepted`

**Context.** Review: `web.search + web.fetch` cannot support deep research (no query planning, bilingual fan-out, dedup, grading, snapshots, citations); risks include link-rot reports, syndication-inflated confidence, and injected web content contaminating memory.
**Decision.** `packages/research` (specs/research.md): planning → fan-out → dedup → grading → snapshot cache → citation ledger → source-set review, exposed as `research.*` tools. Divergence from review: it is a library + policies driven by the single TurnRunner (ADR-012), never a separate orchestration loop; plain `web.*` tools remain for casual lookups.
**Consequences.** Research reports become verifiable artifacts (claims → snapshot spans) and survive dead links; cost: a substantial new package and eval suites (citation precision, zh/en parity) pulled forward to M2.

## ADR-016 — Data labels & residency as a first-class routing dimension · `accepted`

**Context.** Review: with a local main brain, overseas subagents, third-party vision, and cloud speech, "can we call it" must become "may this content go there." Vendor/region landscapes shift; geography must be user-owned config.
**Decision.** Two label axes (sensitivity `public<internal<personal<secret`; residency `local-only/region-restricted/global-ok`) on all content; auto-derivation (max/intersection); provider `data_clearance` in the model registry; enforcement at exactly five points (role router, MemoryGate, egress guard, telemetry redaction, export). Deliberately not a general ABAC engine.
**Consequences.** "Sovereign" becomes checkable (label-conformance suite, 0-tolerance) instead of a slogan; friction is a budgeted, tested quantity (≤ 1 interruption / 50 turns in soak). Cost: label plumbing must exist from M0–M1 — retrofitting labels is the one thing that would be brutally expensive later.

## ADR-017 — MemoryGate admission + workspace Chronicle · `accepted`

**Context.** Review, citing recent agent-memory research: retrieval is a security/behavior boundary (cross-context leakage, creepy recall, memory-induced drift), and lossy extraction without evidence pull-through makes corrections untrustworthy; project memory mixed into personal memory corrupts both.
**Decision.** Deterministic MemoryGate between scoring and digest (labels × channel trust × workspace × mode + relevance floor; decisions are auditable events); `memory.evidence(id)` returns provenance quote + surrounding episode slice; per-workspace append-only Chronicle for attempts/failures/decisions, auto-briefed to coder/loop/reviewer.
**Consequences.** "Fairy knows me" stops being spooky (surprise minimization is enforceable); loops stop retrying known-failed approaches. Cost: gate rules are config that must ship with sane defaults, and one more store scope to test.

## ADR-018 — Computer-use ABI reserved now, implemented post-v1 · `accepted`

**Context.** Review: without browser/computer use, "代行" tops out at files/shell/fetch; but the surface is the riskiest in the system and would tax an unproven permission model.
**Decision.** specs/computer-use.md locks tool names, event types, permission classes, credential wall, takeover protocol, and label defaults into the protocol registry now; implementation is gated on post-v1 security-suite stability (two consecutive green releases).
**Consequences.** M4 workflows and protocol fixtures need no breaking changes when it lands; the cost of reserving (a spec + registry entries) is trivial against the cost of retrofitting.

---

*ADR-019 and ADR-020 respond to the second external review round (`ChatGPT_Suggestions/chatgpt_review.md`, 2026-07), which audited the round-one changes.*

## ADR-019 — Residency is a constraint, locality preference is a hint; defaults ship as profiles · `accepted`

**Context.** Round-one data-governance draft leaked `local-preferred` into the residency enum — a type error (constraint and preference conflated) that would have made routing untestable. Separately, one global default table cannot serve both daily usability (everything `personal` ⇒ constant route denials) and privacy posture (everything `internal` ⇒ hollow sovereignty).
**Decision.** Residency stays a closed three-value hard constraint; `routing_hints.prefer_local` is a separate non-gating field that reorders cleared candidates only. Defaults become three profiles — `balanced` (default), `sovereign`, `cloud-friendly` — every source labeled on **both** axes in every profile. Own addition beyond the review: **one-way semantic escalation** — extractors may raise sensitivity by content class (health/finance/credentials-adjacent), never lower it, closing the "sensitive revelation inside casual `internal` chat" hole that `balanced` would otherwise open.
**Consequences.** Hints-never-gate and escalation-one-way become property tests; profiles are golden-tested config diffs, and the user chooses a posture instead of learning a label system. Cost: three default tables to maintain instead of one.
*Amendment (round 3):* escalation is table-driven per category (deterministic targets; only the category classifier is probabilistic and evaluated); `region-restricted(home)` resolves from `governance.home_regions` config with providers declaring `regions`, clearance = `regions ⊆ home_regions` set check.

## ADR-020 — Proactivity quotas are per-class, not per-channel-total · `accepted`

**Context.** Flat per-channel caps (5/day desktop) let routine completions crowd out a critical failure — or force important events to bypass quota, which destroys the quota's meaning.
**Decision.** Workflows declare an initiative class (`critical | briefing | completion | suggestion`); quotas are a class × channel matrix (COMPANION-CONTRACT §1) enforced by the scheduler. `critical` (user-assigned task failures) is quota-exempt on desktop with storm-collapse; overflow always rolls into a digest, never drops silently. Own additions: proactive **voice** is a delivery overlay budget (≤ 2/day, `critical`/`briefing` only), not a class; IM voice notes count as IM messages.
**Consequences.** The proactivity-contract eval suite gets sharper assertions (per-class counters, digest verification, no-drop property). Cost: workflows must declare a class — one required frontmatter field.
*Amendment (round 3):* digest items carry `{reason, source_workflow, class, created_at, expires_at?}` with class TTLs (`suggestion` 72 h default; `completion` until seen/resolved; `critical` never unseen) — expiry emits `delivery.expired` receipts, so "never drops" means auditable, not eternal; `critical` events must carry `storm_key = (workflow_id, failure_kind, affected_resource)` for testable collapse. Both enforced via the new `delivery.*` event family (protocol §2) — own addition: without delivery events, quotas and TTLs would be UI behavior instead of assertable contract.
