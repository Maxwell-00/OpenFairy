# sqlite-vec vs LanceDB decision gate note

Date: 2026-07-08

## Current status

MemoryStore v1 is a local SQLite projection over event-sourced session JSONL, with retrieval-side gating, tombstones, evidence pull-through, and FTS5-style text retrieval behavior. Vector retrieval remains deferred.

The M2 ROADMAP exit criterion names a decision gate: sqlite-vec vs LanceDB, backed by a benchmark at >=200k records.

## Benchmark evidence

No committed M2 evidence currently proves a >=200k-record sqlite-vec vs LanceDB benchmark.

No backend choice is claimed in this closeout. M2-09 is a consolidation task and did not implement a vector backend, vector index, benchmark harness, or provider integration.

## Recommendation

Primary recommendation: defer the benchmark to M3-prep or M5-hardening because M2 has no vector implementation and the deterministic M2 memory/research trust surface is already covered by SQLite/FTS-style projection, MemoryGate, citation, and leakage suites.

Reviewer alternative: if ROADMAP literal closure is required before M3, run a small design/benchmark task before starting voice. That task should still be secret-free, deterministic, and independent of runtime feature delivery.

## Deferred benchmark acceptance shape

A future benchmark should report at least:

- 200k synthetic memory records.
- Ingest time.
- Query p50 and p95.
- Disk size.
- Rebuild time from source JSONL/projection inputs.
- Windows local developer compatibility.
- Data-governance labels preserved through indexing and retrieval.
- No external managed service.
- Clear comparison between sqlite-vec and LanceDB under the same synthetic corpus/query set.

Until that evidence exists, the decision gate remains open and no backend should be selected by assertion.
