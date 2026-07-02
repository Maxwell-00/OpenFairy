# Project Fairy

**A personal, always-on AI companion** — inspired by Fairy from *Zenless Zone Zero*: an assistant with real capability (search, code execution, automation), real continuity (short- and long-term memory), and real presence (low-latency voice, a personality with moods).

Fairy is model-agnostic by design: any OpenAI-compatible LLM can serve as its brain, and different components (main agent, subagents, summarizer, vision, voice) can each run on models from different vendors.

> **Status: design phase.** No implementation yet. Documents below define what will be built.

## Document map

| Document | Purpose |
|---|---|
| [docs/PRD.md](docs/PRD.md) | Product requirements — vision, use cases, functional & non-functional requirements, success metrics |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Technical architecture — system views, turn pipelines, protocols, data, cross-cutting concerns |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased milestones M0–M5 with exit criteria |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Architecture Decision Records (ADRs) — why things are the way they are |
| [docs/COMPANION-CONTRACT.md](docs/COMPANION-CONTRACT.md) | Conduct contract — when Fairy speaks, stays silent, remembers, backs off |
| [docs/specs/model-gateway.md](docs/specs/model-gateway.md) | Multi-vendor LLM gateway, capability degradation, multimodal perception service |
| [docs/specs/voice-pipeline.md](docs/specs/voice-pipeline.md) | Low-latency duplex voice: streaming ASR/TTS, barge-in, latency budgets |
| [docs/specs/memory.md](docs/specs/memory.md) | Working / episodic / semantic / procedural memory, consolidation daemon |
| [docs/specs/context-engine.md](docs/specs/context-engine.md) | Context budgeting, assembly, five-stage reduction ladder, KV-cache discipline |
| [docs/specs/orchestration.md](docs/specs/orchestration.md) | Subagents, Plan mode, Loop mode, workflow engine, proactivity |
| [docs/specs/sandbox-security.md](docs/specs/sandbox-security.md) | Execution sandbox, permission engine, prompt-injection defenses, secrets |
| [docs/specs/persona-affect.md](docs/specs/persona-affect.md) | Persona packs, affect (emotion) engine, expression mapping, ethics |
| [docs/specs/protocol.md](docs/specs/protocol.md) | Runtime event canon — normative type registry, approval flow, golden fixtures |
| [docs/specs/research.md](docs/specs/research.md) | Research orchestrator — bilingual fan-out, source grading, snapshots, citation ledger |
| [docs/specs/data-governance.md](docs/specs/data-governance.md) | Data labels & residency — provider clearances, five enforcement points |
| [docs/specs/evals.md](docs/specs/evals.md) | Evaluation framework — every suite, cadence, and milestone gate in one registry |
| [docs/specs/computer-use.md](docs/specs/computer-use.md) | Computer use — ABI reserved now, implementation post-v1 |

## Design principles (summary)

1. **OpenAI-format first, vendor-neutral always.** The wire format is Chat Completions; everything else is an adapter.
2. **The gateway is the product.** One resident daemon owns sessions, memory, and scheduling; every UI is a thin client.
3. **Events are the source of truth.** Append-only session logs; every UI renders the same event stream; everything is replayable.
4. **Context is the scarcest resource.** Budgeted zones, a reduction ladder, filesystem spillover, KV-cache discipline.
5. **Capability degradation over capability assumption.** Text-only models get a perception service; models without tool tokens get prompted tool calling.
6. **Security by default.** Container sandbox, permission engine, provenance-tagged content, secrets never in context.
7. **Personality is a presentation layer.** Affect shapes tone and voice — it never blocks function and never deceives.
8. **Local-first data.** Everything user-generated lives on the user's machine in open formats (SQLite, JSONL, Markdown).

## Reference points (studied, not copied)

pi-mono (unified event architecture, minimal tool core) · Hermes Agent (one agent class, pluggable transports, self-improving skills) · OpenClaw (gateway control plane, multi-channel) · Claude Code (compaction pipeline, subagents, skills/hooks, plan mode) · Codex CLI (OS-level sandboxing, tool router) · Pipecat/LiveKit (frame-based voice pipelines, barge-in) · Letta/Mem0/Zep (memory tiers, extraction, temporal facts) · Manus (context engineering lessons) · Ralph loop (fresh-context iteration).
