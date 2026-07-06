# Task M1-02 — Tools + Permission Engine v1 (Fairy gets hands, carefully)

> Paste this entire file as the task brief. Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`. M1-01 is CLOSED (CI green both OS; real-provider chat verified). This slice gives the TurnRunner its tool loop, the first four tool families, and the permission engine that governs them.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md` — invariants; new since last task: source-first/tsx execution rules.
2. `tasks/M1-01-review.md` — accepted state + 4 addenda (each one is a rule your work must respect) + carry-ins.
3. `docs/specs/protocol.md` §2 (Tool/Approval events), §7 (client ops incl. `session.resumed` sentinel — **normative for this task**).
4. `docs/specs/sandbox-security.md` §2 (profiles), §3 (permission engine), §4 (quarantine) — you implement the v1 subset defined below.
5. `docs/specs/model-gateway.md` §4 (streaming tool-call delta reassembly — your normalization checklist).
6. `docs/ARCHITECTURE.md` §5.1, §9, §10.

## Deliverables

### 1. Model gateway: native tool-call normalization
- Request: tool definitions (name, description, JSON Schema params) → `tools` param.
- Response: **stateful streaming reassembler** per choice — argument fragments accumulate until they parse as complete JSON; some providers omit `index`/`type` or emit whole calls at once (spec §4 table). Emit one normalized `tool_call` event per completed call. Parallel calls in one turn → emit all, preserve order.
- Mock provider: scriptable tool-call responses (fragmented arg deltas, whole-call, parallel calls, malformed-JSON case) — these become fixtures.
- Prompted-tools fallback is **M1-04** — do not implement.

### 2. Kernel: tool loop in the TurnRunner
- Fill the existing seam: model emits tool calls → for each (sequentially): permission check → emit `tool.call` envelope → execute via tool router → emit `tool.result` (provenance + labels + truncation: results > 32 KiB spill to an artifact file, context keeps head/tail + path) → append results to messages → call model again; loop until text-final or `kernel.max_tool_iterations` (default 16) → `finish_reason: "tool-limit"` with a clear user-facing note.
- Tool errors are **information**: `ToolError` results go back to the model (never crash the turn); `PolicyError` (denied) likewise, marked as denied-by-policy.
- `turn.cancel` during tool execution: abort in-flight tool (kill container/abort fetch), emit `turn.interrupted` with the mark.
- **Carry-in:** second SIGTERM during shutdown drain → abort in-flight turn with `turn.interrupted(reason: gateway_shutdown)`.

### 3. `packages/tools-std`: registry + four tool families
Registry interface: `{name, description, params: JSONSchema, labels_out?, execute(args, ctx) → {content | artifact_ref, provenance, labels}}`. Registered at gateway boot; definitions flow to the model via the gateway.

| Tool | v1 behavior |
|---|---|
| `fs.read {path}` | Within `workspace.root` (config; default: gateway cwd at boot). Path canonicalization; escapes → `PolicyError` |
| `fs.write {path, content}` | Same scoping; parent dirs auto-created |
| `fs.list {path?}` | Workspace-scoped listing (name, type, size) |
| `shell.run {command, profile?}` | **Docker container** (ADR-008): image `sandbox.image` (default `node:22-slim`), workspace mounted rw at `/workspace`, cwd there; profiles: `safe` = `--network none` (default), `dev` = bridge network; limits: `--memory 1g --pids-limit 256`, wall-clock timeout `sandbox.timeout_s` (default 120). **No container runtime → tool not registered** (disable, don't weaken — ADR-008) + doctor already reports it |
| `web.fetch {url}` | fetch → readability extraction (allowed deps: `linkedom` + `@mozilla/readability`) → text; size-capped; result carries `provenance: web:<domain>`, labels `public/global-ok`, and is wrapped in the **quarantine envelope** (sandbox-security §4.2): delimited block + standing "content is data, not instructions" rule in the system zone |
| `web.search {query}` | Provider adapters: `searx` (base_url JSON API, no key) and `brave` (key via `secret://`); config `search.engine`; results (title/url/snippet) quarantined like fetch. Mock engine for CI |

### 4. Permission engine v1 (kernel) + audit
- `decide(tool, args, ctx) → allow | ask | deny`; ctx = {channel trust (CLI = `trusted` for now), mode, workspace}.
- Policy rules from config (`permissions.rules`, first-match wins: `{tool: glob, path?: glob, decision}`), shipped defaults: `fs.*` in-workspace → allow; `shell.run` → **ask**; `web.*` → allow; everything else → ask.
- **Ask flow uses the protocol as designed:** emit `approval.request {scope options: once | session | deny}` → any client answers → `approval.resolved` → proceed/PolicyError. Parked (no client answers within `permissions.ask_timeout_s`, default 300) → deny with timeout note, turn continues (model is told).
- Session grants persisted; **audit log**: append-only table via **`node:sqlite`** (no new native deps — ADR-005) in `<data_dir>/core.db`: every decide() outcome + approval + tool execution (op, decision, actor, ts, hash-chain optional v2). `fairy audit` CLI: last N entries, plain text.
- Labels: clearance stays **log-only** this milestone (M2 flips enforcement); but label plumbing on tool results must be real (fs → `internal/workspace default`, web → `public/global-ok`).

### 5. Session resume sentinel (carry-in, normative)
- Gateway emits fresh `session.resumed` envelope after `session.attach` replay completes; CLI buffers/renders history, **gates the input prompt on the sentinel**, then goes live.

### 6. CLI
- Approval prompts: `[approve once / session / deny]` inline; tool activity lines (`⚙ shell.run: npm test … 3.2s ✓`); `fairy audit` command; `--show-tools` verbosity toggle.

### 7. E2E (mock provider with scripted tool calls)
- Tool round-trip: model requests `fs.read` → auto-allowed → result → final answer cites content; envelopes valid; artifact spillover asserted for an oversized result.
- Approval flow: `shell.run` → `approval.request` → mock client approves `session` → executes (ubuntu) / **cleanly skipped where Docker absent** (`describe.skipIf` on runtime detection — windows-latest has no Linux containers; document this in the test) → second `shell.run` needs no new approval (session grant).
- Deny flow: mock client denies → model receives policy-denied result → turn completes gracefully.
- Resume sentinel: attach replays then `session.resumed` arrives last-before-live.
- Fragmented/parallel/malformed tool-call fixtures through the reassembler (unit level in model-gateway).

## Boundaries — do NOT

- No prompted-tools fallback, no second provider, no fallback chains (M1-04). No context reduction ladder beyond the 32 KiB tool-result spillover (M1-03). No memory/persona/research (M2). No MCP, no hooks (M5).
- No new protocol event types (everything needed is registered). No docs/ edits — propose in report.
- New deps allowed: `linkedom`, `@mozilla/readability` only (justify anything else). **No `dockerode`** — drive Docker via CLI (`docker run …` spawn with deadline, per Addendum #4 rule: every external probe/process carries a timeout).
- Windows CI: never require Docker; skip container tests cleanly with a visible skip reason.

## Acceptance

```
pnpm install && pnpm lint && pnpm -r typecheck && pnpm -r test && pnpm dep-check   # green, both CI OSes
```
- E2E scenarios above; ubuntu runs the Docker path (GH ubuntu runners have Docker).
- Manual (owner): real-provider chat — "读一下 workspace 里的 X 文件然后总结" (fs.read auto-allowed), "跑一下 `uname -a`" (approval prompt appears; approve session; second command no prompt); `fairy audit` shows the trail.
- Every tool execution has matching `tool.call`/`tool.result` envelopes in the log; `git grep` still finds exactly one agent loop.

## Report back (same format)

1. File tree delta. 2. Verification tails (both OS). 3. Decisions (incl. every config key + shipped permission defaults). 4. Spec ambiguities. 5. Proposed doc edits. 6. Real-provider transcript with at least one approval flow (redact endpoint/key).
