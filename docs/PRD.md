# Fairy — Product Requirements Document (PRD)

| | |
|---|---|
| Status | Draft v0.1 |
| Date | 2026-07-02 |
| Owner | Maxwell |
| Related | [ARCHITECTURE.md](ARCHITECTURE.md) · [ROADMAP.md](ROADMAP.md) · [DECISIONS.md](DECISIONS.md) |

## 1. Vision

Build a **personal AI companion** with the capability profile of Fairy from *Zenless Zone Zero*: always reachable, fast enough to talk to, deeply informed about its user, able to act in the real (digital) world — and with a personality you'd miss if it were gone.

Unlike a chatbot, Fairy is a **resident system**: a daemon that holds your sessions, memories, scheduled routines, and running tasks, reachable from any device by text or voice. Unlike vendor assistants, Fairy is **sovereign**: it runs on your hardware, stores data locally, and treats every LLM behind an OpenAI-compatible endpoint — commercial or self-hosted — as an interchangeable brain.

### In-game Fairy → product capability mapping

| Fairy in ZZZ | Product equivalent |
|---|---|
| Near-unlimited information retrieval across New Eridu | Web search + fetch + connected data sources (FR-3) |
| Embedded in the HDD system, always present | Resident gateway, multi-device clients (FR-14) |
| Guides Phaethon through Hollows in real time | Low-latency duplex voice with progress narration (FR-2) |
| "Fairy 代行" — acts on your behalf (auto-claim, auto-fish) | Workflows, scheduled routines, proactive actions (FR-11) |
| Dry wit, deadpan tsukkomi, occasionally smug | Persona pack + affect engine (FR-5) |
| Remembers the Proxies' history and adapts | Long-term memory with consolidation (FR-4) |

## 2. Goals and non-goals

### Goals

1. A single always-on assistant usable daily for questions, research, coding, file work, and automation.
2. Voice interaction that feels conversational: first audible response ≤ 1.2 s (p50) after the user stops speaking.
3. Persistent memory: Fairy knows the user better each week, verifiably and correctably.
4. Model freedom: swap the main brain, or bind different roles (subagents, summarizer, vision) to different vendors, via configuration only.
5. Industrial-grade internals: observable, testable, crash-safe, extensible without core changes.

### Non-goals (v1)

- Multi-tenant / multi-user service (single owner; multiple *devices*, not multiple *people*).
- Training or fine-tuning models; Fairy is a harness, not a lab.
- Full end-to-end speech-to-speech models as the primary path (kept as a future adapter; see ADR-006).
- Robotics / smart-home actuation (possible later via MCP tools).
- A polished GUI in early milestones — CLI and minimal desktop tray first.

## 3. Target user

**Owner-operator power user** (initially: the project author). Comfortable with config files and API keys, runs a PC or home server (Windows/Linux/macOS), mixes Chinese and English, wants privacy and vendor independence, and will extend Fairy with skills and tools over time.

## 4. Representative scenarios

S1 **Hands-free quick answer.** User speaks: "Fairy, 今天上海天气怎么样？" → first audio in ~1 s, spoken answer with a screen card if a display is present.

S2 **Acknowledge-then-act.** "Find me three recent papers on speculative decoding and summarize them." Fairy replies by voice immediately ("On it — give me a minute"), spawns a research subagent, then narrates the digest and drops a Markdown report into the workspace.

S3 **Coding in the sandbox.** "Write a script to dedupe my wallpapers folder and show me what it would delete first." Fairy plans, writes the script in a sandboxed container, runs it in dry-run mode, presents the diff, and asks permission before touching real files.

S4 **Memory continuity.** Three weeks after the user mentions a shellfish allergy, a restaurant-search task automatically excludes seafood-heavy options and Fairy notes why.

S5 **Overnight loop.** "Keep working through the failing tests in this repo until they pass; budget ¥20." Fairy runs Loop mode with fresh-context iterations, commits progress, and reports at breakfast — via the morning-briefing workflow it already runs.

S6 **Proactive routine.** At 08:00 the briefing workflow compiles weather, calendar, RSS/news deltas, and overnight task results into one spoken + written brief. During quiet hours Fairy stays silent unless a task it was explicitly given fails.

S7 **Cross-vendor delegation.** Main brain is a self-hosted GLM/Qwen endpoint (vLLM). The vision role is bound to a commercial multimodal API; when the user pastes a screenshot, perception runs on the vision model and returns structured text the text-only main brain can use seamlessly.

## 5. Functional requirements

Priorities: **P0** = MVP-blocking · **P1** = required for v1.0 · **P2** = post-v1.

### FR-1 Conversation core — P0
Multi-turn text chat with streaming responses; sessions persist across restarts and are resumable from any client; multiple named sessions; full-text-searchable history.
*Accept:* kill the gateway mid-turn → restart → session resumes with no data loss (turn may be re-run).

### FR-2 Voice interaction — P0 (pipeline), P1 (polish)
Any combination of text/voice in → text/voice out per user preference and device context. Streaming ASR with partial transcripts; sentence-chunked streaming TTS; barge-in (user speech cancels playback ≤ 250 ms); wake word optional and off by default; CJK + English recognition and synthesis.
*Accept:* voice-to-first-audio p50 ≤ 1.2 s, p95 ≤ 2.5 s on the reference setup (see NFR-1); interrupting mid-sentence works 95%+ of attempts.

### FR-3 Web access — P0
Web search (pluggable providers, at minimum one international and one China-accessible engine) and page fetch with readability extraction; content tagged untrusted (see FR-15); headless-browser operation reserved post-v1 (specs/computer-use.md).
*Accept:* S1 completes with cited sources.

### FR-3a Research orchestration — P1
Deep-research subsystem above raw search tools: query planning with zh/en dual-path expansion, multi-engine fan-out, dedup, source-type grading with independence checks, immutable snapshot cache, claim→snapshot citation ledger, pre-synthesis source-set review. (Spec: research.md.)
*Accept:* S2 produces a report where every substantive claim resolves to a cached snapshot span; citation precision ≥ 90% on the eval set; same question in zh and en reaches comparable source quality.

### FR-4 Memory — P0 (short-term), P1 (long-term + consolidation)
Short-term: in-context working memory surviving compaction. Long-term: episodic (what happened), semantic (facts/preferences with provenance and confidence), procedural (learned skills). Background consolidation ("dream cycle") summarizes, dedupes, resolves contradictions, decays stale items. User memory controls: list / edit / delete / export; privacy tiers (`secret` never persisted). Retrieval passes a **MemoryGate** (admission conditioned on task, channel trust, and data labels — not similarity alone), with pull-through to evidence spans (original episode context). A workspace-scoped **Chronicle** keeps project memory (attempts, failures, decisions) separate from personal memory.
*Accept:* S4 works after ≥ 20 intervening sessions; user can delete any remembered fact and it stays deleted; `personal`-tier recalls on low-trust channels: zero admits (leakage suite).

### FR-5 Persona & affect — P1
Persona packs define identity, speech style (bilingual), humor rules, boundaries, and TTS voice binding; hot-swappable. Affect engine maintains a bounded mood state (valence/arousal/stance) updated by events, decaying to a persona baseline; mood shapes phrasing and TTS prosody, never functionality. Honest by construction: Fairy never claims to be human or to have feelings beyond its documented mechanism. Affect can be disabled entirely.
*Accept:* same task at different mood states differs in tone, not substance; persona regression suite passes.

### FR-6 Sandboxed execution — P0
Run shell commands and code (Python/Node preinstalled) in an isolated container with resource limits and a network egress policy; workspace directory mounted; artifacts (files, images, reports) surfaced to the client. Sandbox profiles: `safe` (no net, workspace-only), `dev` (allowlisted net), `trusted` (host access, explicit opt-in per session).
*Accept:* S3 works; a malicious `rm -rf /` inside the sandbox affects nothing outside it.

### FR-7 Subagents — P1
Declarative subagent definitions (markdown + frontmatter): role prompt, tool allowlist, **model role binding — resolvable to a different vendor than the main agent**, turn/token budget. Isolated context; structured return (summary + artifact refs + metrics); parallel fan-out with a concurrency cap; recursion depth limit.
*Accept:* S7 works; a research fan-out of 3 subagents on 2 different vendors returns merged results.

### FR-8 Plan mode — P1
`/plan` enters a read-only exploration state; produces a reviewable plan artifact (goals, steps, risks, files/tools touched); execution begins only on approval and tracks the plan as a live task list; deviations beyond a threshold re-prompt the user.
*Accept:* in plan mode, write/execute tools are provably blocked; approved plans compile to a visible checklist.

### FR-9 Loop mode — P1
`/loop` runs goal-directed fresh-context iterations (Ralph-style): each iteration reads goal + progress from files/git, does one unit of work, records state, exits. Completion predicate (checklist, test command, or LLM judge) + hard budgets (iterations, tokens, cost, wall-clock) + stop-on-anomaly; human checkpoints optional; completion notification via preferred channel.
*Accept:* S5 works; budgets are enforced within 5% overshoot; no unbounded loops.

### FR-10 Context management — P0
Automatic context budgeting and reduction: tool-output truncation with file spillover, stale-content elision, turn snipping, micro-compaction, full compaction with structured handoff summary. KV-cache-friendly assembly (stable prefix, append-only, tool masking not removal). Per-model token accounting via the gateway.
*Accept:* a 4-hour session never hard-fails on context overflow; post-compaction task carry-over verified by regression suite.

### FR-11 Workflows & scheduling — P1
Declarative workflow definitions (YAML DAG): triggers (cron / event / manual / webhook), steps (agent turn, tool, subagent, condition, human approval), durable execution with checkpoint/resume, retries, timeouts. Scheduler with quiet hours and notification policy. Powers S6, the memory dream cycle, and user automations ("Fairy 代行").
*Accept:* gateway restart mid-workflow → workflow resumes from last checkpoint; quiet hours respected.

### FR-12 Model gateway — P0
All model access through one gateway speaking **OpenAI Chat Completions as the primary wire format** (adapters for Responses API / Anthropic Messages as secondary). Model registry with declared+probed capabilities; per-role bindings (main, planner, subagents, summarizer, memory extractor, perception, embedder, voice fast-path) each independently vendor-configurable; fallback chains; normalized streaming, tool-call, reasoning-channel, usage, and error semantics across providers (vLLM, Ollama, OpenRouter, DeepSeek, Qwen, Moonshot, OpenAI, etc.). **Capability degradation:** prompted tool-calling for models without native tools; perception service (FR-12a) for text-only models.
*Accept:* switching the main brain between ≥ 3 providers (1 self-hosted) is config-only; tool-calling conformance suite passes on all.

### FR-12a Perception service (multimodal assist) — P1
Images/PDF/audio/video attached by the user or produced by tools are routed to bound perception models (vision, ASR, document parser) producing structured text artifacts (description, OCR, layout) cached by content hash; main agent gets the artifact and may re-query on demand (`vision.describe`, `vision.ocr` tools).
*Accept:* S7 screenshot flow works with a text-only main brain.

### FR-13 Extensibility — P1
**Skills**: progressive-disclosure instruction packages (metadata always visible, body loaded on demand). **MCP client**: connect external MCP servers as tool providers with per-server trust levels. **Hooks**: user scripts on lifecycle events (pre/post tool, session start/end, memory write) that can observe, modify, or veto. **Channels**: new client surfaces without core changes.
*Accept:* a third-party MCP server and a custom skill both usable without modifying core packages.

### FR-14 Multi-client & channels — P0 (CLI), P1 (desktop, one IM), P2 (more)
Clients connect to the gateway over a versioned WebSocket protocol: CLI/TUI, desktop tray app (voice-capable), web client, IM bridges (e.g., Telegram) as channel adapters. Sessions are shared: start on desktop, continue on phone.
*Accept:* two clients attached to one session see the same live event stream.

### FR-15 Trust, permissions & observability — P0
Permission engine (allow/ask/deny by tool × target × channel trust × mode) with session-scoped grants and an append-only audit log. Provenance tags on all content (user/agent/tool/web); untrusted content is instruction-firewalled. Cost & token ledger per turn/session/day with budgets and alerts. Structured tracing (OpenTelemetry-compatible) and a replay debugger over session logs.
*Accept:* destructive ops from a voice channel require confirmation; a day-budget breach pauses non-critical workflows; any past turn is replayable offline.

### FR-15a Data labels & residency routing — P1
Two label axes on all content (artifacts, memories, tool results, inputs): sensitivity (`public/internal/personal/secret`) and residency (`local-only/region-restricted/global-ok`, a hard constraint — locality *preference* is a separate routing hint, never a residency value), auto-derived (max-sensitivity/intersection-residency, one-way semantic escalation) and enforced at the role router (provider clearances), MemoryGate, egress guard, telemetry redaction, and export. Defaults ship as selectable profiles (`balanced`/`sovereign`/`cloud-friendly`); labels are invisible by default, inspectable always. (Spec: data-governance.md.)
*Accept:* seeded `secret`/`personal` content provably never reaches a non-cleared provider across the tool/subagent/workflow matrix; friction canary — ≤ 1 governance interruption per 50 turns **and** route-denied recovery ≥ 95% in the soak test.

## 6. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | Voice latency (stop-speaking → first audio) | p50 ≤ 1.2 s, p95 ≤ 2.5 s (reference: gateway on LAN, cloud ASR/LLM/TTS); stretch p50 ≤ 800 ms |
| NFR-2 | Text latency (submit → first token visible) | p50 ≤ 1.5 s with cloud provider |
| NFR-3 | Availability | Gateway uptime ≥ 99% monthly on a home server; crash-safe: no committed data loss (event log fsync) |
| NFR-4 | Privacy | All persistent data local, open formats (SQLite/JSONL/Markdown); outbound calls only to configured providers; per-provider data-sharing notes surfaced in config |
| NFR-5 | Security | Sandbox escape = critical bug; secrets never enter model context; audit log for privileged ops |
| NFR-6 | Portability | Gateway + CLI on Windows 10+, macOS 13+, Ubuntu 22.04+; sandbox via Docker Desktop/WSL2 on Windows; speech workers optional-remote for GPU boxes |
| NFR-7 | Cost governance | Configurable daily budget; ledger accuracy within 2% of provider billing |
| NFR-8 | Extensibility | Adding a provider, tool, skill, channel, or persona requires no core-package changes (registry pattern) |
| NFR-9 | Maintainability | Versioned internal protocol (semver); every subsystem behind an interface with a conformance test suite; replay-based regression tests |
| NFR-10 | i18n | zh-CN and en-US first-class in UI strings, ASR/TTS, and persona packs |

## 7. Success metrics (v1.0)

- Voice p50 latency ≤ 1.2 s sustained across a 30-turn benchmark conversation.
- ≥ 90% tool-call turn success rate across the supported provider matrix (conformance suite).
- Citation precision ≥ 90% on the research eval set; zero label-conformance violations in the governance suite.
- Memory: ≥ 80% recall precision on a 100-fact canary benchmark after 30 days of simulated use; 0 resurrections of deleted facts.
- ≥ 5 daily active workflows without unplanned intervention over a 2-week soak test.
- Zero sandbox escapes and zero secret-in-context incidents in security test suite.
- Owner subjective: prefers Fairy over vendor assistant for ≥ 70% of daily tasks (self-tracked).

## 8. Risks & mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| OpenAI-compat drift across vendors (streaming tool deltas, `tool_choice`, params) | Broken turns on some providers | Normalization layer + per-provider conformance/golden tests + prompted-tool fallback (spec: model-gateway) |
| Voice latency misses on self-hosted models | Feature feels dead | Two-lane response (fast ack + agentic lane); latency budget per stage with bench in CI |
| Prompt injection via web/tool content | Data exfiltration, rogue actions | Provenance tags, instruction firewall, tool narrowing under untrusted context, egress guard (spec: sandbox-security) |
| Memory poisoning / bloat | Wrong or creepy behavior | Provenance + confidence, consolidation review, user memory UI, canary evals |
| Affect drifts into manipulation / parasocial harm | User trust damage | Bounded state, transparency disclosure, off-switch, ethics section in persona spec |
| Scope creep (this PRD is large) | Never ships | Strict milestone gates in ROADMAP; P0 set is deliberately small |
| Governance friction (labels/gates annoy the owner) | Features get switched off | Auto-derivation, invisible-by-default labels, friction budget tested in soak (FR-15a accept) |
| Windows sandbox friction (Docker Desktop dependency) | Setup abandonment | Documented WSL2 path; `safe`-profile pure-process fallback with reduced guarantees |

## 9. Open questions

1. Wake-word engine choice for hands-free desktop (openWakeWord vs Porcupine licensing) — defer to M3.
2. Mobile access in v1: IM channel (incl. async voice notes) is the v1 answer; realtime mobile voice (WebRTC) is post-v1 — the client transport interface must be conformance-tested by M3 so it slots in without redesign.
3. Vector store: sqlite-vec sufficient vs LanceDB for scale — benchmark at M2.
4. Should Loop mode be allowed to spend money (paid APIs) unsupervised? Default no; revisit with budget maturity.
5. Computer use: ABI reserved now (specs/computer-use.md); implementation start gated on two consecutive releases of green security suites post-v1.
    
