# OpenFairy v0.9 最短成品 + Subagents 增量扩展方案

**状态：** DRAFT FOR FABLE/OPUS PLAN GATE  
**基线：** M3-05 已关闭；v0.9 最短成品路线尚未开始实现  
**目标：** 先完成可求职展示的 v0.9，再以最小增量加入 Subagents-lite  
**核心判断：** 只要 v0.9 的 Plan/Loop 预留通用执行边界，后续加入 Subagents 不需要重写 TurnRunner、治理、JSONL、workflow 或 Web UI  
**版本定位：**
- `v0.9`：Portfolio Release
- `v0.9.1`：Subagents Extension
- `v1.0`：完整 M3/M4/M5

---

## 1. 总体结论

### 1.1 会不会需要重构

不会出现“推倒重来”式重构，但会有一次受控的中等规模抽取。

预期改动：

```text
已有 bounded-loop orchestrator
  -> 抽取通用 RunExecutor / ChildRunExecutor
  -> 增加 SubagentRegistry
  -> 增加 parent-child run linkage
  -> 增加 child budget / cancellation
```

不会改写：

- TurnRunner 核心模型/工具循环；
- MemoryGate；
- provider routing；
- tool permissions；
- JSONL source-of-truth；
- voice path；
- Web push-to-talk；
- MiniMax TTS；
- cloud ASR；
- artifact store；
- workflow checkpoint/replay；
- installer/doctor 主体。

### 1.2 预计工作量

如果 v0.9 按本计划的“subagent-ready”约束实现：

```text
Subagents-lite 增量：3–5 个专注工作日
```

如果 v0.9 的 Plan/Loop 写成单体、内存态、直接调用 main TurnRunner：

```text
Subagents 增量：7–12 个工作日，且会产生明显重构
```

因此，本方案要求在 v0.9 阶段增加少量通用边界，但不提前实现真正 subagent。

---

## 2. 版本路线

```text
v0.9
├─ R0.9-01  单一云端文件 ASR
├─ R0.9-02  localhost Web push-to-talk
├─ R0.9-03  Plan approval + bounded loop（subagent-ready）
├─ R0.9-04  Morning Briefing
├─ R0.9-05  Installer / doctor / onboarding
└─ R0.9-06  Portfolio Release Gate

v0.9.1
├─ SA-01  Subagent execution contract + registry
├─ SA-02  Research + Critic specialists
├─ SA-03  bounded parallel fan-out + synthesis
└─ SA-04  Subagents demo / owner evidence / release gate
```

Computer Use 不进入此主线；它保持 v0.9.2 或独立 stretch goal。

---

# 第一阶段：v0.9 Portfolio Release

## 3. R0.9-01 — 单一云端文件 ASR

### 目标

```text
完整音频 artifact
  -> 单一 cloud ASR
  -> speech.asr.final
  -> existing voice-to-turn
  -> TurnRunner
```

### 必须实现

- 一个云 ASR provider；
- `speech.providers` ASR variant；
- `speech.roles.asr`；
- provider clearance；
- audio egress；
- under-cleared zero bytes；
- input audio artifact；
- exactly one ASR final；
- exactly one TurnRunner turn；
- replay；
- owner real API check。

### 不做

- local ASR；
- streaming；
- partials；
- VAD；
- endpointing；
- multiple ASR providers；
- benchmark。

### Subagents 兼容性

无额外要求。ASR 结果仍只进入主会话 TurnRunner。

---

## 4. R0.9-02 — localhost Web push-to-talk

### 目标

```text
record
  -> stop
  -> upload complete blob
  -> cloud ASR
  -> TurnRunner
  -> MiniMax TTS
  -> browser playback
```

### 最小 UI

- new/open session；
- start recording；
- stop and send；
- status；
- transcript；
- assistant final；
- play / stop local playback；
- replay；
- error state。

### 不做

- live audio frames；
- partial transcript；
- VAD；
- barge-in；
- tray；
- provider-specific UI。

### Subagents 兼容性

UI 事件模型预留通用 execution tree 展示能力，但 v0.9 不显示 child agents。

建议 API 只暴露：

```text
execution_id
status
display_name
parent_execution_id?  // optional
```

v0.9 主 turn 的 `parent_execution_id` 为空。

---

## 5. R0.9-03 — Plan approval + bounded loop（subagent-ready）

这是避免未来重构的关键任务。

### 5.1 目标

```text
goal
  -> plan artifact
  -> approval
  -> bounded execution loop
  -> checkpoint
  -> resume / complete / budget stop
```

### 5.2 通用执行对象

不要把 workflow step 直接绑定为“只能运行主 Agent”。

定义通用执行上下文：

```ts
interface ExecutionContext {
  executionId: string;
  rootExecutionId: string;
  parentExecutionId?: string;
  sessionId: string;
  actorId: string;
  actorKind: "main" | "workflow";
  modelRole: string;
  toolPolicyId: string;
  memoryScopeId: string;
  budget: ExecutionBudget;
  deadlineMs: number;
  depth: number;
}
```

v0.9 只使用：

```text
actorKind = main | workflow
depth = 0
```

v0.9.1 加入：

```text
actorKind = subagent
depth = 1
```

不要在 v0.9 中实现 subagent，但字段和执行边界必须是通用的。

### 5.3 通用执行接口

建议建立：

```ts
interface RunExecutor {
  execute(
    request: ExecutionRequest,
    context: ExecutionContext,
    signal: AbortSignal,
  ): Promise<ExecutionResult>;
}
```

主执行器内部仍调用现有 TurnRunner。

要求：

- 不复制 TurnRunner；
- 不创建第二个 tool loop；
- workflow 只通过 `RunExecutor` 调用 TurnRunner；
- future subagent 复用同一接口。

### 5.4 Context isolation seam

Context assembler 必须接受显式 scope：

```text
session history scope
memory scope
workspace scope
tool result scope
parent supplied context
```

v0.9 main/workflow 可以继续使用当前 session scope。

不得在 orchestrator 中直接读取全局 session 并拼 prompt；应调用现有/通用 context assembly boundary。

### 5.5 Budget ledger

预算必须按 execution 记录：

```text
token budget
tool-call budget
iteration budget
wall-clock budget
optional cost budget
```

同时支持 root 聚合：

```text
root budget >= sum(child budgets)
```

v0.9 没有 child，但 ledger 结构应支持未来聚合。

### 5.6 Cancellation tree

取消必须按 execution tree 传播：

```text
cancel root
  -> cancel active step
```

v0.9 只有一层。

v0.9.1 扩展为：

```text
cancel parent
  -> cancel all children
```

避免将来重新设计取消语义。

### 5.7 最小持久化事件

使用 generic execution/workflow 语义，不使用 subagent-specific event：

```text
execution.created
execution.started
execution.completed
execution.failed
execution.cancelled

plan.proposed
plan.approved
plan.rejected

step.started
step.completed
step.failed

checkpoint.saved
budget.updated
budget.exhausted
```

每个 execution event 至少带：

```text
execution_id
root_execution_id
parent_execution_id? 
actor_kind
```

若现有 canonical schema 已能表达，应复用；新增必须保持通用、最小和可 replay。

### 5.8 Execution result

统一结果结构：

```ts
interface ExecutionResult {
  status: "completed" | "failed" | "cancelled" | "budget_exhausted";
  visibleText?: string;
  artifactRefs: string[];
  citations?: string[];
  labels: DataLabels;
  usage: ExecutionUsage;
  errorCategory?: string;
}
```

不得包含 hidden reasoning。

### 5.9 v0.9 验收

- approval 前无写工具；
- approval 后执行；
- iteration/token/deadline 生效；
- crash/restart resume；
- completed step 不重复；
- cancellation；
- replay；
- one TurnRunner；
- execution IDs 与 budget events 完整；
- `parent_execution_id` 可为空但 schema/serialization 可用。

---

## 6. R0.9-04 — Morning Briefing

### 目标

用一个真实 workflow 验证通用 execution contract。

### 数据

- date/time；
- weather；
- calendar；
- limited news/research；
- overnight results；
- Markdown；
- optional MiniMax TTS。

### 约束

- 只使用 `RunExecutor`；
- 不直接调用模型 transport；
- 不实现 specialist/subagent；
- scheduler 只触发 root execution；
- checkpoint/replay；
- one concurrent run。

### Subagents 兼容性

Morning Briefing 的内部步骤必须是数据驱动 step：

```text
collect-weather
collect-calendar
collect-news
synthesize-report
```

v0.9 顺序执行。

v0.9.1 可将 `collect-news` 或 research step 替换为 Research subagent，而不改变 workflow schema。

---

## 7. R0.9-05 — Installer / doctor / onboarding

### 必须检查

- Node / pnpm / Python / Docker；
- text model；
- cloud ASR；
- MiniMax TTS；
- gateway/client；
- artifacts/replay；
- workflow store；
- scheduler；
- secrets。

### Subagents 兼容性

Doctor 输出采用 capability registry：

```text
voice.cloud_asr
voice.minimax_tts
workflow.bounded_loop
subagents  // v0.9 = not installed / disabled
```

v0.9.1 只增加 capability check，不重构 doctor。

---

## 8. R0.9-06 — v0.9 Release Gate

### 必须完成

- Web voice loop；
- Plan approval；
- bounded loop；
- Morning Briefing；
- setup/doctor/onboarding；
- README/video/architecture；
- deferral ledger。

### Subagents 状态

明确记录：

```text
Subagents: deferred to v0.9.1
Execution model: subagent-ready
```

不得声称 v0.9 已支持 multi-agent。

---

# 第二阶段：v0.9.1 Subagents Extension

## 9. SA-01 — Subagent execution contract + registry

### 9.1 目标

在现有 `RunExecutor` 上加入 child execution：

```text
main execution
  -> delegate tool
  -> child execution
  -> bounded visible result
  -> parent continues
```

采用：

```text
agent-as-tool
```

不采用会话控制权完全转移的 handoff 作为首版。

### 9.2 Subagent registry

配置示例：

```yaml
agents:
  - id: research
    model_role: research
    tools: [web.search, web.fetch, research.snapshot]
    memory_scope: isolated
    max_iterations: 4
    max_tool_calls: 8
    timeout_s: 90

  - id: critic
    model_role: critic
    tools: []
    memory_scope: isolated
    max_iterations: 2
    max_tool_calls: 0
    timeout_s: 45
```

必须闭合验证。

### 9.3 固定约束

Subagents-lite：

- maximum depth = 1；
- children cannot create children；
- max concurrent children = 2；
- fixed registered agents only；
- no dynamic prompt-generated agents；
- no arbitrary tool grants；
- no shared mutable memory；
- no direct user-session ownership；
- no direct notification；
- no scheduler ownership。

### 9.4 Context isolation

Child context只包含：

- parent delegated task；
- explicitly selected parent context；
- relevant artifact/citation refs；
- child persona/system role；
- child tool policy；
- child budget。

默认不包含：

- full parent conversation；
- parent hidden reasoning；
- unrelated memories；
- other child context；
- unrestricted workspace history。

### 9.5 Provider and governance

每个 child 必须独立经过：

- model-role routing；
- label clearance；
- MemoryGate；
- tool permissions；
- egress；
- budget；
- replay。

不能因为 parent 已获许可而继承所有 tool/provider 权限。

### 9.6 Parent-child persistence

复用 v0.9 的：

```text
execution_id
root_execution_id
parent_execution_id
actor_kind
```

Subagent 只将：

```text
actor_kind = subagent
actor_id = registered agent id
```

不需要迁移既有 v0.9 事件。

### 9.7 Cancellation

- parent cancel → all active children cancel；
- child timeout → parent receives bounded failure；
- child failure does not silently retry；
- root budget exhaustion cancels children；
- process/replay state可恢复。

### 9.8 Result boundary

Child 返回：

```text
visible summary
artifact refs
citations
labels
usage
bounded error
```

不得返回：

- hidden reasoning；
- raw chain-of-thought；
- unrestricted tool traces；
- secrets；
- provider diagnostics。

### 9.9 验收

- Research child succeeds；
- Critic child succeeds；
- context isolation；
- separate budgets；
- child tool allowlist；
- parent-child replay；
- cancel cascade；
- provider clearance；
- no nested child；
- no duplicate TurnRunner implementation。

---

## 10. SA-02 — Research + Critic specialists

### Research agent

任务：

- 搜索；
- snapshot；
- citation-grade evidence；
- structured findings。

不能：

- write files outside artifact path；
- execute shell；
- modify user state；
- send notifications。

### Critic agent

任务：

- 检查主方案；
- 找事实漏洞；
- 找 governance 风险；
- 返回 bounded critique。

默认无工具。

### Main synthesis

主 Agent 负责：

- 决定是否 delegate；
- 合并结果；
- 处理冲突；
- 给用户最终答案；
- 不把 child 输出当作可信指令。

---

## 11. SA-03 — Bounded parallel fan-out

### 目标

支持最多两个 child 并行：

```text
Research
Critic
```

### 约束

- concurrency = 2 hard cap；
- shared root budget；
- child-specific budget；
- deadline；
- deterministic result ordering；
- partial failure；
- parent waits/cancels；
- no race on memory/workspace；
- replay records completion order and synthesis order。

不实现：

- arbitrary swarm；
- dynamic graph；
- nested debate；
- long-lived autonomous agents。

---

## 12. SA-04 — Subagents release gate

### Demo 场景

```text
用户：比较两个 Agent 架构方案，并给出建议
  -> Research agent 查证
  -> Critic agent 找漏洞
  -> Main agent 综合
  -> replay 展示 parent/child tree、预算和引用
```

### Exit criteria

- two registered specialists；
- depth 1；
- concurrency 2；
- isolated context；
- bounded budgets；
- cancellation；
- provider/tool governance；
- replay tree；
- no hidden reasoning；
- no regression to v0.9 voice/workflow；
- demo video and README section。

---

## 13. 不需要重构的证明点

Fable gate 应确认以下结构能保证增量扩展：

| v0.9 结构 | v0.9.1 用法 |
|---|---|
| `RunExecutor` | child execution复用 |
| `ExecutionContext` | 加 `actorKind=subagent` |
| parent/root IDs | 直接形成执行树 |
| budget ledger | child/root 聚合 |
| cancellation tree | parent→child |
| generic events | 无 schema migration |
| context scope | child isolation |
| tool policy ID | child allowlist |
| model role | child provider routing |
| execution result | child result boundary |
| Web status API | 可展示 execution tree |
| doctor capability registry | 新增 subagent capability |

只要这些在 R0.9-03 落地，SA-01 不应修改 TurnRunner 核心。

---

## 14. 允许的后续中等抽取

SA-01 可以进行一次受控抽取：

```text
BoundedLoopExecutor
  -> GenericRunExecutor
  -> MainRunExecutor
  -> ChildRunExecutor
```

这是模块拆分，不是语义重写。

硬条件：

- TurnRunner 单实现；
- old workflow tests byte/semantic equivalent；
- event replay compatible；
- server/gateway composition root不扩大；
- no second loop；
- no duplicate provider/tool code。

---

## 15. 时间估算

### v0.9

```text
8–14 个专注工作日
```

### v0.9.1 Subagents-lite

| Slice | 时间 |
|---|---:|
| SA-01 contract + registry | 1–2 天 |
| SA-02 specialists | 1 天 |
| SA-03 parallel/cancel/replay | 1–2 天 |
| SA-04 evidence/docs/demo | 1 天 |

合计：

```text
3–6 个专注工作日
```

较保守、包含严格 gate/review/owner evidence：

```text
5–8 个工作日
```

---

## 16. 不做的范围

本计划不包含：

- dynamic agent creation；
- recursive subagents；
- depth > 1；
- arbitrary agent prompts from users；
- multi-agent DSL；
- persistent personal memory per child；
- child scheduler；
- handoff ownership；
- agent marketplace；
- debate framework；
- autonomous swarm；
- full M4 subagent exit；
- Computer Use；
- MCP/skills/hooks。

这些继续留给正式 v1.0。

---

## 17. Fable/Opus Plan Gate Questions

1. 是否同意先发布 v0.9，再以 v0.9.1 加 Subagents-lite？
2. R0.9-03 是否必须现在引入通用 `ExecutionContext` 和 `RunExecutor`？
3. `root_execution_id` / `parent_execution_id` 是否应该在 v0.9 就进入 generic execution events？
4. 是否接受 `actor_kind: main | workflow | subagent`，但 v0.9 不使用 subagent？
5. generic execution events 是否足以避免未来 schema migration？
6. context scope boundary 是否应在 v0.9 强制抽取？
7. budget ledger 是否需要 root/child 聚合能力从第一版就存在？
8. cancellation tree 是否应在 v0.9 先做单层通用实现？
9. Morning Briefing step 是否应只依赖 `RunExecutor`？
10. v0.9 Web UI 是否只预留 optional parent execution ID，而不实现 tree UI？
11. v0.9.1 是否采用 agent-as-tool 而不是 handoff？
12. depth=1、concurrency=2 是否合适？
13. 是否只注册 Research 和 Critic 两个 agent？
14. child 是否默认无 memory write 权限？
15. child results 是否只允许 visible summary/artifacts/citations/usage？
16. parent cancel → children cancel 是否是硬门？
17. SA-01 是否允许抽取 `ChildRunExecutor`，但禁止修改 TurnRunner？
18. 是否需要单独的 `v0.9.1-deferrals.md`？
19. Subagents 是否进入 v0.9 主演示，还是作为后续扩展演示？
20. Computer Use 是否继续保持 stretch goal，不进入该计划？

Material changes must be written into the plan before implementation.

---

## 18. 推荐执行顺序

1. 对本计划做 Fable/Opus plan gate；
2. 将当前 v0.9 fastest-product plan 替换为本方案；
3. 起草并 gate R0.9-01；
4. 逐单完成 v0.9；
5. 发布 Portfolio Release；
6. 起草并 gate SA-01；
7. 完成 v0.9.1 Subagents Extension；
8. 再决定 Computer Use 或恢复完整 M3-06 本地 ASR。

不要让 Codex一次实现整个计划。
