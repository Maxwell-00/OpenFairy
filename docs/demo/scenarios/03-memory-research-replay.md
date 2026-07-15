# Scenario 3 — memory, research, and replay

Purpose: show bounded, non-sensitive state and canonical evidence using capabilities already in the repository.

1. In the Web UI or `pnpm fairy chat`, submit: “Remember that the demo theme is blue, then list the evidence you used.” This contains no owner data.
2. Explain the visible MemoryGate result honestly: personal material may be held for confirmation rather than silently persisted.
3. If deterministic/mock research is configured, ask for the existing bounded research demonstration and inspect its repository-owned evidence:

```powershell
pnpm fairy research sources --json
pnpm fairy research citations --json
```

4. Replay the session:

```powershell
pnpm fairy replay <session-id>
pnpm fairy replay <session-id> --json
```

Expected: canonical input/final events, bounded tool/governance evidence, and citations when the research fixture path was used. The deterministic/mock research path makes no public provider call. Do not claim hidden reasoning is available; replay contains canonical events and redacted diagnostics only.
