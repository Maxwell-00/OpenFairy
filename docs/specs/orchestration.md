# Spec: Orchestration — Subagents, Plan, Loop, Workflows

| | |
|---|---|
| Status | Draft v0.1 |
| Requirements | FR-7, FR-8, FR-9, FR-11 |
| Package | `packages/orchestrator` |

Everything here composes one primitive — the kernel's **TurnRunner** — under different policies. No second agent implementation exists anywhere (Hermes lesson: one agent class; platform/mode differences live outside it).

## 1. Subagents (FR-7)

**Definition** — `extensions/agents/<name>.md`:

```markdown
---
name: researcher
description: Deep web research with citations; use for multi-source questions.
role: subagent.research        # model role → any vendor (model-gateway spec)
tools: [web.search, web.fetch, fs.read, fs.write]
max_turns: 25
budget: { tokens: 200000, cost: 0.50 }
return_schema: research-report/v1   # optional structured-return contract
---
(system prompt body…)
```

**Spawn contract.** Parent calls `agent.spawn(name, brief, files?)`. The subagent gets a fresh context: its own system prompt + the parent-composed **task brief** + scoped tool zone (context-engine §5). It does *not* see the parent's history — briefs force parents to externalize intent, which doubles as logging.

**Return contract.** Only a structured result crosses back: `{summary, findings?, artifacts[], metrics: {turns, tokens, cost}, status: ok|partial|failed}`. Raw transcripts stay in the subagent's own session log (inspectable, replayable, but never auto-injected into the parent).

**Execution policy.** Parallel fan-out up to `orchestrator.max_concurrent` (default 3); recursion depth ≤ 2; per-spawn budgets enforced by the ledger; cancellation propagates (parent abort kills children). Cross-vendor is free: each definition's `role` resolves through the role router — main on local vLLM, researcher on DeepSeek, coder on GLM is just config (PRD S7).

**Built-in roles v1:** `researcher` (drives the research orchestrator's `research.*` tools and owes its briefs a source-set review — specs/research.md), `coder` (receives a Chronicle auto-brief for touched files — specs/memory §6a), `summarizer`, `critic` (verification pass for high-stakes outputs — used by Plan mode review, research source-set review, and the memory contradiction sweep).

## 2. Plan mode (FR-8)

State machine wrapped around the runner:

```
/plan → EXPLORING: tool policy = read-only allowlist (fs.read, web.*, memory.search, vision.*)
        write/exec calls → PolicyError (provably blocked, PRD accept criterion)
      → DRAFTING: plan artifact produced
      → REVIEW: user approves / edits / rejects (any client; voice gets a spoken digest)
      → EXECUTING: plan compiled into the task block as a live checklist
      → (DEVIATION: step diverges from plan beyond threshold → pause + re-confirm)
```

**Plan artifact** (`plan/v1`, stored as artifact + event): goal · assumptions · steps (each: intent, tools expected, risk class, verify-by) · files/resources touched · rollback notes · open questions. Steps with `risk: destructive` are pre-flagged for the permission engine so approval at plan level can pre-grant step-level prompts (one consent, visible scope).

Execution tracks step status in the task block (recitation keeps the model honest); the `critic` subagent optionally reviews plan vs. outcome at the end.

## 3. Loop mode (FR-9) — Ralph-style iteration

For long grinds (test-fixing, migrations, content pipelines) where one session's context degrades. Fresh context per iteration; state lives in files/git, not in the window.

**Loop definition** (created by `/loop` interactively or from a file):

```yaml
goal_file: LOOP.md              # goal + constraints + definition of done
progress_file: PROGRESS.md      # appended by each iteration
completion:                     # first satisfied wins
  - type: command               # e.g. test suite green
    run: "pnpm test"
    expect_exit: 0
  - type: checklist             # all items in goal file checked
  - type: judge                 # LLM judge (critic role) scores goal satisfaction
budgets: { iterations: 40, tokens: 5000000, cost: 20.00, wallclock: 8h }
per_iteration: { max_turns: 30, timeout: 20m }
checkpoint_every: 5             # human checkpoint (notify + pause) every N iterations; 0 = off
stop_on: { repeated_failure: 3, no_progress: 4 }   # anomaly detectors
sandbox: dev
notify: telegram
```

**Iteration contract:** cold-start prompt = loop system prompt + goal file + progress tail + repo/workspace state summary + Chronicle digest for touched files (specs/memory §6a — prior failed approaches surface *before* they're retried). The iteration must: pick *one* unit of work → do it → verify → append a progress entry (what/result/next) and a Chronicle entry → commit (if git) → exit. The orchestrator — not the model — evaluates completion predicates and budgets between iterations (enforcement within 5%, PRD accept criterion).

**Safety:** loops run in the declared sandbox profile; `no_progress` detector diffs progress entries and worktree state; anomaly or budget exhaustion → pause + notification, never silent death or unbounded spend. Paid-API spend inside loops requires an explicit budget line (PRD open question Q4 defaults to no).

## 4. Command surface

`/plan`, `/loop`, `/agents`, `/workflows`, `/memory`, `/persona`, `/budget` — uniform across CLI, desktop, IM (slash) and voice ("Fairy, 进入计划模式"). Commands are protocol events, not client magic: every client gets them for free.

## 5. Workflow engine (FR-11)

Declarative DAGs for recurring/proactive behavior — the "Fairy 代行" machinery. `extensions/workflows/*.yaml`:

```yaml
name: morning-briefing
trigger: { cron: "0 8 * * *", timezone: local, skip_if: quiet_hours }
steps:
  - id: gather
    parallel:
      - { tool: web.search, args: { q: "..." } }
      - { agent: researcher, brief: "overnight AI news delta since {{last_run}}" }
      - { tool: workflow.results, args: { name: overnight-loops } }
  - id: compose
    agent_turn: { role: summarizer, brief: "compose briefing from {{gather.*}}", output: briefing.md }
  - id: deliver
    deliver: { channels: [desktop.voice, telegram], artifact: "{{compose.output}}" }
on_error: { retry: { max: 2, backoff: 60s }, then: notify }
budget: { cost: 0.10 }
```

**Durable execution:** every step result checkpoints to SQLite (`workflow_runs` table) with idempotency keys; gateway restart mid-run resumes from the last completed step (PRD accept criterion). Timeouts, retries, and budgets per step and per run. Human-approval steps park the run until a client responds.

Step types v1: `tool`, `agent_turn`, `agent` (subagent), `condition`, `parallel`, `approval`, `deliver`. The memory dream cycle and loop-mode notifications are ordinary workflows — no privileged internal paths (dogfooding the engine).

## 6. Scheduler & proactivity policy

- Triggers: cron, interval, event (`memory.written`, `budget.breach`, `workflow.completed`, webhook), manual.
- **Initiative levels** (per workflow): `silent` (log only) · `notify` (badge/message) · `speak` (voice, only outside quiet hours) · `act` (pre-granted actions only). Orthogonal to the initiative **class** (`critical | briefing | completion | suggestion` — *what kind* of event, driving quotas) — a workflow declares both: class picks the quota bucket, level caps the delivery mode.
- Global guardrails: quiet hours; **per-class × per-channel quotas** with digest overflow and a proactive-voice overlay budget — every workflow declares an initiative *class* (`critical | briefing | completion | suggestion`), and the scheduler enforces the quota matrix defined in COMPANION-CONTRACT §1; every proactive action carries a "why am I telling you this" provenance line — proactivity without these becomes noise and gets disabled by users.

## 7. Observability

Each spawn/plan/loop/workflow run is a trace linked to its parent; the ledger attributes cost down the tree (a briefing that cost ¥0.40 shows *which step* spent it). `fairy runs` lists live orchestrations with budgets remaining; everything is cancellable from any client.
