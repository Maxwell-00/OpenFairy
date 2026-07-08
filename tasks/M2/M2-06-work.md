# M2-06 Work Report - Perception Service v1

## 1. File tree delta

Added:

- `packages/perception/` - artifact registry, deterministic mock perception provider, fixtures, unit tests.
- `apps/cli/src/artifacts.ts` and `apps/cli/test/artifacts.test.ts` - `fairy artifacts` CLI.
- `tasks/owner-checks/M2-06/` - local owner-check evidence.

Changed:

- `packages/tools-std/src/index.ts` - registered `vision.describe` / `vision.ocr`, perception artifact side events, quarantined tool output.
- `packages/kernel/src/index.ts` - default `vision.*` allow rule; tool result metadata/artifact refs are preserved additively.
- `packages/config/defaults.yaml` - default `vision.*` allow rule so gateway configs do not prompt for M2 perception tools.
- `apps/gateway/src/server.ts` - artifact content parts are rendered as compact prompt refs and artifact labels join turn labels before route clearance.
- `apps/cli/src/replay.ts` - compact text rendering for `artifact.created`.
- `packages/testing/test/gateway.e2e.test.ts` - named `perception.quarantine-v0` gateway E2E suite.
- `packages/testing/src/mock-client.ts` - test client content type accepts artifact parts already allowed by protocol.

No `docs/` or `docs-zh/` files were edited.

## 2. Verification tails

Local commands:

- `pnpm install --offline --trust-lockfile` - pass. Plain `pnpm install` attempted network trust/attestation checks in the sandbox; local verification used the trusted lockfile/offline equivalent.
- `pnpm lint` - pass, encoding guard passed.
- `pnpm -r typecheck` - pass.
- `pnpm -r test` - pass.
- `pnpm dep-check` - pass, no dependency violations.
- `pnpm conformance` - pass, mock conformance `ok: true`.
- `git diff --check` - pass.
- `git diff --name-only -- docs docs-zh` - no output.

Named eval/suite visibility:

- `perception.quarantine-v0` appears under `packages/testing/test/gateway.e2e.test.ts`.
- Existing named suites remain visible: `injection.research-v0`, `persona.consistency`, `substance.invariance`, `label.conformance`, `governance.friction-canary`, memory leakage/deletion suites.

CI:

- Not run from this environment. Expected to remain secret-free and mock-only.

## 3. Decisions

Artifact storage:

- `ArtifactRegistry` stores under `<dataDir>/artifacts`.
- Input artifacts go under `inputs/`; normalized perception outputs go under `perception/`.
- Artifact ids are content-addressed as `art_<sha256 first 20>`.
- Registry metadata is append-only JSONL at `artifacts.jsonl`.
- `artifact.created` payloads include hash, path, MIME, labels, origin, size, kind, optional filename and metadata. Blob bytes are never embedded.

Perception provider/mock shape:

- Added `MockPerceptionProvider` with deterministic `describe`, `ocr`, and `extractDocument`.
- Required fixtures exist: benign screenshot, malicious prompt-injection screenshot, fake API key image, bilingual zh/en image, simple document fixture.
- Added `long-ocr-image` fixture to exercise spillover.
- No vendor SDK and no cloud OCR/vision calls.

Tool semantics:

- Added `vision.describe(artifact_id_or_path, question?)`.
- Added `vision.ocr(artifact_id_or_path, region?)`.
- Tools run through the existing TurnRunner tool loop only.
- Tool provenance uses per-tool convention: `tool:vision.describe` and `tool:vision.ocr`.
- Inputs can be existing artifact ids/paths, workspace file paths, or deterministic `fixture:<key>` refs for tests.

Quarantine and labels:

- Perception/OCR text is returned only inside Fairy quarantine blocks.
- Tool result labels inherit artifact labels and escalate to `secret/local-only` when OCR text matches fake API key patterns.
- Original input artifact labels are not downgraded by OCR output escalation.
- Egress guard blocks OCR-derived fake API key outbound args before web fetch execution.

Context integration:

- Gateway artifact content parts render compact prompt blocks: ref, optional registered artifact id/path/hash, MIME, labels, provenance, short description, short OCR excerpt.
- Blob/base64/content fields are ignored by prompt rendering.
- Artifact labels join input labels before route clearance.
- Long OCR tool output spills through the existing artifact spillover path and is represented by artifact refs/head/tail in tool context.

CLI/replay:

- Added:
  - `fairy artifacts list --json`
  - `fairy artifacts show <artifact_id> --json`
  - `fairy artifacts show <artifact_id> --text`
- `show --text` wraps perception artifacts in quarantine.
- Replay text mode now renders `artifact.created` compactly; replay JSON preserves payloads while diagnostic events remain redacted by existing logic.

## 4. Spec ambiguities

- The brief says perception role binding can use model-gateway role semantics where applicable. M2-06 keeps perception deterministic and tool/subsystem-based; no model role call or second TurnRunner was added.
- The model-gateway spec wording mentions `tool:vision`; implementation follows established per-tool provenance (`tool:vision.describe` / `tool:vision.ocr`) to match `tool:research.*`.
- `artifact.created` already allowed additive payload fields. No schema change was necessary.
- Raw event logs may contain fake OCR strings inside quarantined `tool.result` payloads. Text replay and diagnostic JSON redaction prevent diagnostic leakage; artifact CLI is explicit local inspection.

## 5. Proposed docs edits

For reviewer application only:

- `docs/specs/model-gateway.md`
  - Mark Perception Service v1 implemented for deterministic mock provider.
  - Document `vision.describe` / `vision.ocr` as TurnRunner tools, not a second loop.
  - Clarify real provider boundary: no vendor SDK in M2; CI uses mock provider only.
  - Replace generic `provenance: tool:vision` wording with per-tool provenance `tool:vision.describe` / `tool:vision.ocr`.

- `docs/specs/protocol.md`
  - Note additive `artifact.created` perception fields: `artifact_id`, `kind`, `size_bytes`, `source_filename`, `metadata`.
  - Note replay text visibility for `artifact.created`.

- `docs/specs/context-engine.md`
  - Add artifact content part rendering shape.
  - Document that artifact labels join turn labels before route clearance.
  - Document long OCR spillover under tool-result/artifact accounting.

- `docs/specs/data-governance.md`
  - Add OCR/perception label inheritance and secret escalation behavior.
  - Note authenticated/private screenshot fixtures should use personal/local labels or stricter.

- `docs/specs/sandbox-security.md`
  - Add perception/OCR quarantine fixture status and injection firewall rule.
  - Clarify OCR text is data, never system/developer/user instruction.

- `docs/specs/evals.md`
  - Register deterministic PR-tier suite `perception.quarantine-v0`.
  - List coverage: benign describe, bilingual OCR, malicious screenshot injection, fake API key routing escalation, OCR-derived secret egress denial.

## 6. Manual owner checklist

Evidence directory:

- `tasks/owner-checks/M2-06/testing-perception.txt`
- `tasks/owner-checks/M2-06/vision-replay.jsonl`
- `tasks/owner-checks/M2-06/ocr-secret-routing-replay.jsonl`
- `tasks/owner-checks/M2-06/perception-injection-replay.jsonl`
- `tasks/owner-checks/M2-06/artifacts-list.json`
- `tasks/owner-checks/M2-06/artifact-show.json`
- `tasks/owner-checks/M2-06/artifact-show.txt`

Suggested owner commands:

```powershell
pnpm --filter @fairy/testing test -- --reporter=verbose
pnpm fairy artifacts list --json
pnpm fairy artifacts show <artifact_id> --json
pnpm fairy artifacts show <artifact_id> --text
```

Expected:

- `perception.quarantine-v0` appears and passes.
- Replay logs include `tool.call vision.describe`, `tool.call vision.ocr`, `tool.result`, and `artifact.created`.
- OCR fake API key escalates to `secret/local-only`; under-cleared primary is not called after escalation; local fallback completes when configured.
- Malicious OCR text appears only in quarantined tool-result/tool-role content.
- Artifact CLI JSON is parseable; text mode marks perception content as quarantined.
