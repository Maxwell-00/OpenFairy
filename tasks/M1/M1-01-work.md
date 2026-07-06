完成了 M1-01 纵切：model-gateway、唯一 TurnRunner、gateway resume/cancel、CLI chat/sessions、mock provider 和 e2e 都接上了。没有改 `docs/`。

**1. File Tree Delta**

- 新增/实现：`packages/model-gateway/src/*` raw HTTP + SSE OpenAI-compatible transport。
- 新增/实现：[TurnRunner](E:/Claude_Projects/Projects/Fairy/OpenFairy/packages/kernel/src/index.ts)。
- 替换 gateway echo：删除 `apps/gateway/src/dev/echo-responder.ts`，重写 [server.ts](E:/Claude_Projects/Projects/Fairy/OpenFairy/apps/gateway/src/server.ts)。
- 新增 CLI：[chat.ts](E:/Claude_Projects/Projects/Fairy/OpenFairy/apps/cli/src/chat.ts)，支持 `fairy chat` / `fairy sessions`。
- 新增 mock provider：[mock-openai.ts](E:/Claude_Projects/Projects/Fairy/OpenFairy/packages/testing/src/mock-openai.ts)。
- 更新 M1 e2e：[gateway.e2e.test.ts](E:/Claude_Projects/Projects/Fairy/OpenFairy/packages/testing/test/gateway.e2e.test.ts)。
- 配置更新：`kernel.system_prompt`、`gateway.watchdog_s`，并收紧 model schema。
- 注意：工作树里有一个空的未跟踪 `tasks/M1-01-work.md`，我没有使用或写入它。

**2. Verification Tails**

- `pnpm install --frozen-lockfile --config.confirm-modules-purge=false`：Already up to date。
- `pnpm -r typecheck`：全部通过。
- `pnpm -r test`：全部通过；包含 gateway M1 e2e 3 条。
- `pnpm lint`：通过，0 warnings。
- `pnpm dep-check`：通过，`no dependency violations found`。
- `git grep -l "runDevEchoResponder"`：无结果。
- `git grep -l "echo-responder" -- ':!tasks'`：无结果。精确 `git grep -l "echo-responder"` 仍命中 task brief 自身，这是任务文件文本残留，不是代码引用。
- 本机已跑 Windows 环境；Ubuntu matrix 需要 CI 实际确认。

**3. Decisions Made**

- SSE 选择手写解析，没有加 `eventsource-parser`，也没有引入 OpenAI SDK。
- `secret://` 仍只在 model transport 内解析。
- Clearance check 只记录到 `turn.final.payload.model_trace`，不阻断。
- `turn.cancel`：有 active turn 时只发 canonical `turn.interrupted`；无 active turn 时发 no-op raw ack。
- `/sessions` 使用 gateway 同一 token auth。
- 新 config keys：`kernel.system_prompt`、`gateway.watchdog_s`。
- Schema 收紧：`models[].base_url` 和 `models[].data_clearance` 必填。

**4. Spec Ambiguities Found**

- `session.attach` 未在 `protocol.md` §7 正式列 op。
- `turn.cancel` 的 “ack only” 没有 canonical event 类型。
- `session.attach` replay 完成没有 sentinel，CLI 只能边回放边可输入。
- `/sessions` 是否需要 auth 未写明。
- acceptance 的 exact grep 会命中 `tasks/*.md` brief。

**5. Proposed Doc Edits**

- `docs/specs/protocol.md` §7：补 `session.attach {op,sid,replay_from?}`、`/sessions`、cancel ack 语义。
- `docs/ARCHITECTURE.md` §7/§10：补 gateway session resume、new config keys。
- `docs/specs/model-gateway.md`：注明 v0 trace-only clearance 和 hand-rolled SSE。
- reviewer 应用英文 docs 后，`docs-zh/` 需要 owner 重新同步翻译。

**6. Real Provider Transcript**
未跑真实 provider：当前没有可用 endpoint/key 配置，我没有伪造 transcript。Mock e2e 已验证流式对话、usage、restart resume 和 cancel。