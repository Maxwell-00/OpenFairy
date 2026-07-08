# M2-03 Work Report

## 1. File tree delta

Changed:

- `apps/cli/package.json`
- `apps/cli/src/bin/fairy.ts`
- `apps/cli/src/index.ts`
- `apps/cli/src/replay.ts`
- `apps/cli/test/replay.test.ts`
- `apps/gateway/src/server.ts`
- `packages/config/defaults.yaml`
- `packages/kernel/src/index.ts`
- `packages/kernel/test/index.test.ts`
- `packages/protocol/fixtures/citation.recorded.valid.json`
- `packages/protocol/fixtures/snapshot.created.valid.json`
- `packages/protocol/fixtures/sourceset.reviewed.valid.json`
- `packages/research/src/index.ts`
- `packages/research/test/index.test.ts`
- `packages/testing/package.json`
- `packages/testing/test/gateway.e2e.test.ts`
- `packages/tools-std/package.json`
- `packages/tools-std/src/index.ts`
- `packages/tools-std/test/index.test.ts`
- `pnpm-lock.yaml`

Added:

- `apps/cli/src/research.ts`
- `apps/cli/test/research.test.ts`
- `packages/testing/test/research.evals.test.ts`
- `tasks/M2-03-work.md`

Not changed:

- `docs/`
- `docs-zh/`

## 2. Verification tails

Local commands:

```powershell
$env:HTTP_PROXY = "http://127.0.0.1:15236"; $env:HTTPS_PROXY = "http://127.0.0.1:15236"; pnpm install
```

Result: PASS, already up to date.

```powershell
pnpm lint
```

Result: PASS, `eslint . --max-warnings=0`.

```powershell
pnpm -r typecheck
```

Result: PASS across workspace packages, including `@fairy/research`, `@fairy/tools-std`, `@fairy/kernel`, `@fairy/cli`, `@fairy/testing`, and `apps/gateway`.

```powershell
pnpm -r test
```

Result: PASS.

Tail highlights:

- `packages/protocol`: 107 passed.
- `packages/research`: 14 passed.
- `packages/tools-std`: 4 passed, 3 skipped.
- `apps/cli`: 6 passed.
- `packages/kernel`: 11 passed.
- `packages/testing`: 33 passed, 1 skipped.

Named suites observed:

- `memory.leakage`
- `memory.deletion-permanence`
- `research.citation-precision`
- `research.zh-en-parity`
- `injection.research-v0`
- gateway E2E: `keeps research injection pages quarantined through the TurnRunner tool loop`

```powershell
pnpm dep-check
```

Result: PASS, `no dependency violations found (82 modules, 209 dependencies cruised)`.

```powershell
pnpm conformance
```

Result: PASS in mock mode, 18/18 cases passed.

Additional checks:

```powershell
git diff --check
git diff --name-only -- docs docs-zh
```

Result: PASS. No whitespace errors; no docs/doc-zh diffs.

CI link/status:

- Not observed in this local turn. No push was performed from this workspace.
- Local acceptance commands match the task command list and passed.

## 3. Decisions

Research plan shape:

- `packages/research` owns deterministic planning only.
- No model call and no gateway dependency are used by planning.
- Depth maps to bounded `quick`, `standard`, and `deep` search/fetch budgets.
- Chinese intents fan out to both zh and en subqueries; English intents only add zh when query/user-locale signals make it relevant.
- Budget exhaustion is surfaced through warnings and `progress.update` side events, not silently dropped.

Provider/mock fixture shape:

- CI uses `MockResearchProvider` only.
- Seeded fixtures cover duplicate URLs, tracking-param variants, zh/en overlap, official/blog/auth/private pages, and five research prompt-injection pages.
- The bilingual MemoryStore fixture is reachable from zh and en subqueries with the same canonical URL/source family.
- No real public internet calls are required by tests.

Snapshot storage path/metadata:

- Research snapshots are immutable JSON artifacts under:
  `<data-dir>/artifacts/research/snapshots/<snapshot_id>.json`
- Snapshot IDs are content-addressed from cleaned content hashes.
- Metadata records URL, canonical URL, title, retrieval time, content hash, source/provider id, labels, grade, MIME, cleaning method, cache key, and optional fetch error.
- TTL cache hits reuse stored snapshots; TTL misses re-fetch through the provider.
- Deny-listed domains produce honest fetch-error snapshots instead of bypassing.

Canonicalization/dedup semantics:

- URL canonicalization lowercases scheme/host, strips common tracking params, sorts remaining query params, drops fragments, and normalizes deterministic AMP-like variants.
- Source dedup keeps one entry per canonical URL or content-equivalence signature.
- Independence keys default to source family/host and can be overridden by fixtures/config.

Source grading rules:

- Supported grades are `primary`, `official`, `news`, `blog`, `forum`, `sns`, and `unknown`.
- Explicit fixture/config grades win.
- Deterministic URL/title heuristics provide fallback grading.
- Citation grade propagation preserves the full source taxonomy, including `sns`.

Citation ledger semantics:

- `research.cite(claim, snapshot_id, span)` requires a stored snapshot, non-empty claim, in-bounds non-empty span, and emits `citation.recorded`.
- Citations bind a claim to a snapshot span; bare URLs are not treated as sufficient evidence.
- Citation payloads keep snapshot refs stable across replay.

Injection quarantine semantics:

- Fetched content is wrapped as quarantined, untrusted page data.
- Research events and tool results carry provenance such as `tool:research.*` and `web:<domain>`.
- The M2 injection defense under test is provenance tagging plus instruction-firewall/quarantine framing.
- Gateway E2E now scripts `research.fetch` for the seeded `tool-exfil` and zh-language injection pages, captures provider request bodies, and asserts malicious page text appears only in quarantined `tool` messages, never in system/developer/user content.
- The same E2E asserts no `memory.written`, no instruction-driven `citation.recorded`, replay visibility for the turn, and no `SECRET_TOKEN` outside quarantined tool-result content.
- The current kernel permission path still hardcodes trusted channel context for tool permission checks, so provenance-driven permission escalation remains a carry-in rather than an asserted M2 behavior.

Tool loop and routing:

- Research tools run through the existing TurnRunner tool loop.
- No second TurnRunner, critic subagent, recursive autonomous loop, MCP, hooks, vendor SDK, embeddings, browser automation, Chronicle write, or personal memory write was added.
- Auth/private research labels compose into prompt labels before route clearance; e2e asserts under-cleared primary denial and local fallback.

## 4. Spec ambiguities

- `research.sources()` on an empty source set: the registered `sourceset.reviewed` schema requires at least one source, so the implementation returns an empty tool result without emitting a canonical `sourceset.reviewed` event.
- Deep source-set review timing: v0 emits deterministic review when enough source data exists, without invoking a critic model.
- Capability narrowing on untrusted fetched content is explicitly out of scope for M2 and remains aligned with the task note for M5.
- CI-green requirement needs a pushed branch/PR to observe GitHub Actions; this local pass does not claim remote CI status.

## 5. Proposed docs edits

These are proposals only. No `docs/` or `docs-zh/` files were edited.

### `docs/specs/research.md`

- Add a v1 boundary note: research is a deterministic library plus `research.*` tool namespace driven by the single TurnRunner.
- Document deterministic planning inputs/outputs, depth budgets, zh/en fan-out, and explicit budget-exhaustion reporting.
- Add snapshot cache shape: path, immutable JSON metadata, content-addressed IDs, TTL behavior, deny-listed-domain handling, and quarantined content policy.
- Document canonicalization, dedup, source grading taxonomy, and independence keys.
- Define citation ledger semantics: claim-to-snapshot-span binding, validation failures, and no bare-URL evidence.
- Define source-set review v0 as deterministic heuristic review, not a critic subagent.

### `docs/specs/protocol.md`

- Clarify payload notes for `snapshot.created`, `citation.recorded`, and `sourceset.reviewed`.
- State that fetch failures and budget warnings must use existing event payload fields or `progress.update`; no new research event type is added.
- Confirm `citation.recorded.payload.grade` accepts `primary`, `official`, `news`, `blog`, `forum`, `sns`, and `unknown`.

### `docs/specs/sandbox-security.md`

- Add research-specific quarantine language for fetched snapshots.
- Record injection corpus v0 coverage: reveal-secrets, tool exfiltration, citation forgery, hidden HTML/comment, and Chinese-language injection.
- Clarify that fetched page text is data only and never enters system/developer/user instruction zones.
- Mark provenance-driven capability narrowing as future M5 work unless the kernel permission path is later wired for it.

### `docs/specs/evals.md`

- Register `research.citation-precision`.
- Register `research.zh-en-parity`.
- Register `injection.research-v0`.
- Note that all three are deterministic CI suites with no LLM judge in M2.

### `docs/specs/data-governance.md`

- Add research label defaults: public web/search content defaults to `public / global-ok`.
- Add authenticated/private research pages as `personal / local-only` or stricter.
- Clarify that fetched/source labels compose into effective prompt labels before model route clearance.

## 6. Manual owner checklist

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M2-03
```

### 1. Mocked research session creates snapshots and citations

Run the gateway with a mock/model fixture that calls `research.plan`, `research.search`, `research.fetch`, and `research.cite`.

Prompt:

```text
Research this with citations: compare Fairy's local MemoryStore approach with external memory services at a high level.
```

Expected evidence:

- `tool.call research.plan`
- `tool.call research.search`
- at least one `snapshot.created`
- at least one `citation.recorded`
- replay shows snapshots and citations
- final answer uses ledger-backed citations, not bare URLs

Save suggested outputs under:

- `tasks/owner-checks/M2-03/research-session.jsonl`
- `tasks/owner-checks/M2-03/research-replay.jsonl`

### 2. zh/en fan-out

Prompt:

```text
Research local-first AI companion memory system design, with Chinese and English sources.
```

Expected evidence:

- plan contains zh and en subqueries
- sources include bilingual/source-family equivalents from the mock fixture
- `research.zh-en-parity` suite passes

Command:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Suggested output path:

- `tasks/owner-checks/M2-03/testing-research-evals.txt`

### 3. Injection page is quarantined

Use the seeded malicious research fixture URLs from `MockResearchProvider`.

Expected evidence:

- malicious content appears only inside quarantined snapshot/tool-result content
- no secret appears in outbound tool args
- no memory record is written from fetched page instructions
- safe handling is visible in replay/audit

Suggested output paths:

- `tasks/owner-checks/M2-03/injection-replay.jsonl`
- `tasks/owner-checks/M2-03/injection-audit.json`

### 4. Source-set review

Command:

```powershell
pnpm fairy research sources --json
```

Expected evidence:

- parseable JSON
- sources have grades and independence keys
- duplicate/mirror fixtures collapse
- weak/single-family warning appears when applicable

Suggested output path:

- `tasks/owner-checks/M2-03/research-sources.json`

### 5. Snapshot and citation CLI

Commands:

```powershell
pnpm fairy research snapshots --json
pnpm fairy research show-snapshot <snapshot_id> --json
pnpm fairy research citations --json
pnpm fairy replay <sid> --json
```

Expected evidence:

- JSON is parseable
- snapshot content hash and labels are visible
- `show-snapshot` marks content as untrusted/quarantined
- citations resolve to snapshot spans
- replay includes `snapshot.created`, `citation.recorded`, and `sourceset.reviewed`

Suggested output paths:

- `tasks/owner-checks/M2-03/research-snapshots.json`
- `tasks/owner-checks/M2-03/research-snapshot-show.json`
- `tasks/owner-checks/M2-03/research-citations.json`
- `tasks/owner-checks/M2-03/replay.jsonl`
