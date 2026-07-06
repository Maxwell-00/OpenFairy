\# M2-03 Owner Manual Checks



Date: 2026-07-06

Repo: Maxwell-00/OpenFairy

Commit: cab4c28

CI: GitHub Actions #40 Success, ubuntu + windows matrix green



\## 1. Named research/eval suites



Evidence:



\- `tasks/owner-checks/M2-03/testing-research-evals.txt`



Observed:



\- research.citation-precision: PASS

\- research.zh-en-parity: PASS

\- injection.research-v0: PASS

\- gateway E2E `keeps research injection pages quarantined through the TurnRunner tool loop`: PASS

\- memory.leakage: PASS

\- memory.deletion-permanence: PASS



Verdict: PASS



\## 2. Research package



Evidence:



\- `tasks/owner-checks/M2-03/research-package-test.txt`



Observed:



\- deterministic planning: PASS

\- zh/en planning: PASS

\- snapshot/cache/canonicalization/source grading/citation mechanics: PASS

\- no real network: PASS



Verdict: PASS



\## 3. Research tool namespace



Evidence:



\- `tasks/owner-checks/M2-03/tools-std-research-test.txt`



Observed:



\- research.plan/search/fetch/cite/sources tool behavior: PASS

\- quarantined fetched content: PASS

\- no unsafe instruction treatment: PASS



Verdict: PASS



\## 4. CLI and replay visibility



Evidence:



\- `tasks/owner-checks/M2-03/cli-research-test.txt`



Observed:



\- research CLI JSON commands: PASS

\- snapshot/citation/source-set replay rendering: PASS



Verdict: PASS



\## Overall



M2-03 owner manual checks: PASS / FAIL



Notes:



\- No real public web calls were used.

\- No real API keys were used.

\- Evidence is deterministic mock/fixture based.

