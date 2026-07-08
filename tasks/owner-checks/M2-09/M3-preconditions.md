# M3 preconditions

Date: 2026-07-08

## Hard preconditions before M3 voice

- Fable/Opus must gate `tasks/M2-exit-review.md` and explicitly accept or reject the M2 deferral register.
- M2-09 evidence must be committed, pushed, and green on ubuntu-latest and windows-latest.
- `git diff --name-only -- docs docs-zh` must remain empty for the M2-09 closeout unless a reviewer explicitly requests docs edits.
- Voice work must preserve the existing invariants: one TurnRunner, event-sourced JSONL sessions as source of truth, source-first TypeScript execution, raw HTTP/SSE model transport, no vendor SDK, and mock-only CI.
- No M3 slice should rely on activated learned skills, scheduler/workflows, vector retrieval, or real provider keys in CI.

## M2 deferrals that may block voice under strict ROADMAP interpretation

- S4 memory continuity after >=20 intervening sessions.
- Persona frozen style-judge >=90%.
- sqlite-vec vs LanceDB >=200k benchmark.

If the reviewer requires literal closure of those ROADMAP criteria, run focused closeout tasks before M3.

## Deferrals that can safely carry to M4/M5 if accepted by reviewer

- Full memory canary benchmark and model-backed consolidation.
- Full contradiction/promotion/decay/index-maintenance behavior.
- Governance friction canary nightly/soak threshold on real workloads.
- Vector backend implementation and large benchmark, if explicitly moved to M3-prep/M5-hardening.
- Autonomous scheduler/workflows and dream-cycle automation.
- Full M4/S7 automation beyond the M2-06 screenshot/perception v0 flow.
- Learned-skill activation.

## Recommended first M3 slice shape

Suggested first brief title:

```text
M3-01 - voice protocol + loopback audio transport skeleton
```

Recommended boundaries:

- Define the minimal voice protocol/events and local loopback audio path needed for deterministic tests.
- Keep CI mock-only and secret-free.
- Avoid real ASR/TTS provider dependencies in the first slice.
- Keep interruption/barge-in quality benchmarks as later M3 tasks unless the brief explicitly expands.
- Do not introduce scheduler/workflow/proactivity scope while opening voice.
