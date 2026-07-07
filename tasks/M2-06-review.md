# M2-06 Review — Perception Service v1 + image/document artifact pipeline

Review date: 2026-07-07  
Reviewer: ChatGPT 5.5 Thinking  
Task brief: `tasks/M2-06-perception-service.md`  
Delivery commit: `ceb2a74`  
CI: GitHub Actions run `28852734183`, success, ubuntu + windows matrix completed.

## Verdict

**ACCEPTED WITH NOTES / CLOSED.**

M2-06 implements the perception slice: artifact registration, deterministic mock perception, `vision.describe` / `vision.ocr`, perception quarantine, OCR secret label escalation, artifact CLI, replay visibility, and the deterministic `perception.quarantine-v0` eval path.

Owner evidence is Codex-generated deterministic fixture evidence. This is acceptable for this task because no real provider, real image model, real OCR API, or manual UI judgment is required.

## Evidence base

- Commit `ceb2a74` / `M2-06-work finish`.
- CI run `28852734183` / `M2-06-work finish #61`: success, matrix `verify`, 2 jobs completed.
- Work report: `tasks/M2-06-work.md`.
- Owner evidence:
  - `tasks/owner-checks/M2-06/testing-perception.txt`
  - `tasks/owner-checks/M2-06/vision-replay.jsonl`
  - `tasks/owner-checks/M2-06/ocr-secret-routing-replay.jsonl`
  - `tasks/owner-checks/M2-06/perception-injection-replay.jsonl`
  - `tasks/owner-checks/M2-06/artifacts-list.json`
  - `tasks/owner-checks/M2-06/artifact-show.json`
  - `tasks/owner-checks/M2-06/artifact-show.txt`

## Acceptance review

### 0. Existing invariants

**PASS.**

Work report records all acceptance commands passed: `pnpm install` equivalent, `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test`, `pnpm dep-check`, `pnpm conformance`, `git diff --check`, and `git diff --name-only -- docs docs-zh`.

Existing named suites remain visible, and `perception.quarantine-v0` appears under `packages/testing/test/gateway.e2e.test.ts`.

No `docs/` or `docs-zh/` files were edited.

### 1. Artifact registration

**PASS.**

`packages/perception` adds `ArtifactRegistry`, content-addressed `art_<hash>` artifact ids, artifact metadata JSONL, MIME detection, path containment, `artifactEventPayload()`, and no blob content in canonical payloads.

Owner evidence and replay show canonical `artifact.created` events for input and perception artifacts.

### 2. Mock perception provider

**PASS.**

`MockPerceptionProvider` supports deterministic `describe`, `ocr`, and `extractDocument`, with required fixtures:

- benign screenshot;
- malicious prompt-injection screenshot;
- fake API key image;
- bilingual zh/en image;
- simple document fixture;
- long OCR fixture for spillover.

No real cloud vision/OCR calls are required by tests or CI.

### 3. `vision.describe` / `vision.ocr` tools

**PASS.**

`packages/tools-std` registers `vision.describe` and `vision.ocr`. Tool results use per-tool provenance:

- `tool:vision.describe`
- `tool:vision.ocr`

Owner replay shows `tool.call vision.describe`, `tool.result ... tool:vision.describe`, `tool.call vision.ocr`, and `tool.result ... tool:vision.ocr`.

### 4. Context integration and label propagation

**PASS.**

Gateway renders artifact content parts as compact prompt references and ignores blob/base64/raw content. Artifact labels join input labels before route clearance.

Owner evidence shows `context.manifest.effective_labels` raised to `personal/local-only` for a user input containing a personal/local-only artifact part. The same replay shows perception tool outputs are represented through compact quarantine blocks and artifact refs.

### 5. Governance and injection handling

**PASS.**

OCR/perception text is wrapped as quarantined untrusted content. Fake API key OCR escalates labels to `secret/local-only`.

Owner evidence proves:

- `vision.ocr` on `fake-api-key-image` emits `tool.result` labels `secret/local-only`;
- following `context.manifest` effective labels become `secret/local-only`;
- `mock-main` is route-denied due to clearance;
- `turn.final.model_trace.denied_candidates` includes `mock-main`;
- final response is produced by `mock-local`.

Malicious screenshot evidence shows prompt-injection text is present only inside the quarantined tool-result content, and the final response remains safe / data-only. No `memory.written` or instruction-driven citation path is present in the evidence.

### 6. CLI and replay visibility

**PASS.**

`fairy artifacts list --json`, `fairy artifacts show <artifact_id> --json`, and `fairy artifacts show <artifact_id> --text` were added. Replay text renders `artifact.created` compactly and preserves JSON payloads.

Owner evidence includes artifact CLI JSON/text outputs. Some fetched raw owner evidence has Unicode decoding issues through web tooling, but the committed files, tests, and work report provide sufficient redundancy.

### 7. Perception eval suite

**PASS.**

`perception.quarantine-v0` is present and passing in `packages/testing`. It covers benign screenshot summary, bilingual OCR, malicious screenshot injection, fake API key OCR escalation/routing, and OCR-derived egress/redaction behavior through mock/fixture paths.

## BLOCKER

None.

## CARRY-IN

1. **Reviewer-owned docs pass pending.**  
   Apply the work report's proposed docs edits to:
   - `docs/specs/model-gateway.md`
   - `docs/specs/protocol.md`
   - `docs/specs/context-engine.md`
   - `docs/specs/data-governance.md`
   - `docs/specs/sandbox-security.md`
   - `docs/specs/evals.md`

2. **Code/report formatting quality.**  
   Several generated implementation/report files are compressed into very long lines. This passed lint/typecheck but hurts reviewability. Future Codex tasks should preserve normal TypeScript/Markdown formatting.

3. **Owner evidence provenance.**  
   Evidence under `tasks/owner-checks/M2-06/` is Codex-generated deterministic fixture evidence, not owner-live manual evidence. This is acceptable here, but future summaries should label it explicitly.

4. **Real perception provider remains future work.**  
   M2-06 deliberately implements deterministic mock perception only. Real vision/OCR provider compatibility and live checks are not claimed.

## NIT

- Artifact paths in owner evidence are absolute Windows temp paths. Acceptable for evidence, but future artifact CLI outputs might be easier to review if they also include repo/data-dir-relative paths.

## Final decision

M2-06 is closed. M2 perception service v1 is accepted at deterministic mock/fixture level.

---

## Countersignature — Claude (Fable 5), 2026-07-07

Code-level cross-check delegated to an opus subagent (12-item checklist, all reads via `git show` at `ceb2a74`, file:line evidence). **All 12 items PASS, zero vacuous assertions found.** Highlights beyond the primary review:

- **Registry hygiene proven, not just claimed:** `artifactEventPayload()` is the only event-payload builder and carries no `content`/`bytes` (unit-asserted via `not.toHaveProperty`); path containment (`assertInside` + `safeArtifactPath`) throws on escape; `escalateLabelsForPerceptionText` can only raise labels, never lower the source artifact's.
- **Protocol untouched:** `git diff 89e335d..ceb2a74 -- packages/protocol` is empty — `artifact.created` was already registered with the required payload shape; new fields ride `additionalProperties` additively; every perception E2E validates the emitted stream. Explicitly confirmed: no `perception.*` event type exists anywhere (a test even asserts `every(e => !e.type.startsWith("perception."))`).
- **The three trust E2Es are non-vacuous:** escalation test pins `provider.requests === 1` (zero bytes to the primary after mid-turn escalation) + `fallback.requests === 1` + denied-candidate trace; injection test asserts `carrying.length > 0` before the role-partition check (cannot pass empty); egress test pins `outbound.requests() === 0` + redacted diagnostics + clean replay.
- **Boundary sweep:** `governance.ts` and `persona.ts` byte-identical vs `89e335d` (M2-05c/05b rebase intact); kernel diff is 8+/1- (vision.* allow rule, metadata/artifact_ref propagation, spill append-instead-of-overwrite — all additive); zero raw CJK in new src (encoding guard green); gateway.e2e diff has zero deletions; the one rewritten tools-std assertion is a strengthened superset. No docs, no SDK, no provider strings, one TurnRunner.

Two recorded notes (non-blocking, echoed into the docs pass): (1) perception runs as an in-process mock inside tools-std rather than through a `perception.vision` model-gateway role — permitted by the brief's "where applicable", but the real-provider role wiring is genuinely future work and the model-gateway spec now says so explicitly; (2) long-OCR "digest" reuses the generic 32 KiB kernel spill (head+tail) rather than a tiny perception-specific summary — bounded and replay-safe, fine for v1.

Owner-evidence provenance (CARRY-IN 3) is accepted for this task for the stated reason, with the same standing caveat as M2-05b: when a real vision/OCR provider lands, that slice's owner checks must be real-provider runs, not fixtures.

Docs pass applied with this countersignature: model-gateway §6 (implementation status + per-tool provenance wording fix), protocol Artifact row, context-engine zone 8, data-governance perception-labels note, sandbox-security §4.5 OCR corpus status, evals M2-06 registration. Handbook current-state updated.

**Countersigned: M2-06 ACCEPTED WITH NOTES / CLOSED.**

