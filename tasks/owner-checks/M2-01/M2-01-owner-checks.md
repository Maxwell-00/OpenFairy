\# M2-01 Owner Manual Checks



Date: 2026-07-04

Repo: Maxwell-00/OpenFairy

Commit: ab08485



\## 1. DeepSeek live conformance



Evidence:



\- `tasks/owner-checks/M2-01/deepseek-conformance.txt`



Observed:



\- live streaming shape: PASS

\- live trivial tool-call shape: PASS

\- final JSON ok: true



Verdict: PASS



\## 2. Ollama live conformance



Evidence:



\- `tasks/owner-checks/M2-01/ollama-conformance.txt`



Observed:



\- live streaming shape: PASS

\- live trivial tool-call shape: PASS

\- final JSON ok: true



Verdict: PASS



\## 3. Secret route-denied check



Session:



\- `ses_01KWNN97BM791M2HS9R775K2SV`



Evidence:



\- `tasks/owner-checks/M2-01/route-deny-replay.jsonl`



Observed:



\- route.denied present: YES

\- denied\_candidates visible: YES

\- turn.final model\_trace.denied\_candidates visible: YES

\- provider/network error absent: YES



Verdict: PASS



\## 4. Safe remember check



Input:




remember that my favorite shell is pwsh

Session:



-`ses_01KWNNTC4KANKK5VAE4W0QRJDS`



Evidence:



tasks/owner-checks/M2-01/memory-safe-replay.jsonl



Observed:



memory.gate.decision present: YES

decision allow: YES

memory.written present: YES



Verdict: PASS



5\. Fake API-key remember check



Input:



remember that my API key is sk\_test\_1234567890abcdef



Session:



-`ses\_01KWNP0JGD3HXWD5GT5DA11GYT`



Evidence:



tasks/owner-checks/M2-01/memory-secret-replay.jsonl



Observed:



memory.gate.decision present: YES

decision deny: YES

memory.written absent: YES



Verdict: PASS



Overall



M2-01 owner manual checks: PASS



Notes:



No real API key was pasted into chat.

Real DeepSeek key was only supplied via local environment variable.

Replay JSON evidence is stored under tasks/owner-checks/M2-01/.

