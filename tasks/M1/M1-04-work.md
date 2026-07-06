已按 `M1-04-conformance-fallback.md` 推进完成。核心变更包括：

1. File Tree Delta
   - `packages/model-gateway`: 增加 `capabilities.tools`、role fallback chain、prompted-tools parser/repair、wire-name codec export、fallback trace/progress。
   - `packages/protocol`: 新增 raw transport frame schema/fixtures：`ack`、`op-error`，未加入 event registry。
   - `apps/gateway`: 全部 WS client ops 统一 ack/op-error frame；session facts 仍发 envelope。
   - `packages/testing`: 新增 conformance kit v1 + CLI：`packages/testing/src/bin/conformance.ts`；增强 mock provider/client；补 fallback/prompted/op-frame e2e。
   - `packages/tools-std`: fs 工具改为 realpath-aware，新增 symlink escape / Docker sandbox mini-suite。
   - `package.json`: 新增 `conformance` script。
2. Verification
   - `pnpm install --config.store-dir=E:\.pnpm-store --config.confirm-modules-purge=false`: passed.
   - Direct ESLint equivalent: `eslint . --max-warnings=0`: passed.
   - Direct all-package typecheck: passed for all `packages/*` and `apps/*`.
   - Direct all tests: `16 passed`, `162 passed | 3 skipped`.
   - `depcruise --config .dependency-cruiser.cjs packages apps`: no violations.
   - Mock conformance: all 18 cases PASS.
   - Windows note: Docker/Unix sandbox mini-suite had 3 skipped locally; intended for Ubuntu/Docker CI.

`pnpm lint` / `pnpm run lint` 本机仍会卡在 pnpm 自己的 `Recreating node_modules` 阶段；我恢复了链接层后用本地 `.bin` 等价命令完成验证。代码验证本身是绿的。

1. Decisions

   - `models[].capabilities.tools`: default `native`; `prompted` 注入 system-zone grammar；`none` 对 `main` role 启动期拒绝。
   - fallback 只在候选切换边界发生；有下一候选时先缓冲，避免 A 半截流和 B 混流；无 fallback/最后候选保持流式。
   - fallback 可见性：`progress.update` payload `{stage:"model-fallback", from, to, reason, detail}`，最终 `turn.final.payload.model_trace` 记录 `model_id/fallbacks`。
   - prompted parser 容忍 fenced/prose JSON、CJK 标点、单引号；schema 校验；最多 2 次 repair。

2. Spec Ambiguities

   - 任务写 “surfacing `ToolError`”，但 `model-gateway` 不能依赖 `tools-std`；当前 repair exhaustion 以 non-retryable `ProviderError` 进入 canonical `error` envelope。
   - “tool-requiring roles” 目前只有 `main` 可确定；其他 role 还没有声明式 tool requirement 字段。

3. Proposed Doc Edits

   - ```
     docs/specs/protocol.md §7
     ```

     : 明确 frame shapes：

     - `{kind:"ack", op, ...}`
     - `{kind:"op-error", op, message, ...}`

   - `docs/specs/model-gateway.md`: 记录 `capabilities.tools` 默认值、fallback trace/progress payload、prompted parser tolerances。

   - Ollama note: live config 示例可写 `base_url: http://127.0.0.1:11434/v1`，API key 可空/ dummy；具体 quirks 待 owner live conformance capture。

4. Live Conformance

   - DeepSeek/Ollama live conformance 未在本机运行：没有 live endpoint/secrets，也不应在 CI 跑。
   - Mock verdict已通过；owner 可运行：
     - `pnpm conformance --model <deepseek-id>`
     - `pnpm conformance --model <ollama-id>`