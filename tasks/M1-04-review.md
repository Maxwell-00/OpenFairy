# M1-04 Review — Conformance kit v1 + second provider + fallback chains + prompted tools

**Verdict:** ACCEPTED WITH NOTES  
**Milestone status:** M1 CAN CLOSE  
**Reviewed commit:** `7b44550`  
**GitHub Actions:** run `28650999238`, CI `Success`, matrix `verify`, 2 jobs completed (`ubuntu-latest`, `windows-latest`)  
**Task brief:** `tasks/M1-04-conformance-fallback.md`  
**Codex report:** `tasks/M1-04-work.md`

## Evidence base

### Verified

- Reviewed committed GitHub state at `7b44550`.
- Verified the GitHub Actions run is green for the CI matrix.
- Verified the M1-04 task brief deliverables against code and tests.
- Verified Codex's work report claims against committed files where possible.
- Parsed the uploaded Ollama replay JSONL. It contains a real `tool.call` and `tool.result` for `fs.read`.
- Checked uploaded owner logs for DeepSeek conformance, Ollama conformance, and Ollama audit.

### Owner-stated

- DeepSeek live conformance ran against a real DeepSeek-compatible endpoint.
- Ollama live conformance ran against a local Ollama OpenAI-compatible endpoint.
- Ollama tool chat used model `qwen3.5:4b` and config id `ollama-live`.

The uploaded logs support these statements, but I did not independently connect to the owner's private endpoints.

### Not verified

- I did not rerun live DeepSeek/Ollama conformance with real credentials.
- I did not inspect private CI logs behind GitHub sign-in beyond the public run summary and annotations.
- I did not apply Codex's proposed docs edits in this review pass.

## BLOCKER

None.

## CARRY-IN

1. **Harden live conformance's tool-call case.**  
   Current live conformance accepts either `tool_call` or `done` for `live trivial tool-call shape`. That is too weak for a task that says the trivial echo tool should round-trip. This did not block M1-04 because the uploaded Ollama replay and audit prove a real tool call path. M2-01 must change live conformance so this case either:
   - requires an actual `tool_call`, or
   - reports an explicit `SKIP` / `DEGRADED` with a machine-readable reason when a model cannot or will not call tools.
   It must not mark a plain `done` as full `PASS`.

2. **Reviewer-owned docs edits still need application.**  
   Codex correctly proposed docs edits instead of editing `docs/`. Apply after review:
   - `docs/specs/protocol.md`: frame shapes for `{kind:"ack"}` and `{kind:"op-error"}`.
   - `docs/specs/model-gateway.md`: `capabilities.tools`, fallback trace/progress payload, prompted parser tolerances.
   - Ollama OpenAI-compatible config note: `base_url: http://127.0.0.1:11434/v1`, dummy/empty key acceptable where adapter supports it.

3. **Add a cheap provider-special-case guard.**  
   The code inspection did not find kernel vendor branches, but this should become a CI grep or depcruise rule:
   - no `ollama`, `deepseek`, `openai-specific`, or provider-name branches in `packages/kernel`.
   - provider quirks stay in `packages/model-gateway` and `packages/testing`.

## NIT

- The uploaded Ollama conformance file is mojibaked under the file-search renderer. The content decodes cleanly, but future owner logs should be UTF-8 plain text.
- Codex reported `pnpm lint` locally hanging during pnpm's `Recreating node_modules` phase and used direct `eslint` as an equivalent local check. CI green covers acceptance, but keep watching pnpm store-lock friction on Windows.

## Acceptance matrix

| Task deliverable | Result | Evidence | Notes |
|---|---:|---|---|
| Conformance kit v1, mock mode | PASS | `packages/testing/src/conformance.ts`; Codex report; CI | Mock suite covers streaming, tool-call deltas, reasoning shapes, usage present/missing, finish/error mapping, retry/auth/context-overflow, watchdog, dotted-name rejection, wire-name codec. |
| Live conformance mode | PASS WITH NOTE | Uploaded DeepSeek/Ollama logs | Both live logs show PASS verdicts. Live tool-call assertion is too permissive; see carry-in #1. |
| Ollama as second provider | PASS | Config surface + uploaded Ollama logs/replay | No separate kernel provider branch is required. OpenAI-compatible `/v1/chat/completions` path is normalized in transport. |
| Fallback chains | PASS | `packages/model-gateway/src/gateway.ts`; e2e fallback test | Candidate streams are buffered when fallback exists. Failed candidate output is not mixed with fallback output. Fallback is emitted as progress and attached to `model_trace`. |
| Fallback only at safe boundaries | PASS | Gateway fallback implementation | Model switching occurs while entering a candidate attempt or after a candidate attempt fails before its buffered events are emitted. No silent mid-stream model swap observed. |
| Fallback visibility | PASS | e2e fallback test | `progress.update` payload carries `stage:"model-fallback"`, `from`, `to`, and `reason`; final trace carries fallbacks. |
| Prompted-tools rung 2 | PASS | `openai-chat.ts`; prompted e2e tests; uploaded Ollama replay | Parser accepts fenced JSON, prose-ish/CJK/single-quote variants; validates against schema; repair loop is bounded to ≤2. |
| Prompted-tools downstream indistinguishable | PASS | Gateway e2e + uploaded replay | Normal events are `tool.call` and `tool.result`; kernel/permission/audit path sees `fs.read` exactly as native tool calls. |
| Ack/op-error uniformity | PASS | protocol frame schemas/tests; gateway e2e | `ack` and `op-error` are transport frames, not canonical event types. Session facts remain envelopes. |
| Sandbox escape mini-suite | PASS | `packages/tools-std/test/index.test.ts`; CI | Covers path escape, symlink escape, safe no-network, and container mount containment. Docker-dependent cases skip cleanly where unavailable. |
| Source-first workspace | PASS | package manifests | `@fairy/model-gateway` exports `./src/index.ts`; root scripts use `tsx` execution world. |
| Raw HTTP/SSE transport, no SDK | PASS | root deps + transport code | No OpenAI SDK dependency. Transport uses `fetch`/SSE normalization. |
| Provider quirks at transport/fixture boundary | PASS | wire-name codec; mock parity test | Dotted internal tool names are encoded only at wire boundary and decoded before kernel/permission/audit. |
| No docs-zh edits | PASS | commit file tree | Changed files list contains no `docs-zh/`. |
| CI secret-free | PASS | task design + CI evidence | Live conformance is owner-run. CI runs mock conformance only. |

## Boundary checks

### Kernel provider special cases

Accepted.

The kernel continues to consume normalized model events and tool calls. Ollama/DeepSeek-specific behavior is not embedded in the kernel. The visible provider-specific workaround is the tool-name wire codec in `model-gateway`, where it belongs.

### Transport quirks

Accepted.

The dotted-name incident from M1-02 is now codified:
- internal: `fs.read`, `shell.run`
- wire: `fs__read`, `shell__run`
- decode before normalized `tool_call`
- mock rejects dotted wire names

### Prompted-tools proof

Accepted.

Do not use live conformance PASS alone as proof. The proof is the uploaded Ollama replay:

- `context.manifest.payload.model = "qwen3.5:4b"`
- `tool.call.payload.tool = "fs.read"`
- `tool.call.payload.args.path = "README.md"`
- `tool.result.payload.status = "ok"`
- `tool.result.payload.provenance = "tool:fs.read"`
- final `model_trace.model_id = "ollama-live"`

Audit corroborates the same session and turn:
- `permission.decide fs.read allow ses_01KWKVQ63YTJ5SFG7Y64QPYWV0#1`
- `tool.execute fs.read ok ses_01KWKVQ63YTJ5SFG7Y64QPYWV0#1`

### Event canon

Accepted.

`ack` and `op-error` are frames. They are schema'd and fixture-tested outside the event registry. They are not appended as session facts.

## Final decision

M1-04 is **ACCEPTED WITH NOTES**.

The note is not a blocker because the only weak point is live conformance strictness, and the owner replay/audit evidence independently verifies a real Ollama prompted-tool call through the normal tool loop.

M1 can close.

---

## Countersignature (second reviewer: Claude, Cowork) — 2026-07-03

Independent spot-verification against git `08fc692`, focusing on what the primary review recommended but did not execute:

- **Kernel provider-string check (carry-in #3's premise): RAN IT — clean.** `git grep -i "ollama|deepseek|openai" packages/kernel/src/` → zero hits.
- Frame schemas confirmed at `packages/protocol/frames/` (ack, op-error) with fixtures — correctly **outside** the event registry.
- Prompted parser confirmed transport-only (`openai-chat.ts`); no kernel involvement.
- Ollama replay JSONL sampled: valid envelopes, real labels, real `turn.input` — corroborates the primary review's parse.
- **Carry-in #2 (reviewer-owned doc edits): APPLIED** — protocol §7 normative frame shapes; model-gateway status note (fallback buffering semantics, `capabilities.tools`, Ollama config) + §5 rung-2 implemented note incl. the accepted `ProviderError`-instead-of-`ToolError` layering deviation.
- Carry-in #1 (live conformance strictness) and #3 (CI guard): confirmed present in the M2-01 brief.

Primary review verdict **upheld**. **M1 CLOSED** — the text spine is complete: any OpenAI-compatible brain, tools with permissions and audit, survivable long sessions, offline inspection, and a conformance kit that makes "config-only provider switch" a tested property.

## Post-close CI flake (2026-07-03, fixed)

Ubuntu-only timeout in `tools-std > runs safe shell profile without network` (5004 ms vs 5000 ms default). Two compounding causes: ① the probe used `dns.lookup` — under `--network none`, DNS failure latency depends on the runner's resolv.conf (glibc waits up to 5 s per nameserver): nondeterministic by construction; ② the first Docker test in the file pays container cold-start with no explicit timeout. Fixes: probe replaced with fixed-IP TCP connect carrying its own 1.5 s deadline (no resolver dependence); both Docker tests given explicit 60 s vitest timeouts; CI pre-pulls `node:22-slim` on ubuntu before tests. Rule extended: **in-container probes must carry their own deadline and never depend on resolver/library timeout defaults; docker-dependent tests always declare explicit generous timeouts.**
