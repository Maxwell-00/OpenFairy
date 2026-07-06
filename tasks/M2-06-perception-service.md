# Task M2-06 — Perception Service v1 + image/document artifact pipeline

> Paste this entire file as the task brief.
>
> Repo: `E:\Claude_Projects\Projects\Fairy\OpenFairy`.
> M0 and M1 are closed. M2-01 through M2-05 are closed at task level.
>
> This task implements the M2 perception slice: image/document ingest, artifact registration, deterministic mock perception, `vision.describe` / `vision.ocr` tools, replayable perception events, and governance-safe prompt injection of structured descriptions.
>
> It must not start M3 voice, computer-use, browser automation, or a second agent loop.

## Context — read first, in this order

1. `CLAUDE.md` / `AGENTS.md`
   - One TurnRunner. Modes are policies, not extra loops.
   - Event-sourced JSONL sessions are the source of truth.
   - Source-first TS workspace until M5.
   - No dist exports.
   - No sibling package builds for tests.
   - Gateway/CLI spawned processes use the same TS execution world.
   - Raw HTTP/SSE model transport; no provider SDK.
   - CI never uses real API keys.
   - Do not read or edit `docs-zh/`.

2. `REVIEWER-HANDBOOK.md`
   - Review/brief-gate discipline.
   - Mount staleness and git-lock caveats.
   - Docs are reviewer-owned.
   - Mock providers must reject what real providers reject.
   - New capability requires an eval suite.

3. `tasks/M2-05-review.md`
   - M2-05 is closed.
   - Persona/affect is style-only and must not affect tools, routing, permissions, MemoryGate, egress, or factual payload.
   - M2-05 docs pass is reviewer-owned; Codex may propose docs edits only.

4. `docs/ROADMAP.md`
   - M2 includes perception service: image ingest + `vision.describe` / `vision.ocr`.
   - M2 exit includes S7 screenshot flow.
   - M3 voice is later; do not implement voice transport in this task.

5. `docs/specs/model-gateway.md`
   - §6 Perception service is the normative design.
   - Text-only main brain may use perception roles for images/PDFs/screenshots.
   - Perception outputs are structured description artifacts.
   - Perception outputs carry provenance and inherit source trust/labels.
   - Hostile image OCR text is untrusted content.

6. `docs/specs/protocol.md`
   - Canonical event registry is closed.
   - Existing `artifact.created` event must be used for content artifacts.
   - Transport frames are not canonical events.
   - Do not add new event types unless already registered and schema/fixtures are updated.

7. `docs/specs/context-engine.md`
   - Filesystem as context: bulky content lives in artifacts; prompt keeps path + digest.
   - Context manifest is observational only.
   - Persona/memory/research labels already join effective labels before route clearance; perception labels must follow the same rule.

8. `docs/specs/data-governance.md`
   - Labels derive by max sensitivity and residency intersection.
   - Authenticated/private screenshots default personal / region-restricted(home) or stricter.
   - OCR/perception outputs inherit source labels and may raise prompt effective labels.
   - Secret-like text detected in OCR must escalate to secret/local-only and never leave cleared routes.

9. `docs/specs/sandbox-security.md`
   - Untrusted content must be quarantined.
   - Fetched/OCR/perception text is data, never instruction.
   - M2 tests may cover firewall/quarantine behavior; broad capability narrowing remains M5 unless explicitly implemented with precise tests.

10. `docs/specs/evals.md`
    - Add deterministic PR-tier perception evals with mock fixtures.
    - No real cloud vision or real OCR engine calls in CI.

## Deliverables

### 0. Preserve existing invariants

Before adding perception behavior, preserve or add regression tests proving:

- Memory, research, governance, persona/affect named suites remain visible and green.
- Persona/affect remains style-only and does not alter perception tool execution, routing, permissions, or factual payload.
- Research injection quarantine remains green.
- Egress guard still blocks secret/personal outbound tool args before execution.
- No provider-specific branches appear in kernel.
- No vendor SDK is added.
- No `docs/` or `docs-zh/` edits.

Carried-over hygiene (failed M2-05 acceptance item — mandatory this time):

- `packages/kernel/src/governance.ts` still contains a mojibake alternative (a double-encoded remnant of the simplified-Chinese OTP anchor) inside the four OTP regexes: two in `credentialPatterns` (~lines 22-23) and two `otp_code` entries in the sensitive-pattern list (~lines 193-194). Each alternation currently reads `...|code|<CJK simplified>|<CJK traditional>|<mojibake>)`. Delete the fourth (mojibake) alternative and its preceding `|` in all four regexes so each alternation ends with the traditional-Chinese term directly followed by `)`. Delete bytes only; do not retype the regexes.
- Verify with this ASCII-only command (do NOT paste raw CJK into any terminal — that is exactly how the M2-05 check silently failed):

```powershell
node -e "const s=require('fs').readFileSync('packages/kernel/src/governance.ts','utf8');const tw='\u9a57\u8b49\u78bc';const closed=(s.split(tw+')').length-1);const open=s.includes(tw+'|');if(closed!==4||open){console.error('FAIL: OTP alternation not clean; occurrences ending with )='+closed+', trailing-pipe remnant='+open);process.exit(1)}console.log('PASS: OTP anchor alternation clean (4/4)')"
```

- Paste the command's output verbatim into the work report.

Acceptance:

- Existing M2 test suites remain green.
- `pnpm dep-check` remains green.
- `git diff --name-only -- docs docs-zh` has no output.
- The mojibake verification command above prints PASS, and existing OTP/egress unit tests are unchanged and green.

### 1. Artifact registration for perception inputs

Implement artifact ingestion for image/document-like inputs under the existing data directory.

Required behavior:

- Add or extend an artifact registry that stores:
  - content hash,
  - path under `sessions/<sid>/artifacts/` or data-dir equivalent,
  - MIME type,
  - labels,
  - origin/provenance,
  - created event id,
  - optional source filename.
- Emit canonical `artifact.created` when an input image/document artifact is registered.
- Artifact IDs/paths must be deterministic enough for replay.
- Blob content must not be embedded into JSONL.
- Labels must be explicit and inherited from the user input or source context.
- Secret-like OCR/perception text must not rewrite the original artifact labels downward.

Acceptance:

- Protocol schema/fixtures for `artifact.created` remain valid or are updated additively.
- Unit tests for content hash, MIME detection, path containment, label inheritance, and JSONL no-blob property.
- Replay renders `artifact.created` compactly and JSON replay preserves payload.

### 2. Perception role / mock provider interface

Implement a perception service interface in the appropriate package boundary.

Required behavior:

- The kernel/TurnRunner invokes perception through a subsystem/tool path, not by creating a second agent loop.
- Perception role binding uses existing model-gateway role semantics where applicable, e.g. `perception.vision`.
- CI uses deterministic mock perception only.
- No real cloud vision calls in CI.
- The interface supports at least:
  - describe image/artifact with optional question;
  - OCR image/artifact with optional region;
  - document text extraction for simple text/PDF-like fixtures through mock parser.
- Perception provider output is normalized into a structured description artifact.

Acceptance:

- Unit tests for mock provider deterministic outputs.
- No `model-gateway` vendor SDK dependency.
- No `packages/kernel` provider-specific strings.
- Mock fixtures include:
  - benign screenshot,
  - malicious prompt-injection screenshot,
  - image containing fake API key text,
  - bilingual zh/en text image,
  - simple document fixture.

### 3. `vision.describe` and `vision.ocr` tools

Add perception tools, driven by the existing TurnRunner tool loop.

Minimum tools:

```text
vision.describe(artifact_id_or_path, question?)
vision.ocr(artifact_id_or_path, region?)
```

Required behavior:

- Tool calls emit canonical `tool.call` / `tool.result`.
- Tool result provenance is `tool:vision.describe` or `tool:vision.ocr`.
- Tool result labels inherit artifact labels and any semantic escalation from OCR text.
- Bulky outputs spill to artifacts; prompt receives a compact digest + artifact ref.
- Tool results are quarantined when they contain OCR/perception text from untrusted sources.
- The model sees perception text as data, never as system/developer/user instruction.

Acceptance:

- E2E: mock model calls `vision.describe`; tool loop completes; replay shows `tool.call`, `tool.result`, and any created structured description artifact.
- E2E: mock model calls `vision.ocr` on a bilingual fixture; result labels/provenance are asserted.
- E2E: malicious OCR instruction cannot drive a later tool call, memory write, citation, provider request, or permission change except as quoted/quarantined content.
- E2E: OCR fake API key escalates labels to `secret/local-only`, and an under-cleared primary receives zero request bytes after escalation; cleared local fallback completes if configured.

### 4. Context integration

Add perception descriptions to prompt assembly as compact artifact references, not raw blobs.

Required behavior:

- For user-submitted image/document artifacts, render a compact context block:
  - artifact id/path,
  - MIME,
  - short structured description,
  - OCR excerpt if present,
  - labels,
  - provenance.
- Long OCR text must be stored as artifact spillover, not dumped into prompt.
- Perception labels join effective prompt labels before route clearance.
- `context.manifest` reports perception/artifact tokens if a new zone is needed; otherwise account them under current input or tool result zones. Do not invent ambiguous accounting.

Acceptance:

- Context tests for:
  - artifact ref enters prompt;
  - no raw base64/blob in prompt;
  - long OCR spillover;
  - effective labels raised before route clearance;
  - manifest token accounting;
  - manifest remains observational only.

### 5. Governance and injection handling

Perception content is untrusted unless it comes from a trusted local artifact explicitly labeled otherwise.

Required behavior:

- OCR/perception text from screenshots/images is framed as untrusted content.
- OCR secret patterns escalate to `secret/local-only`.
- Authenticated/private screenshot fixtures use `personal/local-only` or `personal/region-restricted(home)`.
- Egress guard applies to OCR-derived personal/secret content.
- Denials use existing events/stages only. Do not create `perception.denied` or similar canonical event types.
- Audit/replay diagnostics redact secret OCR strings but preserve fingerprints.

Acceptance:

- E2E: screenshot with fake API key is not sent to under-cleared model after OCR escalation.
- E2E: attempted egress of OCR-derived fake API key is denied before tool execution and redacted in audit/replay.
- E2E: malicious OCR instruction stays quarantined and does not affect permission/routing decisions beyond deterministic label escalation.
- Tests assert no new canonical event type is used.

### 6. CLI and replay visibility

Add minimal CLI/replay support for perception artifacts.

Minimum CLI:

```powershell
pnpm fairy artifacts list --json
pnpm fairy artifacts show <artifact_id> --json
pnpm fairy artifacts show <artifact_id> --text
```

If an `artifacts` CLI already exists, extend it. If not, add the minimal command surface above.

Required behavior:

- Commands use the same config/data-dir discovery as other CLI commands.
- JSON output is parseable and stable enough for owner evidence.
- `show --text` marks OCR/perception text as untrusted/quarantined when applicable.
- Replay text mode renders `artifact.created` and vision tool results compactly.
- Replay JSON preserves full payloads.

Acceptance:

- CLI tests with temp data dir.
- Replay tests for `artifact.created`, `vision.describe`, and `vision.ocr` outputs.
- Corrupt-tail replay tolerance remains green.

### 7. Perception eval suite

Register deterministic PR-tier evals in `packages/testing`.

Required suite name:

```text
perception.quarantine-v0
```

Required coverage:

- benign screenshot summary;
- OCR bilingual text;
- malicious screenshot prompt injection;
- fake API key OCR escalation;
- egress/redaction for OCR-derived secret;
- no real image model or cloud OCR in CI.

Acceptance:

- Suite name appears in `pnpm --filter @fairy/testing test -- --reporter=verbose`.
- Suite does not fake-pass with empty assertions.
- No real web, no real vision API, no real API key in CI.

### 8. Docs proposals only

Do not edit `docs/` or `docs-zh/` in this task.

In `tasks/M2-06-work.md`, propose exact docs edits for reviewer application:

- `docs/specs/model-gateway.md`
  - Perception service v1 implementation status.
  - Mock provider / real provider boundary.
  - `vision.describe` / `vision.ocr` tool semantics.
  - Note: spec §6 currently says perception outputs carry `provenance: tool:vision`; implementation should use the established per-tool convention (`tool:vision.describe` / `tool:vision.ocr`, matching `tool:research.*`) and the docs pass will update §6 wording accordingly.

- `docs/specs/protocol.md`
  - `artifact.created` payload notes if updated.
  - Replay visibility notes for perception artifacts.

- `docs/specs/context-engine.md`
  - Perception artifact refs / OCR spillover accounting.
  - Label composition before route clearance.

- `docs/specs/data-governance.md`
  - OCR/perception label defaults and escalation.

- `docs/specs/sandbox-security.md`
  - Perception/OCR quarantine and injection fixture status.

- `docs/specs/evals.md`
  - `perception.quarantine-v0` registration.

## Boundaries — do NOT

- Do not implement M3 voice.
- Do not implement ASR/TTS/VAD.
- Do not implement browser automation or computer-use.
- Do not implement OCR by calling a real cloud provider in CI.
- Do not add OpenAI/Anthropic/vendor SDKs.
- Do not add a second TurnRunner.
- Do not add a critic subagent.
- Do not implement full capability narrowing unless explicitly scoped with tests; M2 only needs quarantine/firewall and label/egress behavior.
- Do not auto-persist OCR/perception text into personal memory.
- Do not add new canonical event types unless the protocol registry already contains them and schemas/fixtures are updated additively.
- Do not dump image bytes/base64 into JSONL or prompt text.
- Do not edit `docs/`.
- Do not edit `docs-zh/`.

## Acceptance commands

```powershell
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm dep-check
pnpm conformance
git diff --check
git diff --name-only -- docs docs-zh
```

GitHub Actions must be green on the existing ubuntu + windows CI matrix.

## Manual owner checks

Owner should run after CI is green.

Suggested evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M2-06
```

### 1. Perception eval suite

Run:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
```

Expected:

- `perception.quarantine-v0` appears and passes.
- Existing M2 suites still pass.

Save:

```text
tasks/owner-checks/M2-06/testing-perception.txt
```

### 2. Vision tool loop

Run a mock/fixture turn where the model calls `vision.describe` and `vision.ocr`.

Expected:

- `tool.call vision.describe`
- `tool.call vision.ocr`
- `tool.result` provenance `tool:vision.*`
- `artifact.created`
- replay shows vision tool results and artifact refs.

Save:

```text
tasks/owner-checks/M2-06/vision-replay.jsonl
```

### 3. OCR secret escalation and routing

Use a fixture image containing fake API key text.

Expected:

- OCR text escalates to `secret/local-only`.
- Under-cleared primary receives zero request bytes after escalation.
- Local fallback completes if configured.
- Audit/replay redacts the fake key in diagnostics.

Save:

```text
tasks/owner-checks/M2-06/ocr-secret-routing-replay.jsonl
```

### 4. Malicious screenshot quarantine

Use a fixture screenshot containing prompt-injection text.

Expected:

- Malicious text appears only in quarantined perception/tool-result content.
- It does not become system/developer/user instruction.
- It does not drive memory write, citation, permission change, or egress.

Save:

```text
tasks/owner-checks/M2-06/perception-injection-replay.jsonl
```

### 5. Artifact CLI

Run:

```powershell
pnpm fairy artifacts list --json
pnpm fairy artifacts show <artifact_id> --json
pnpm fairy artifacts show <artifact_id> --text
```

Expected:

- JSON parseable.
- Artifact labels/hash/provenance visible.
- Text output marks OCR/perception content as untrusted/quarantined.

Save:

```text
tasks/owner-checks/M2-06/artifacts-list.json
tasks/owner-checks/M2-06/artifact-show.json
tasks/owner-checks/M2-06/artifact-show.txt
```

## Report back

Use the established format:

1. File tree delta.
2. Verification tails:
   - local commands,
   - CI link/status,
   - conformance verdict,
   - named eval suite names.
3. Decisions:
   - artifact storage path and id semantics,
   - perception provider/mock shape,
   - tool names and result payloads,
   - OCR/text quarantine semantics,
   - label escalation/egress behavior,
   - CLI/replay shape.
4. Spec ambiguities.
5. Proposed docs edits.
6. Manual owner checklist with exact commands and evidence paths.
