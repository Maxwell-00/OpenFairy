# OpenFairy v0.9 Portfolio Release — 最短成品路线方案

**状态：** DRAFT FOR FABLE/OPUS PLAN GATE  
**基线：** M3-05 已在 `e9e88ec` 权威关闭；M3-06 faster-whisper brief 已 gate，但尚未派发实现  
**目标：** 在不破坏现有架构、不偷偷重写 ROADMAP 的前提下，优先完成一个可安装、可实际使用、可录制演示视频、可用于求职展示的 OpenFairy v0.9  
**版本定位：** Portfolio Release / Developer Preview；不是正式 v1.0  
**核心原则：** 产品能力做减法，架构纪律不做减法

---

## 1. 决策摘要

### 1.1 推荐决策

暂停当前已 gate 的 M3-06 本地 faster-whisper ASR 实现，将其登记为：

```text
DEFERRED TO FULL M3 / v1.0
```

不删除任务书、不撤销架构裁决、不否定本地 ASR 的价值。

立即切换到一条独立的 v0.9 Portfolio Release 轨道：

```text
R0.9-01  单一云端文件 ASR + 音频 artifact 输入
R0.9-02  localhost Web push-to-talk + TTS 播放
R0.9-03  Plan approval + bounded loop + crash resume
R0.9-04  Morning Briefing 单一真实工作流
R0.9-05  Installer/doctor/onboarding + demo/release hardening
R0.9-06  v0.9 release gate + deferral ledger
```

若 Fable 认为 R0.9-03 与 R0.9-04 可以合并，可合成一单；其余依赖顺序不变。

### 1.2 v0.9 最终产品形态

用户可以在 Windows 11 上：

1. 运行安装/初始化命令；
2. 打开 localhost Web UI；
3. 点击开始录音；
4. 点击停止并发送；
5. 浏览器上传一段完整音频；
6. gateway 将音频注册为 `input` artifact；
7. 单一云 ASR 返回最终转写；
8. 转写进入现有唯一 voice-to-turn 路径；
9. OpenFairy 使用现有 TurnRunner、记忆、研究、工具和治理；
10. MiniMax TTS 生成 MP3 artifact；
11. Web UI 自动播放；
12. 用户可停止本地播放；
13. replay 可查看完整语音、模型、工具和治理事件；
14. 用户可创建一个需要批准、受预算限制、可重启恢复的 Morning Briefing 工作流。

这已经构成可实际使用、可展示的个人 AI Agent 成品。

---

## 2. 为什么采用“发布覆盖层”，而不是重写 M3/M4/M5

现有 ROADMAP 的完整目标仍然有效：

- M3：完整语音 I/O、流式 ASR/TTS、VAD、Lane A/B、barge-in、tray、benchmark；
- M4：subagents、Plan/Loop、workflow、scheduler、通知、主动代行；
- M5：MCP、skills/hooks、dashboard、installer、hardening、soak、v1.0。

v0.9 不是替代这些目标，而是建立一个中间发布门。

### 2.1 保留完整路线图

以下任务继续保留，后续恢复：

- 本地 faster-whisper ASR；
- 流式音频和 compact channel framing；
- VAD/endpointing；
- 云端实时 ASR；
- 流式 TTS/CJK chunker/playback marks；
- Lane A/B 和 ack bank；
- barge-in；
- desktop tray；
- ASR/延迟 benchmark；
- 通用 workflow engine；
- subagents；
- Telegram；
- MCP/skills/hooks；
- dashboard；
- 两周 soak；
- 正式 v1.0 exit。

### 2.2 新增显式 deferral ledger

v0.9 release gate 必须列出：

- 哪些正式 M3/M4/M5 exit criteria 未满足；
- 每项延期的原因；
- 对应后续 landing task；
- 是否影响当前安全/治理声明；
- v0.9 不得声称已经完成完整 M3/M4/M5 或正式 v1.0。

---

## 3. 不允许为了速度破坏的架构不变量

以下规则在 v0.9 仍是硬门。

### 3.1 Runtime

- One TurnRunner。
- modes 是 policy，不是第二个 loop。
- JSONL session events 是 source of truth。
- M5 前保持 source-first TypeScript。
- 不使用 dist exports。
- 不允许测试依赖 sibling builds。
- Gateway/CLI 保持同一个 `tsx` 执行世界。
- 不在 kernel 增加 provider 特判。

### 3.2 Voice

- 所有 ASR/TTS 都通过 speech provider registry、roles 和 gateway-owned coordinator。
- 浏览器不得直接调用云 ASR/TTS。
- 浏览器不得持有 provider secret。
- 音频不得 base64/hex 写入 JSONL。
- 非流式音频通过 artifact ID/reference。
- ASR final 只进入现有：
  - `#submitVoiceFinalTranscript`
  - `#acceptTurnInput`
- 不建立第二条 voice-to-turn 路径。
- provider clearance 和 egress 必须在 provider I/O 前执行。
- under-cleared provider 获得零连接/零请求字节。
- 音频与转写标签只能提高，不能降低。
- 现有 MiniMax TTS、artifact、replay、Python worker 纪律继续保持。

### 3.3 Client

- UI 只表达录音、发送、取消、播放、停止播放和状态。
- UI 不知道具体 provider。
- UI 不包含 API key。
- localhost listener 保持鉴权。
- 第一版只绑定 `127.0.0.1`。
- 不引入 LAN/tunnel/TLS 设计，除非单独 gate。

### 3.4 Workflow

- Workflow 调度 TurnRunner，不复制 TurnRunner。
- Plan、approval、step、checkpoint、budget、completion 必须事件化。
- Scheduler 只负责触发，不拥有 workflow 真源。
- 工作流状态不能只放在内存。
- 重启后必须可以从事件/checkpoint 恢复。
- 所有工具权限继续走现有权限和 egress 体系。

---

## 4. R0.9-01 — 单一云端文件 ASR + 音频 artifact 输入

### 4.1 目标

实现最小可用的语音输入：

```text
完整音频文件
  -> input artifact
  -> 单一云 ASR
  -> speech.asr.final
  -> 现有 TurnRunner
```

这是文件级、非流式 ASR，不实现 partial、VAD 或 endpointing。

### 4.2 Provider 选型原则

只接一个 provider。

优先级：

1. 用户已有正式凭证和额度；
2. 提供简单同步/文件转写 HTTP API；
3. 支持中文、英文和中英混说；
4. 有明确错误码和数据地域声明；
5. 可以在 owner live check 中验证；
6. CI 可以使用 provider-shaped fake。

Provider 选择在 brief gate 时确定。

不应为了“未来通用性”同时接两个 provider。

### 4.3 必须交付

- `speech.providers` ASR provider variant；
- `speech.roles.asr`；
- gateway-owned ASR orchestration；
- `input` audio artifact import；
- WAV/WebM/MP3 中最少一到两种浏览器可产出的格式；
- provider-specific adapter；
- provider-shaped fake server；
- provider clearance；
- audio egress；
- zero-byte denial；
- final transcript；
- existing voice-to-turn path；
- replay；
- owner live check。

### 4.4 必须保持 provider-neutral 的边界

Gateway 负责：

- route；
- clearance；
- secret；
- egress；
- canonical events；
- artifact；
- replay；
- failure visibility。

Adapter/worker 负责：

- provider request；
- provider response；
- provider error mapping；
- audio payload mapping。

### 4.5 明确不做

- 本地 ASR；
- streaming；
- partial；
- VAD；
- endpointing；
- microphone API；
- client UI；
- 多 provider benchmark；
- provider fallback 链；
- GPU；
- diarization；
- word timestamps。

### 4.6 验收

- 一个短中文文件；
- 一个短英文文件；
- 一个短中英混合文件；
- 正常 final；
- exactly one turn；
- exactly one model request；
- under-cleared provider zero bytes；
- raw audio 不进 JSONL；
- cancel/timeout/failure before final 无 turn/model；
- owner 一次真实 API evidence。

---

## 5. R0.9-02 — localhost Web push-to-talk + MP3 播放

### 5.1 目标

形成完整用户可见语音闭环：

```text
Web 录音
  -> 停止
  -> 上传完整音频
  -> 云 ASR
  -> TurnRunner
  -> MiniMax TTS
  -> 浏览器播放 MP3
```

### 5.2 客户端形态

优先选择 localhost Web UI，而不是 desktop tray。

原因：

- 浏览器已有 MediaRecorder；
- UI 开发速度快；
- 可直接用于演示视频；
- 后续 tray 可以作为启动/快捷键/通知外壳；
- 不需要现在处理 Windows 原生音频和打包框架。

### 5.3 最小 UI

必须包含：

- 会话选择/新建；
- 开始录音；
- 停止并发送；
- 当前状态：
  - recording
  - uploading
  - transcribing
  - thinking
  - synthesizing
  - playing
  - failed
- 用户最终转写；
- Agent 最终文本；
- 播放/停止播放；
- replay 入口；
- 错误提示。

不需要漂亮设计系统。

### 5.4 音频边界

- 使用浏览器支持的完整录音 blob；
- gateway 导入为 artifact；
- client 不直接调用 provider；
- client 不发送 provider credentials；
- client 不写 JSONL；
- TTS 返回 artifact ref 或受鉴权下载 URL；
- 浏览器播放现有 MiniMax MP3。

### 5.5 “停止播放”的定义

v0.9 的停止只表示：

```text
local playback stop
```

不等于完整 barge-in。

它不自动：

- 中止 TurnRunner；
- checkpoint kernel；
- 产生完整 interruption cascade；
- 计算 last-heard mark；
- 统计 unspoken。

这些明确延期到完整 M3。

### 5.6 验收

- Windows Chrome/Edge；
- localhost token auth；
- 录音一次；
- ASR final；
- Agent reply；
- MiniMax MP3 自动播放；
- 停止本地播放；
- no secrets in browser bundle/storage；
- no raw audio in JSONL；
- reload 后历史文本/replay 可用。

---

## 6. R0.9-03 — Plan approval + bounded loop + crash resume

### 6.1 目标

证明 OpenFairy 不只是对话工具，而是受治理的代行 runtime：

```text
目标
  -> plan artifact
  -> 用户批准
  -> bounded loop
  -> checkpoint
  -> complete / budget stop / anomaly stop
```

### 6.2 Plan mode

必须实现：

- 只读探索；
- plan artifact；
- 计划步骤；
- 预计工具；
- 风险/权限；
- 时间/token/cost 预算；
- 用户 approve/reject；
- approve 前禁止写操作。

### 6.3 Bounded loop

必须实现：

- 最大迭代数；
- wall-clock deadline；
- token/cost budget；
- completion predicate；
- anomaly stop；
- explicit cancel；
- 每轮使用现有 TurnRunner；
- checkpoint；
- gateway 重启后 resume；
- replay。

### 6.4 最小事件模型

允许复用现有 canonical 类型；若确实缺失，可新增最小、通用、非 workflow-specific schema。

至少需要表达：

- workflow/plan created；
- plan proposed；
- plan approved/rejected；
- step started/completed/failed；
- checkpoint saved；
- budget updated/exhausted；
- workflow completed/cancelled/failed。

不得只靠内存对象。

### 6.5 不做

- subagent fan-out；
- 跨厂商 agent 并发；
- 通用 DAG DSL；
- YAML workflow marketplace；
- arbitrary user code；
- Telegram；
- 多 channel notification；
- 长时间无人值守 soak。

### 6.6 验收

- approve 前写工具为零；
- approve 后按计划执行；
- budget stop 有可见原因；
- crash/restart 后从 checkpoint 恢复；
- 不重复已经完成的写操作；
- session/workflow replay；
- one TurnRunner；
- tool governance 不绕过。

---

## 7. R0.9-04 — Morning Briefing 单一真实工作流

### 7.1 目标

用一条真实产品场景把 M0–M4-lite 串起来。

建议工作流：

```text
Morning Briefing
```

内容：

- 当前日期；
- 天气；
- 日历；
- 少量新闻/RSS 或 research summary；
- overnight workflow 结果；
- Markdown 报告；
- 可选 MiniMax TTS 播报。

### 7.2 Scheduler-lite

只实现：

- 一个持久化 schedule；
- 下一次触发时间；
- quiet hours；
- missed-run policy；
- gateway 重启恢复；
- 手动 run-now；
- 最多一次并发运行。

Scheduler 只触发 workflow，不拥有 workflow 状态。

### 7.3 通知

最短路线优先：

- Web UI inbox/status；
- 本地桌面通知若实现成本低；
- 不接 Telegram。

### 7.4 验收

- 定时触发；
- gateway 重启后仍能触发；
- quiet hours 有效；
- 数据不足时 fail-soft；
- 报告 artifact/replay 可查；
- 可选 TTS 成功；
- 不产生隐式未批准写操作。

---

## 8. R0.9-05 — Installer、doctor、onboarding 和发布硬化

### 8.1 目标

让另一个人能够按文档在 Windows 11 上运行 OpenFairy。

### 8.2 安装范围

必须提供：

- Windows PowerShell setup；
- Node/pnpm 检查；
- Python 检查；
- Docker 检查；
- 数据目录初始化；
- provider config 初始化；
- secrets 引导；
- gateway/client 启动；
- health check；
- 卸载/清理说明。

不要求完整 MSI 安装器。

### 8.3 Doctor

`fairy doctor` 至少检查：

- Node；
- pnpm；
- Python；
- Docker；
- ports；
- data directory；
- config parse；
- model provider；
- cloud ASR provider；
- MiniMax TTS；
- secrets 引用是否可解析；
- browser client assets；
- scheduler/workflow store；
- artifacts/replay；
- known warnings。

Doctor 不打印 secret。

### 8.4 Onboarding

首次使用流程：

1. 初始化数据目录；
2. 选择文本模型；
3. 配置 cloud ASR；
4. 配置 MiniMax TTS；
5. 测试 provider；
6. 启动 gateway；
7. 打开 localhost UI；
8. 完成一次文字对话；
9. 完成一次语音对话；
10. 创建 Morning Briefing。

### 8.5 发布材料

必须完成：

- README 首页；
- 3 分钟演示视频；
- 架构图；
- threat model 摘要；
- 3 个演示场景；
- 安装步骤；
- troubleshooting；
- screenshots/GIF；
- 求职版项目描述；
- 技术栈列表；
- 已实现/延期矩阵。

### 8.6 不做

- MCP；
- skills/hooks；
- extension SDK；
- dashboard；
- macOS installer；
- Linux installer；
- MSI；
- auto-update；
- 两周 soak；
- 正式 v1.0 tag。

---

## 9. R0.9-06 — Release gate

### 9.1 Release 名称

建议：

```text
OpenFairy v0.9 Portfolio Release
```

或：

```text
OpenFairy Developer Preview 0.9
```

不得命名为正式 v1.0。

### 9.2 Exit criteria

必须同时满足：

#### 产品闭环

- Web push-to-talk；
- 一个真实 cloud ASR；
- 一个真实 MiniMax TTS；
- 文本、工具、记忆、研究正常；
- Plan approval；
- bounded resumable loop；
- Morning Briefing；
- Windows setup/doctor/onboarding。

#### 治理

- client 无 provider secret；
- ASR/TTS clearance 和 egress；
- under-cleared provider zero bytes；
- audio 不进 JSONL；
- replay；
- MemoryGate；
- tool permissions；
- no hidden reasoning/audio leakage。

#### 稳定性

- 一次完整 fresh-machine-style setup；
- 至少 20 次 push-to-talk 会话；
- 至少 3 次 workflow crash/restart resume；
- Morning Briefing 连续 3 天或 3 次模拟日运行；
- no orphan worker；
- no corrupt artifact；
- bounded error UI。

#### 求职交付

- README；
- 架构图；
- 演示视频；
- screenshots；
- 简历描述；
- known limitations；
- deferral ledger。

### 9.3 Deferral ledger

必须明确登记：

#### M3 延期

- local ASR；
- streaming audio；
- VAD/endpointing；
- streaming ASR/TTS；
- Lane A/B；
- ack bank；
- barge-in；
- tray；
- latency/WER/CER benchmarks。

#### M4 延期

- subagents；
- cross-provider fan-out；
- generic workflow engine/DAG；
- Telegram；
- 多通知 channel；
- 7-day unattended exit。

#### M5 延期

- MCP；
- skills/hooks；
- observability dashboard；
- full injection suite；
- full installer；
- extension docs；
- 2-week soak；
- v1.0 tag。

每项必须指向未来 landing task。

---

## 10. 从 v0.9 回到完整 v1.0 的增量路径

只要本方案的架构硬门保持，v1.0 不需要推倒重来。

### 10.1 恢复本地 ASR

继续已 gate 的 faster-whisper M3-06：

```text
local artifact
  -> speech.roles.asr
  -> local worker
```

它与 cloud file ASR 共享：

- provider registry；
- roles；
- clearance；
- artifacts；
- canonical final；
- replay；
- coordinator。

### 10.2 升级 streaming voice

替换/扩展：

- browser recording transport；
- compact binary frames；
- streaming ASR adapter；
- VAD/endpointing；
- partial transcript；
- playback queue；
- cancel state。

不改：

- TurnRunner；
- MemoryGate；
- model routing；
- canonical final；
- tools；
- JSONL；
- provider clearance。

### 10.3 升级 workflow

在已有：

- plan；
- approval；
- event-sourced steps；
- budget；
- checkpoint；
- resume；

之上增加：

- subagents；
- parallel fan-out；
- generic definitions；
- more schedules；
- notifications；
- Telegram。

### 10.4 Tray

Tray 作为 Web UI 外壳：

- 启停 gateway；
- 打开 UI；
- 快捷键；
- mic 状态；
- 本地通知。

不重新实现整套前端。

---

## 11. 预计时间

| Slice | 预计专注时间 |
|---|---:|
| R0.9-01 云文件 ASR | 1.5–3 天 |
| R0.9-02 Web push-to-talk | 2–4 天 |
| R0.9-03 Plan + bounded loop | 2–4 天 |
| R0.9-04 Morning Briefing | 1.5–3 天 |
| R0.9-05 Release hardening | 2–4 天 |
| R0.9-06 Release gate/materials | 1–2 天 |

总计：

```text
约 10–20 个专注工作日
```

若 R0.9-03/04 合并且 UI 保持极简：

```text
约 8–14 个专注工作日
```

---

## 12. 风险与控制

| 风险 | 控制 |
|---|---|
| 为快让浏览器直连 provider | 明确禁止，全部走 gateway |
| Web UI 变成大前端项目 | 只做 6–8 个状态和核心按钮 |
| 云 ASR provider 选型拖延 | gate 时只选一个已有凭证的同步 API |
| Plan/Loop 变成通用平台 | 只做一个事件化 bounded loop |
| Morning Briefing 数据源膨胀 | 限制天气/日历/少量 research |
| Installer 过度包装 | PowerShell setup + doctor，不做 MSI |
| v0.9 被误称完整 v1.0 | release gate 强制 deferral ledger |
| 后续 v1.0 要重写 | 保持 provider/TurnRunner/artifact/workflow 边界 |
| 现有 M3-06 工作浪费 | brief 保留，v0.9 后继续实现 |

---

## 13. Fable/Opus 需要裁决的问题

1. 是否接受用独立 `R0.9-*` 发布轨道覆盖当前正式 milestone，而不是重编号 M3/M4/M5？
2. 已 gate 的 M3-06 faster-whisper 是否登记为显式延期，而不是取消？
3. R0.9-01 是否应使用单一同步 cloud file ASR？
4. cloud ASR provider 应由“现有凭证/额度优先”还是指定某一厂商？
5. R0.9-01 是否必须先抽取/复用 speech coordinator？
6. 浏览器完整 blob → gateway artifact 是否是接受的 v0.9 音频路径？
7. localhost Web UI 是否可替代 tray 作为 v0.9 client？
8. “停止播放”是否明确只代表 local stop，不冒充 barge-in？
9. R0.9-03 的最小 Plan/Loop 事件合同是否足够支撑未来通用 workflow？
10. R0.9-03 和 R0.9-04 是否可以合并？
11. Morning Briefing 是否是正确的唯一真实工作流？
12. Scheduler-lite 的持久化和 missed-run policy 是否足够？
13. Windows PowerShell setup + doctor 是否足以作为 v0.9 installer？
14. v0.9 exit 是否需要 20 次 voice sessions、3 次 resume、3 次 briefing 运行？
15. 哪些 ROADMAP/PRD/ARCHITECTURE 文档应在 v0.9 计划 gate 后更新？
16. v0.9 应命名为 Portfolio Release、Developer Preview，还是其他名称？
17. 是否需要单独的 deferral ledger 文档？
18. 完整 M3/M4/M5 exit 是否仍然只在正式 v1.0 gate 结算？

Material changes must be written into the plan before dispatching the first R0.9 task.

---

## 14. 建议的下一步

1. Fable/Opus 对本方案做 plan gate；
2. 形成：
   - `tasks/R0.9-plan.md`
   - `tasks/R0.9-plan-review.md`
   - `tasks/R0.9-deferrals.md`
3. commit/push；
4. 起草并 gate `R0.9-01 cloud file ASR`；
5. Codex 实现；
6. 按既有流程 review、owner check、countersign；
7. 逐单推进到 v0.9 release gate。

不要直接让 Codex 按整份计划一次性实现。
