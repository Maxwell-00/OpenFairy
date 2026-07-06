# Task M0-01 — Monorepo scaffold + `packages/protocol` v0

> Paste this entire file as the task brief. The repo is at `E:\Claude_Projects\Projects\Fairy` (Windows; CI also runs Linux).

## Context — read these first, in this order

1. `CLAUDE.md` (repo root) — invariants and platform notes. These are non-negotiable.
2. `docs/ROADMAP.md` — you are implementing part of **M0 only**.
3. `docs/ARCHITECTURE.md` §9 — package layout and dependency rules.
4. `docs/specs/protocol.md` — **normative**: event families, envelope fields, evolution rules, fixture requirements. Event type names must match this spec exactly.

You are building the skeleton and the protocol package. No gateway server, no kernel logic, no model calls — that is task M0-02.

## Deliverables

### 1. pnpm workspace monorepo skeleton
- Directories per ARCHITECTURE §9: `packages/{protocol,config,kernel,model-gateway,memory,research,orchestrator,tools-std,channels,testing}`, `apps/{gateway,cli}`, `workers/speech`, `extensions/{agents,skills,personas,workflows,hooks,mcp.d}`.
- All packages except `protocol`, `config`, `testing`, and `apps/cli` are **stub packages** (package.json + empty index + one placeholder test). Do not implement them.
- Root: `pnpm-workspace.yaml`, `packageManager` field pinned in root `package.json` (corepack-compatible, e.g. `"packageManager": "pnpm@<latest-stable>"`), base `tsconfig.json` (strict, ESM, Node ≥ 22), ESLint, Vitest, `.gitattributes` (LF normalization), `.editorconfig`, `.gitignore`.
- All npm scripts must be cross-platform (node scripts, no bash-only).

### 2. Dependency-rule enforcement in CI
- Use dependency-cruiser (or equivalent) to enforce: `protocol` imports nothing from the workspace; everything may import `protocol`; `kernel` must not import `channels` or `apps/*`; vendor SDKs allowed only in `model-gateway` (rule can be a placeholder pattern for now).
- GitHub Actions workflow: install → lint → typecheck → test → dep-rule check, on `windows-latest` and `ubuntu-latest`.

### 3. `packages/protocol` v0 (the real work)
- Envelope type with **all** fields from ARCHITECTURE §6 / protocol spec: `v, id (ULID), sid, turn, ts, actor, type, provenance, labels {sensitivity, residency}, payload`.
- Event type registry: every v1 type listed in protocol spec §2 (turn, reasoning, tool, approval, progress, plan, loop, workflow, memory, research, speech, affect, artifact, governance, **delivery**, session, error families). `x.<vendor>.<name>` extension types tolerated by readers.
- **JSON Schema files are the source of truth** (`packages/protocol/schemas/*.json`, one per event type, versioned). TS types must provably not drift: either generate types from schemas or add a CI test that validates type/schema sync.
- Golden fixtures per type: ≥ 1 valid + ≥ 1 invalid sample (`packages/protocol/fixtures/`). Special cases to cover: `delivery.*` payload requires `storm_key` when `class: critical`; labels enum closed (`local-preferred` must be **rejected** — it is a known outlawed value, see ADR-019).
- Conformance tests: fixture round-trips (parse → serialize → byte-stable), unknown-field and unknown-type tolerance, ULID monotonicity helper, envelope required-field validation.
- Runtime validation via ajv (or equivalent); zero workspace dependencies.

### 4. `packages/config`
- Layered loader: `defaults → user (fairy.yaml) → workspace → session overrides`; env-var expansion; schema-validated with actionable error messages (path + expected + got).
- `secret://name` references are **typed but never resolved** here (resolution is edge-only per CLAUDE.md invariants).
- Ship a `defaults.yaml` skeleton with the config keys already named in specs (`models`, `roles`, `governance.home_regions`, `governance.categories`, `research`, `sandbox`) — values may be empty/example, keys must match spec spelling.

### 5. `fairy doctor` skeleton (in `apps/cli`)
- Command that reports: Node version OK, pnpm version, config file found/valid (with layered-source trace), container runtime detected yes/no (informational only for now).
- Plain-text output, exit code 0/1.

## Boundaries — do NOT

- Do not implement gateway/kernel/model-gateway logic, WebSocket servers, or any LLM/vendor SDK usage.
- Do not invent, rename, or omit event types relative to protocol spec §2. If the spec seems ambiguous or wrong, **stop and list the ambiguity in your report** instead of silently deciding.
- Do not add dependencies beyond: typescript, vitest, eslint(+plugins), ajv, a ULID lib, yaml parser, dependency-cruiser, json-schema type tooling. Justify anything else in the report.
- Do not touch `docs-zh/`, `ChatGPT_Suggestions/`, `.auto-memory/`, or existing docs.
- No placeholder schemas ("TODO") — every registered type ships real schema + fixtures.

## Acceptance (all must pass before you report done)

```
pnpm install
pnpm -r typecheck
pnpm lint
pnpm -r test        # includes protocol conformance suite
pnpm dep-check      # dependency rules
pnpm doctor         # runs, prints report
```

Green on Windows locally and in both CI matrices.

## Report back (required format)

1. File tree (top 2 levels + full `packages/protocol`).
2. Test/lint/dep-check output (verbatim tails).
3. **Decisions made** — every choice the docs didn't dictate, one line each with reasoning.
4. **Spec ambiguities found** — anything in protocol.md/ARCHITECTURE that was unclear or contradictory (empty list is suspicious; look hard).
5. Suggested follow-ups for M0-02 (minimal gateway boot + mock client conformance).
