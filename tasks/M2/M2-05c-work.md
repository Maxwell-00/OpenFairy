# M2-05c Work Report

## 1. File tree delta

- `package.json`
- `scripts/check-encoding.mjs`
- `packages/kernel/src/governance.ts`
- `packages/kernel/src/persona.ts`
- `packages/kernel/test/index.test.ts`
- `packages/kernel/test/persona.test.ts`
- `packages/research/src/index.ts`
- `packages/research/test/index.test.ts`
- `tasks/owner-checks/M2-05c/otp-check.txt`
- `tasks/owner-checks/M2-05c/lint.txt`
- `tasks/owner-checks/M2-05c/kernel-tests.txt`

No `docs/` or `docs-zh/` files were edited.

## 2. Verification tails

Local verification completed on Windows from the source-first TS workspace.

```text
pnpm install
pnpm lint
pnpm -r typecheck
pnpm -r test
pnpm dep-check
pnpm conformance
git diff --check
git diff --name-only -- docs docs-zh
node -e "const s=require('fs').readFileSync('packages/kernel/src/governance.ts','utf8');const tw='\\u9a57\\u8b49\\u78bc';const closed=(s.split(tw+')').length-1);const open=s.includes(tw+'|');if(closed!==4||open){console.error('FAIL: OTP alternation not clean; closed='+closed+', trailing-pipe='+open);process.exit(1)}console.log('PASS: OTP anchor alternation clean (4/4)')"
pnpm --filter @fairy/kernel test -- --reporter=verbose
pnpm --filter @fairy/research test -- --reporter=verbose
```

Result:

```text
pnpm install: pass; lockfile already up to date
pnpm lint: pass; Encoding guard passed (218 files scanned), then eslint passed
pnpm -r typecheck: pass
pnpm -r test: pass
pnpm dep-check: pass, no dependency violations found
pnpm conformance: pass, mock mode ok true, 18/18 cases passed
git diff --check: pass
git diff --name-only -- docs docs-zh: no output
OTP alternation check: PASS: OTP anchor alternation clean (4/4)
pnpm --filter @fairy/kernel test -- --reporter=verbose: pass, 4 files / 31 tests
pnpm --filter @fairy/research test -- --reporter=verbose: pass, 1 file / 21 tests
```

Temporary negative guard demonstration:

```text
Created packages/kernel/test/encoding-guard-fixture.test.ts with the blocklisted fragment encoded from codepoints.
pnpm lint failed at scripts/check-encoding.mjs:
Encoding guard failed:
- packages/kernel/test/encoding-guard-fixture.test.ts:1:21: blocklisted mojibake fragment otp-mojibake-yanzhengma
Removed the temporary fixture and confirmed it no longer exists.
```

CI status: not pushed from this workspace, so GitHub Actions status is pending owner push.

## 3. Decisions

- Runtime regex CJK anchors are ASCII source escapes. Converted the enumerated CJK alternatives in `governance.ts`, `persona.ts`, and the four research planner heuristic regexes to source-level `\uXXXX`.
- OTP mojibake removal deleted only the fourth damaged alternative `\u6960\u5c83\u7609\u942e\u4e63` from all four OTP regexes.
- OTP anchor stabilization keeps English word-boundary behavior on the English anchor group and lets the two CJK anchors stand without `\b`, because JavaScript `\b` does not create a useful boundary around CJK characters. Bare 4-8 digit values and near-miss Chinese port/amount strings remain non-matches.
- Comments beside converted runtime regexes are ASCII-only English glosses; no raw CJK comments were added.
- Research fixture body/title data strings and generated Chinese subquery template strings were left readable and raw, per brief.
- Guard wiring: root `pnpm lint` now runs `node scripts/check-encoding.mjs && eslint . --max-warnings=0`, so CI picks it up without workflow edits.
- Guard scan scope is limited to `packages/**/src/**/*.ts`, `packages/**/test/**/*.ts`, `apps/**/src/**/*.ts`, `apps/**/test/**/*.ts`, and `packages/protocol/{schemas,fixtures}/**/*.json`. It does not scan `docs/`, `docs-zh/`, `tasks/`, or owner-check evidence.
- Guard blocklist contents:
  - `\u6960\u5c83\u7609\u942e\u4e63` (`otp-mojibake-yanzhengma`)
  - `\u59a4\u72b2\u77c1` (`legacy-invalid-mojibake-check-a`)
  - `\u9426\u5910\u60cd\u6d94` (`legacy-invalid-mojibake-check-b`)
- Guard also fails on `U+FFFD` and NUL bytes/characters. Raw CJK itself is not banned.

## 4. Spec ambiguities

- The brief says semantic invariance is mandatory, but also requires `\u9a8c\u8bc1\u7801 123456` and `\u9a57\u8b49\u78bc 123456` to trigger. The previous regex shape wrapped CJK anchors in `\b`, which JavaScript does not treat as a CJK word boundary, so those required cases did not trigger. I treated the acceptance test as clarifying intended semantics and changed only the boundary placement: English anchors still use `\b`; CJK anchors remain explicit context anchors.
- The fail-closed OTP check did not need a count adjustment. I used the provided ASCII command exactly; the source now contains the literal escape text `\u9a57\u8b49\u78bc`, and all four regexes close the anchor group immediately after that term.
- `packages/kernel/src/governance.ts` still contains a raw CJK punctuation splitter outside the reviewer-enumerated deliverable lines. I left it unchanged because the task explicitly scoped runtime conversion to the OTP and health/finance/legal regexes in that file and forbids broad normalization.

## 5. Proposed docs edits

For reviewer application only; no `docs/` or `docs-zh/` files were edited.

`docs/specs/sandbox-security.md`:

- Add a one-line note near secret-pattern source guidance: "Secret-pattern runtime sources that include CJK anchors are encoded as ASCII `\uXXXX` escapes and checked by the CI encoding guard, which fails on U+FFFD, NUL bytes, and known mojibake fragments."

`docs/specs/persona-affect.md`:

- Note that deterministic CJK affect appraisal and banned-corpus regex anchors are stored as ASCII `\uXXXX` source escapes to avoid patch-anchor encoding drift.

`docs/specs/research.md`:

- Note that planner heuristic CJK regex anchors are ASCII-escaped in source while fixture/page data remains readable raw CJK.

## 6. Manual owner checklist

Evidence directory:

```powershell
New-Item -ItemType Directory -Force tasks/owner-checks/M2-05c
```

OTP fail-closed check:

```powershell
node -e "const s=require('fs').readFileSync('packages/kernel/src/governance.ts','utf8');const tw='\\u9a57\\u8b49\\u78bc';const closed=(s.split(tw+')').length-1);const open=s.includes(tw+'|');if(closed!==4||open){console.error('FAIL: OTP alternation not clean; closed='+closed+', trailing-pipe='+open);process.exit(1)}console.log('PASS: OTP anchor alternation clean (4/4)')"
```

Saved:

```text
tasks/owner-checks/M2-05c/otp-check.txt
```

Clean lint / encoding guard:

```powershell
pnpm lint
```

Saved:

```text
tasks/owner-checks/M2-05c/lint.txt
```

Kernel targeted regression tests:

```powershell
pnpm --filter @fairy/kernel test -- --reporter=verbose
```

Saved:

```text
tasks/owner-checks/M2-05c/kernel-tests.txt
```
