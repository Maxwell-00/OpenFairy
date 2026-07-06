已按 `M1-03-context-ladder-replay.md` 推进完成。核心落点：新增 `context.manifest` 协议事件、kernel context engine/L1-L3 prompt-time reduction、CJK-aware token estimator、`fairy replay` 离线 inspector、audit query e2e、长会话 context/replay e2e。

**1. File Tree Delta**

Modified:

```
apps/cli/src/bin/fairy.ts
apps/cli/src/index.ts
apps/gateway/src/config.ts
apps/gateway/src/server.ts
packages/config/defaults.yaml
packages/config/src/schema.ts
packages/kernel/src/index.ts
packages/kernel/test/index.test.ts
packages/model-gateway/src/config.ts
packages/model-gateway/src/gateway.ts
packages/model-gateway/src/index.ts
packages/model-gateway/src/openai-chat.ts
packages/model-gateway/src/types.ts
packages/model-gateway/test/index.test.ts
packages/protocol/schemas/registry.v1.json
packages/protocol/test/conformance.test.ts
packages/testing/src/mock-client.ts
packages/testing/test/gateway.e2e.test.ts
packages/testing/test/index.test.ts
```

Added:

```
apps/cli/src/replay.ts
apps/cli/test/replay.test.ts
packages/kernel/src/context.ts
packages/kernel/test/context.test.ts
packages/model-gateway/src/tokens.ts
packages/protocol/fixtures/context.manifest.valid.json
packages/protocol/fixtures/context.manifest.invalid.json
packages/protocol/schemas/context.manifest.v1.json
```

**2. Verification Tails**

Windows local:

```
pnpm -r typecheck -> all packages Done
pnpm -r test -> 12 packages green; testing 10 passed; kernel 5 passed
pnpm lint -> eslint . --max-warnings=0
pnpm dep-check -> no dependency violations found
rg "class TurnRunner" packages apps -n -> exactly one
git diff -- docs -> empty
```

`pnpm install --frozen-lockfile` passed earlier in this turn. A final rerun failed opening the pnpm store SQLite index, and the required escalation retry was blocked by the outer usage-limit reviewer, so I’m not going to pretend that last install check completed. No dependency or lockfile change was made for M1-03.

Ubuntu CI was not run locally.

**3. Decisions**

Config keys added:

```
context.reduce_at: default 0.8
context.output_reserve: default model.max_output, else 4096
context.min_recent_turns: default 4
models[].context_window: default 128000
models[].max_output: optional
```

Manifest shape:

```
zones, budget, window, output_reserve, projected_tokens,
reduction_stages_applied, prefix_hash, model
```

Ladder:

```
L1 = existing 32 KiB tool spillover/artifact refs
L2 = old tool-result bodies -> digest/artifact ref
L3 = old assistant/tool bodies -> explicit placeholder
```

User messages survive L3 verbatim; last `context.min_recent_turns` turns are protected. `context.manifest` is emitted before each model call and never fed back into prompt history.

**4. Spec Ambiguities**

- I accepted `context_window` / `max_output` both as top-level model fields and under `capabilities`, defaulting if absent.
- Current-turn tool messages are serialized after current input but counted in the history zone for the manifest.
- L1 appears in manifests when artifact-spilled tool results are present in assembled context, since the spill happens at ingest time.

**5. Proposed Doc Edits**

- `docs/specs/context-engine.md`: define M1-03 exact `context.manifest` payload fields.
- `docs/ARCHITECTURE.md`: add `context.*`, `models[].context_window`, `models[].max_output`.
- `docs/specs/protocol.md`: note `context.manifest` is observational and excluded from prompt history.
- CLI docs: add `fairy replay <sid>`, `--manifests`, `--turn`, `--json`, `--data-dir`.

**6. Replay Sample**

From the long-conversation e2e:

```
turn model projected/budget/window stages system tools history input prefix
1 mock-model 599/350/700 - 34 435 1 9 sha256:fa9bcecb5e4aa042
1 mock-model 9035/350/700 L1 34 435 8437 9 sha256:fa9bcecb5e4aa042
2 mock-model 9548/350/700 L1 34 435 8953 6 sha256:fa9bcecb5e4aa042
3 mock-model 1169/350/700 L1,L2,L3 34 435 576 4 sha256:fa9bcecb5e4aa042
```