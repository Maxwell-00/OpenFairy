已按 `M1-02-tools-permissions.md` 推进完成，当前改动保持在代码/测试/锁文件内，没有改 `docs/`。核心内容：工具调用原生化、TurnRunner 工具循环、权限审批与审计、标准工具包、CLI 审批/audit、session resume sentinel，以及对应 mock/e2e 覆盖都已落地。

**File Tree Delta**

```
apps/cli/src/bin/fairy.ts
apps/cli/src/chat.ts
apps/cli/src/index.ts
apps/gateway/package.json
apps/gateway/src/bin/gateway.ts
apps/gateway/src/config.ts
apps/gateway/src/server.ts
packages/config/defaults.yaml
packages/config/src/schema.ts
packages/kernel/package.json
packages/kernel/src/index.ts
packages/kernel/test/index.test.ts
packages/model-gateway/src/gateway.ts
packages/model-gateway/src/index.ts
packages/model-gateway/src/openai-chat.ts
packages/model-gateway/src/types.ts
packages/model-gateway/test/index.test.ts
packages/testing/src/index.ts
packages/testing/src/mock-client.ts
packages/testing/src/mock-openai.ts
packages/testing/test/gateway.e2e.test.ts
packages/tools-std/package.json
packages/tools-std/src/index.ts
packages/tools-std/test/index.test.ts
pnpm-lock.yaml
```

**Verification Tails**
本机 Windows/PowerShell 已通过：

```
pnpm install --frozen-lockfile -> Already up to date
pnpm lint -> eslint . --max-warnings=0
pnpm -r typecheck -> all checked packages Done
pnpm -r test -> testing 8 passed; model-gateway 9 passed; kernel 3 passed
pnpm dep-check -> no dependency violations found
```

`packages/kernel` 测试会出现 Node `node:sqlite` ExperimentalWarning，这是预期的运行时提示。
Ubuntu CI 我这里不能直接启动远端 runner，所以未声称已跑；Docker 缺失环境会 `skipIf(!hasDocker())` 干净跳过。本机 Docker 可用，`shell.run` approval e2e 包含在 `packages/testing` 的 `8 passed` 里，未跳过。

**Decisions**
M1-02 配置键已接入：

- `kernel.max_tool_iterations`: 默认 `16`，超限输出 `finish_reason: "tool-limit"`。
- `permissions.ask_timeout_s`: 默认 `300` 秒。
- `permissions.rules`: first-match；默认 `fs.* allow`、`shell.run ask`、`web.* allow`、`* ask`。
- `workspace.root`: 默认 gateway 启动 cwd。
- `search.engine.kind`: 默认 `mock`；支持 `searx`、`brave`，Brave key 走 `secret://` 边界解析。
- `sandbox.image`: 默认 `node:22-slim`。
- `sandbox.timeout_s`: 默认 `120`。
- `sandbox.default_profile`: 默认 `safe`；`shell.run` v1 暴露 `safe/dev`，无 Docker 时不注册工具。
- 审计写入 `<data_dir>/core.db`，artifacts 写入 `<data_dir>/artifacts`。

还确认了 `rg "class TurnRunner" packages apps` 只有一个 `TurnRunner`。

**Spec Ambiguities**

- `approval.resolve` 使用 `approval.request` envelope 的 `id` 作为 request id；schema 里没有单独 payload 字段。
- `tool.result` envelope provenance 仍为 `agent`，真实来源放在 payload 的 `provenance`，如 `tool:*` / `web:*`。
- provider 先发工具名、后发参数片段时，空 arguments 不再立即视为 `{}`，会等后续片段或流结束。
- `/meta` 当前只公开 capabilities，不在未鉴权 endpoint 暴露完整工具定义/权限规则。

**Proposed Doc Edits**

- `docs/specs/model-gateway.md`: 补充 name-only/empty-arguments tool-call delta 的完成规则。
- `docs/specs/protocol.md`: 明确 `approval.resolve.request_id` 指向 `approval.request` envelope id。
- `docs/specs/sandbox-security.md`: 写明 Docker CLI 不存在时 `shell.run` 不注册，Windows CI 可跳过。
- `docs/ARCHITECTURE.md` 或 config spec: 补 M1-02 新配置键与默认权限策略。

**Real Provider**
未跑 real-provider transcript：本轮没有提供真实 endpoint/key，我也没有去探测或读取用户 secret 配置。Mock approval flow 已覆盖：

```
approval.request(shell.run printf first)
approval.resolve(session)
approval.resolved(session)
tool.call/tool.result call_shell_1 ok
tool.call/tool.result call_shell_2 ok   # session grant, no second approval
turn.final "shell complete"
```