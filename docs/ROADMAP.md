# Fairy — Roadmap

Milestones are gates, not dates: each has exit criteria (suites named in [specs/evals.md](specs/evals.md)) that must pass before the next begins. Scope discipline is the primary schedule risk (PRD §8).

<!-- BEGIN R0.9-06 CURRENT RELEASE OVERLAY -->
## Current release overlay — OpenFairy v0.9 Developer Preview

R0.9 is a release overlay, not a milestone renumbering. R0.9-01, R0.9-02, R0.9-05′, and the R0.9-06′ release gate are closed with Fable countersign — Tier 1 of the v0.9 Developer Preview is complete. The real-session S4 ledger is currently **4/20** and incomplete. Full M3, M4, and M5 exits remain open, and the target-state milestone sections below are unchanged.

The shipped voice path is non-streaming, artifact-backed MiMo cloud ASR plus MiniMax cloud TTS through the authenticated localhost Web surface. The binding landing gates and explicit waiver law for capabilities not shipped in this preview are recorded in [v0.9-deferrals.md](v0.9-deferrals.md).
<!-- END R0.9-06 CURRENT RELEASE OVERLAY -->

Milestone thesis — what each phase must *prove* (framing adopted from external review):
**M1 the control plane works · M2 memory and research are trustworthy · M3 the voice is alive · M4 代行 is dependable · M5 hardened v1.0.**
Debugging tools lead, not trail: the microscope arrives at M1, because agent systems are debugged into existence.

## M0 — Design freeze & scaffolding

Monorepo scaffolding (ARCHITECTURE §9), CI (lint, typecheck, test, dependency-rule enforcement), config loader + schema validation, `fairy doctor` skeleton. **Protocol first:** event canon v0 in `packages/protocol` — type registry, payload schemas, golden fixtures, envelope with `labels` field from day one (retrofitting labels later would be brutal; ADR-016).
**Exit:** empty-but-wired gateway boots; mock client passes protocol conformance; CI green; docs merged.

## M1 — Text spine + microscope — FR-1, FR-3, FR-6, FR-10, FR-12, FR-14(CLI), FR-15(core)

Deliberately slimmed (review: old M1 was a whole product):

- Model gateway: `openai-chat` transport, registry (incl. `data_clearance` fields), role router, normalization for **2 providers** (one local vLLM/Ollama, one commercial); conformance kit v1.
- Kernel: TurnRunner + context engine zones with reduction **L1–L3** (L5 full compaction → M2).
- Tools: `fs.*`, `shell` (container sandbox, `safe`/`dev` profiles), `web.search`, `web.fetch` (provenance + quarantine wrapping).
- Permission engine v1 + audit log; **basic** token/cost counters (budgets/alerts → M4).
- Sessions: event log + snapshots + resume. CLI client.
- **Minimal replay inspector at M1, not M5:** `fairy replay <sid>` steps through any session log; context-manifest dump per turn. Terminal-grade is fine — existence is what matters.
- Labels: plumbed and recorded everywhere, enforcement in **log-only mode** (violations visible, not yet blocking).

**Exit:** S3 end-to-end; provider switch config-only; kill-mid-turn resume; 4-hour context-ladder test; sandbox escape suite v1; every merged feature debuggable via `fairy replay`.

## M2 — Trustworthy memory & research — FR-3a, FR-4, FR-5, FR-12a, FR-15a

The trust milestone: memory, research, and governance land *together* because they couple (what gets researched must not silently become personal memory; what gets recalled must respect channels; what gets routed must respect labels).

- Memory: stores + ingestion + retrieval digest + memory tools; **MemoryGate** (enforcing) + evidence pull-through; **Chronicle v1**; dream-cycle consolidation (hand-triggered); `/memory` verbs; canary + deletion + leakage suites.
- **Research orchestrator v1:** query planning, zh/en fan-out, dedup, grading (heuristic), snapshot cache, citation ledger, source-set review via `critic`; citation-precision + parity suites.
- Governance: label enforcement flips on (router clearance + hint ordering, egress guard, telemetry redaction); default profiles (`balanced`/`sovereign`/`cloud-friendly`); label-conformance suite; **friction canary starts** (nightly: interruption rate + route-denied recovery); third provider + conformance kit maturity.
- Persona pack + affect engine v1 (consistency + substance-invariance suites). Perception service (image ingest + `vision.describe/ocr`).
- Context engine completes the ladder (L4/L5 with post-compaction regression tests). Injection corpus **v0** (web-content attacks — research just made this surface real).

**Exit:** S2 (text) with verifiable citations; S4 across ≥ 20 sessions; leakage/label suites zero-tolerance green; S7 screenshot flow; persona ≥ 90%. **Decision gate:** sqlite-vec vs LanceDB (≥ 200k records benchmark).

## M3 — Voice — FR-2, NFR-1

Speech worker framework + duplex audio protocol; ASR/TTS one cloud + one local per stage; VAD + endpointing (silence; semantic if budget allows); two-lane turn integration + ack bank; CJK-aware sentence-chunked TTS; barge-in cascade; desktop tray client. Client audio transport behind a conformance-tested interface (loopback second impl — ADR-006 amendment). **zh/mixed ASR benchmark** (FunASR vs faster-whisper vs cloud) picks defaults by measurement. Latency bench nightly.
**Exit:** S1 live; p50 ≤ 1.2 s / p95 ≤ 2.5 s; barge-in ≥ 95% within 250 ms; zh/en/mixed bench passes; voice sessions fully replayable (protocol §5 marks).

## M4 — Orchestration & 代行 — FR-7, FR-8, FR-9, FR-11, FR-14(one IM)

Subagents (spawn/return contracts, parallel fan-out, cross-vendor demo, Chronicle auto-briefs); Plan mode (read-only enforcement, plan artifact, approval flow incl. voice digest); Loop mode (budgets, completion predicates, anomaly stops, Chronicle integration, notifications); workflow engine + scheduler + quiet hours + proactivity contract (morning-briefing and dream-cycle ship as workflows); budgets/alerts on the ledger; Telegram adapter with trust levels + **voice notes** (v1 mobile voice answer).
**Exit:** S5 within budget; S6 for 7 consecutive days unattended; workflow crash-resume; plan-mode write-block proof; S7 full; proactivity-contract suite green.

## M5 — Hardening & v1.0 — FR-13, FR-15(full), NFR sweep

MCP client + trust levels; skills + hooks; injection corpus full hardening + capability narrowing; observability dashboards (the M1 inspector grows a UI); installer & onboarding (Windows/WSL2 first-class); extension-author docs; **computer-use ABI final review** (implementation stays post-v1, ADR-018); 2-week soak (≥ 5 daily workflows, zero unplanned interventions, friction canary green: interruptions ≤ 1/50 turns and route-denied recovery ≥ 95%).
**Exit:** PRD §7 metrics all green; security suites green; tag v1.0.

## Post-v1 (parked, rough order)

Computer use implementation (browser surface first; gate: two consecutive green security releases) · web client + PWA · WebRTC realtime mobile voice · wake word · realtime S2S adapter behind the voice coordinator (revisit ADR-006) · Fairy-as-MCP-server · graph memory layer if canary benchmarks demand · multi-user/family mode · home automation via MCP · learned-skill auto-evolution with eval gates (currently human-gated).
