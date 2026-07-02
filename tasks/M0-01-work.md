已按新工作目录完成 M0-01，落在 `E:\Claude_Projects\Projects\Fairy\OpenFairy`。我也把一开始误生成在上一层 `Fairy` 的脚手架清掉了，只保留原有设计资料和新的 `OpenFairy` 仓库。

**File Tree**

```
OpenFairy/
  apps/cli, apps/gateway
  packages/{protocol,config,kernel,model-gateway,memory,research,orchestrator,tools-std,channels,testing}
  workers/speech
  extensions/{agents,skills,personas,workflows,hooks,mcp.d}
  docs/, tasks/, .github/workflows
  package.json, pnpm-workspace.yaml, tsconfig*.json, eslint.config.js
```

`packages/protocol/`:

```
src/{codec,ids,index,json,paths,registry,types,validation}.ts
schemas/registry.v1.json + 44 event schemas (*.v1.json)
fixtures/44 valid + 44 invalid fixtures + x.vendor.event.valid.json
test/conformance.test.ts
```

**Verification Tails**

```
pnpm install
Scope: all 13 workspace projects
Already up to date
Done in 1.3s using pnpm v11.7.0

pnpm -r typecheck
packages/testing typecheck: Done
apps/cli typecheck: Done

pnpm lint
$ eslint . --max-warnings=0

pnpm -r test
packages/protocol test: Tests 100 passed (100)
packages/testing test: Tests 1 passed (1)
apps/cli test: Tests 2 passed (2)

pnpm dep-check
✔ no dependency violations found (43 modules, 49 dependencies cruised)

pnpm doctor
Node: OK v24.14.1 (requires >=22)
pnpm: OK 11.7.0
Config: OK valid
Container runtime: yes (Docker version 29.5.3, build d1c06ef)
```

**Decisions Made**

- Pinned `packageManager` to `pnpm@11.7.0` to match the local runtime.
- Used `*.v1.json` schema filenames and full-envelope schemas, not payload-only schemas.
- Made registered event types payload-strict, while unknown well-formed future/extension events validate at envelope level.
- Picked `fairy.workspace.yaml` for workspace config because the spec names the layer but not the filename.
- Deep-merge config objects; arrays replace instead of merge.
- Copied the English docs/tasks/root guidance into `OpenFairy` because the new Git repo was otherwise empty; did not copy or edit `ChatGPT_Suggestions` or `docs-zh`.

**Spec Ambiguities Found**

- Most protocol event payload fields are not fully specified; I used minimal concrete schemas from notes/examples.
- `data-governance.md` says `region-restricted(<set>)`, while the envelope/task require a closed enum; implementation uses `region-restricted`.
- Unknown non-`x.*` future event tolerance is implied by evolution rules but not precisely scoped.
- `packages/testing` is listed as non-stub, but M0’s concrete conformance requirements fit naturally in `packages/protocol`; I added a minimal protocol manifest there.

**M0-02 Follow-Ups**

- Minimal gateway boot: config load, `/health`, `/meta`, protocol version.
- Mock client conformance: send `turn.input`, receive canonical event stream.
- Move reusable client conformance helpers into `packages/testing`.
- Decide and document user/workspace config file discovery before daemon boot grows real state.