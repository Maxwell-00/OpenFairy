# CLAUDE.md — Fairy

Personal AI companion (ZZZ-Fairy-inspired): resident gateway, any OpenAI-compatible LLM as the brain, memory, low-latency voice, sandboxed execution, bounded persona. Single owner (Chidi), zh/en bilingual.

> **If you are the reviewer Claude in a Cowork conversation** (gating briefs, countersigning reviews, owning docs): read [REVIEWER-HANDBOOK.md](REVIEWER-HANDBOOK.md) before doing anything else — it carries the accumulated review method, environment landmines, and standing rules.

**Current phase: M2 (trust milestone) in progress.** M0–M1 are closed (text spine: gateway, TurnRunner, tools + permissions + audit, context ladder L1–L3, `fairy replay`, conformance kit, two live providers). For the live position, trust `git log` and the newest `tasks/*-review.md` files over any static phase note — including this one.

## Read this before writing code

1. [docs/ROADMAP.md](docs/ROADMAP.md) — what the current milestone includes (and, more importantly, excludes)
2. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — boundaries, package layout (§9), dependency rules
3. [docs/DECISIONS.md](docs/DECISIONS.md) — 20 ADRs; treat as settled law, append-only
4. The spec for whatever subsystem you're touching, in [docs/specs/](docs/specs/) — specs are normative, including event names and config schemas
5. [docs/PRD.md](docs/PRD.md) — FR/NFR IDs and acceptance criteria (referenced everywhere)

## Invariants (violating any of these = wrong, regardless of how convenient)

- **One TurnRunner.** Plan/loop/subagents/workflows are policies over the same runner (ADR-012). Never write a second agent loop.
- **Vendor SDKs only inside `packages/model-gateway` transports** (and speech worker adapters). Everything else consumes roles, never model names (ADR-011).
- **The runtime event canon ([docs/specs/protocol.md](docs/specs/protocol.md)) is the only internal language.** Chat-Completions shapes exist only inside the gateway (ADR-014). New event types must be registered there with schemas + golden fixtures.
- **Session logs are append-only JSONL**; blobs go to artifacts; compaction is an event (ADR-004).
- **Labels:** residency is a hard constraint (closed enum), `routing_hints.prefer_local` never gates; escalation is table-driven and one-way; `secret` tier is never persisted (ADR-016/019).
- **Sandbox-first:** execution tools run in containers; on bare Windows without Docker/WSL2, disable rather than weaken (ADR-008).
- **New capability ⇒ eval suite in the [docs/specs/evals.md](docs/specs/evals.md) registry** in the same change. No suite, no merge.
- Secrets resolve at the edge (`secret://` refs); never in model context, logs, or traces.

## Stack & conventions

- TypeScript (Node ≥ 22) monorepo per ARCHITECTURE §9; Python only under `workers/speech/`.
- **JS package manager: pnpm** (workspaces + strict node_modules — its phantom-dependency prevention helps enforce the §9 dependency rules). Owner note: owner comes from conda/uv and has never used pnpm — commands map ~1:1 to npm (`pnpm install`, `pnpm add`, `pnpm -r test`); agents run the commands, so keep scripts self-documenting in root `package.json`.
- **Python (workers/speech only): uv** with `pyproject.toml` + `uv.lock` committed. The repo must NOT require conda — owner may use a conda env as their local outer environment, but CI and docs assume plain `uv sync`. Never mix conda-installed packages into the lockfile.
- Code identifiers and docs in English; UI strings and persona content zh + en first-class (NFR-10, ADR-013).
- CI enforces the dependency rules in ARCHITECTURE §9 (`protocol` ← everything; kernel never imports channels/apps).
- **Internal packages resolve source-first:** `exports.import` points at `./src/index.ts` for every workspace package. `build` scripts exist only for future packaging (M5). **Never** point exports at `dist/` and never gate one package's tests on building another (`pnpm --filter X build && …` in a test script is a red flag — it means resolution is broken and CI will fail on fresh checkouts).
- **All execution runs from source via tsx** — dev, tests, e2e child processes, and the daemon itself (`node --import tsx <entry>.ts`, see `scripts/*.mjs`). There is exactly one resolution world until M5 packaging; spawning `node` on plain `.ts` or on `dist/` at this stage is a bug. (Two CI-only failures came from dist/src dual-world resolution — don't reintroduce it.)

## Platform notes (owner's environment)

- Development happens on **Windows** (repo at `E:\Claude_Projects\Projects\Fairy\OpenFairy`; the parent `Fairy\` folder holds non-repo design inputs — see Repo layout notes). Gateway/kernel/CLI develop and run fine on native Node on Windows.
- **Docker Desktop (WSL2 backend) is required** the moment the sandbox runner or local speech workers enter play; owner is willing to move to WSL Ubuntu if CLI/deployment ergonomics demand it. Prefer solutions that work in both; avoid bash-only scripts in the repo (use cross-platform npm scripts or node scripts).
- Watch for CRLF/path-separator issues; `.gitattributes` with LF normalization at M0.

## Repo layout notes

- **This repo (`OpenFairy/`) is the single canonical home of code AND docs.** The `docs/` set here is normative; do not create copies elsewhere.
- The **parent folder** (`E:\Claude_Projects\Projects\Fairy\`) holds non-repo material — never treat it as part of the codebase:
  - `ChatGPT_Suggestions/` — external review inputs; read-only, fully absorbed into ADR-014…020.
  - `docs-zh/` — owner-maintained Chinese translations. **Never edit.** When you change an English doc, tell the owner which files need re-translation.
  - `.auto-memory/` — Claude session memory; not project content.

## What to build next

The current task brief is always the newest un-reviewed `tasks/M<x>-<nn>-*.md`; milestone scope and exit criteria live in [docs/ROADMAP.md](docs/ROADMAP.md). The implementation trail (brief → work report → review + countersignature, incl. every incident-derived rule) is in `tasks/` — read the latest 2–3 review files before starting anything.

## Scope guard

When tempted to add anything not in the current milestone: check ROADMAP first; if it's listed later, it waits. The failure mode this project guards against is documented in PRD §8 — scope creep kills solo projects via motivation, not markets.
