# OpenFairy v0.9 Developer Preview — 最终分层交付计划

**状态：** FINAL PLAN  
**基线：** M3-05 已在 `e9e88ec` 关闭；M3-06 faster-whisper 已 gate、未派发  
**外部名称：** OpenFairy v0.9 Developer Preview  
**内部名称：** Portfolio Release Track  
**目标窗口：** 1–2 个日历周  
**原则：** 产品范围做减法；架构、治理、测试和审查地板不做减法  
**本文件取代：**
- `OpenFairy-v0.9-fastest-product-plan.md`
- `OpenFairy-v0.9-plus-subagents-plan.md`

---

## 1. 最终路线

```text
Tier 1 — 面试演示核心，目标 5–7 个专注日
├─ R0.9-01  Xiaomi MiMo-V2.5-ASR 云文件识别
├─ R0.9-02  localhost Web push-to-talk + MiniMax MP3 播放
├─ R0.9-05′ doctor + 一键开发启动 + 演示脚本/README
└─ R0.9-06′ 轻量 release gate + 延期台账

Tier 2 — 只有 Tier 1 完成且仍有 2–3 个专注日才做
└─ R0.9-03+04  approval-gated、budget-bounded、
                 resumable Morning Briefing
                 + subagent-ready execution seam

v0.9.1 — 面试后
├─ SA-01  Subagent execution contract + registry
├─ SA-02  Research + Critic
├─ SA-03  concurrency=2 bounded fan-out
└─ SA-04  Subagents extension release gate
```

Computer Use 不进入本计划，保留为 v0.9.2 或独立 stretch goal。

---

## 2. 正式里程碑关系

`R0.9-*` 是发布覆盖层，不是 M3/M4/M5 重编号。

已 gate 的 M3-06 faster-whisper 记录为：

```text
DEFERRED TO FULL M3 / v1.0
```

其 brief、gate record、uv 方案、模型 revision 和离线运行裁决全部保留。

完整 M3/M4/M5 exit 只在正式 v1.0 gate 结算。v0.9 不得声称：

- complete M3；
- complete M4；
- production-ready；
- v1.0。

---

## 3. Tier 1 产品闭环

完成 Tier 1 后，可现场演示：

```text
浏览器录音
→ 停止并上传完整音频
→ MiMo 云 ASR
→ speech.asr.final
→ 现有 voice-to-turn
→ TurnRunner
→ memory / research / tools / governance
→ MiniMax TTS
→ 浏览器播放 MP3
→ fairy replay
```

演示重点：

1. 正常双语语音对话；
2. secret 音频 route denial，provider 零请求字节；
3. MemoryGate hold/write；
4. research citations；
5. replay 中完整治理和工具轨迹；
6. brief gate → primary review → owner evidence → countersign 的工程纪律。

---

## 4. 全程硬不变量

### Runtime

- One TurnRunner。
- modes 是 policy，不是第二个 loop。
- JSONL 是 session source of truth。
- M5 前 source-first TypeScript。
- 不新增 dist exports。
- tests 不依赖 sibling builds。
- Gateway/CLI 保持 `tsx` execution world。
- kernel 不出现 provider 特判。

### Voice/provider

- ASR/TTS 通过 `speech.providers`、roles 和 gateway-owned coordinator。
- 浏览器不直连 provider，也不持有 provider secret。
- clearance 和 egress 在 provider I/O 前执行。
- under-cleared provider：零连接、零请求字节。
- 音频和转写标签 raise-only。
- raw audio、hex、base64 不进入 JSONL。
- ASR final 只进入：
  - `#submitVoiceFinalTranscript`
  - `#acceptTurnInput`
- 不新增 vendor/worker canonical event family。

### Client

- 只绑定 `127.0.0.1`。
- gateway token 鉴权。
- browser bundle/storage 无 provider key。
- UI 不暴露 provider-specific contract。
- “停止播放”只表示 local playback stop，不是 barge-in。

### Process

- 每单保留 brief gate。
- R0.9-01/02 全量 countersign。
- R0.9-05′/06′ 可轻量 countersign。
- Tier 2 若做，按新 invariant class 全量审查。
- 既有 named suites 永不削弱。

---

# Tier 1

## 5. R0.9-01 — Xiaomi MiMo-V2.5-ASR 云文件识别

### 目标

```text
input audio artifact
→ gateway speech coordinator
→ MiMo ASR worker
→ one speech.asr.final
→ one turn.input
→ one model request
→ replay
```

### Provider 固定合同

```text
provider: Xiaomi MiMo
model: mimo-v2.5-asr
endpoint profile: cn-primary
endpoint: https://api.xiaomimimo.com/v1/chat/completions
mode: non-streaming file recognition
language: auto | zh | en
selected auth: api-key header
clearance regions: [cn]
```

### Chat-Completions 方言例外

MiMo ASR 的 provider envelope 使用 Chat-Completions 形态。

它必须被记录为：

```text
speech-provider dialect exception
```

只允许存在于：

- worker adapter；
- provider fixtures；
- provider conformance tests。

不得：

- 进入 kernel/canonical；
- 复用 model-gateway transport；
- 扩散到 provider-neutral coordinator；
- 形成第二个 TurnRunner/model path。

Countersign docs pass 在 `protocol.md` 留一行显式注记。

### Credential

本 slice 固定 `api-key` header。

凭证：

- gateway 解析 `secret://`；
- 通过一个窄 child env var；
- 不进 argv、NDJSON、JSONL、stdout/stderr、CLI JSON、diagnostics、fixtures；
- child env deliberate construction；
- closed endpoint profile；
- no arbitrary proxy/URL override。

**派发 Codex 前，owner 必须取得并验证 MiMo API key。**

### Audio/base64 边界

Provider HTTP body 需要 base64 audio，但 base64 只能存在于 worker 内部：

```text
staged audio bytes
→ worker local memory
→ provider HTTP base64 field
```

禁止出现在：

- gateway→worker NDJSON；
- JSONL；
- CLI；
- logs/diagnostics；
- canonical events；
- committed evidence。

Provider 编码上限必须转化为 pre-I/O raw-size limit。超限时：

- provider 零请求；
- no ASR final；
- no turn input；
- no model call；
- replayable。

### Artifact 范围

Tier 1 支持：

- WAV；
- MP3。

**（gate 决断，2026-07-13）WebM 永不进入 artifact store，transcoder 永不建设。** 原因：Chrome/Edge 的 `MediaRecorder` 默认产出 webm/opus，而 MiMo 只收 wav/mp3——若把格式决定推迟到 R0.9-02，冲刺中期必然撞上"要么引入 ffmpeg 转码（违反本节禁令）、要么改 provider"的两难。裁决：**R0.9-02 在浏览器端直接产出 WAV**（`AudioContext` 采集 PCM 后 JS 端编码 WAV，或等价的 PCM 录制路径；实现由 R0.9-02 brief 定，约 50 行无依赖代码）。Push-to-talk 时长上限由 MiMo 的 10 MB base64 限制反推：16-bit 16 kHz 单声道 WAV ≈ 每秒 32 KB，raw ≤ 7.5 MB ≈ 约 3.9 分钟，远超按键说话需求；R0.9-02 的 UI 录音上限取 90 秒。artifact MIME 集合就此封闭为 WAV + MP3，不再有 R0.9-02 依赖。

音频：

- 导入 `kind: input`；
- clearance 后 gateway 私有 staging；
- worker wire 只含 token、MIME、size、SHA；
- 完成/失败后删除 staging root。

### Coordinator carry-in

R0.9-01 必须结算 M3-05 carry-in：

- 抽取/完成 gateway-owned speech provider coordinator；
- MiMo ASR 和 MiniMax TTS 都由 coordinator 编排；
- 不继续把 provider orchestration 堆进 `server.ts`；
- TTS 行为和 `voice.tts-provider-v0` 不变；
- coordinator 不拥有 TurnRunner、gateway dispatch 或第二个 loop；
- `server.ts` 相对 `e9e88ec` 净减少，除非 gate 记录明确例外。

### Scope

必须：

- ASR config + `speech.roles.asr`；
- provider-shaped fake；
- exact request/response/error mapping；
- clearance + audio egress；
- zero-byte denial；
- one final/turn/model；
- timeout/cancel/crash cleanup；
- replay；
- owner real API check。

不做：

- local ASR；
- streaming/partials；
- VAD/endpointing；
- provider fallback；
- benchmark；
- microphone/UI；
- transcoding framework。

---

## 6. R0.9-02 — localhost Web push-to-talk

### 目标

```text
MediaRecorder
→ stop
→ complete blob upload
→ input artifact
→ R0.9-01 ASR
→ TurnRunner
→ M3-05 MiniMax TTS
→ authenticated MP3 fetch
→ browser playback
```

### 最小 UI

- new/open session；
- start recording；
- stop and send；
- statuses：
  - recording
  - uploading
  - transcribing
  - thinking
  - synthesizing
  - playing
  - failed
- transcript；
- assistant final；
- play/stop；
- replay link；
- bounded error。

### 安全边界

- loopback only；
- gateway token required；
- no provider secret/name in browser contract；
- upload MIME/size/magic checks；
- artifact fetch 做 auth、kind、MIME、ownership 检查；
- no arbitrary artifact path/directory listing；
- no raw audio in JSONL。

### 停止播放

只停止浏览器音频。

不触发：

- TurnRunner cancel；
- kernel abort；
- `turn.interrupted`；
- last-heard/unspoken；
- barge-in cascade。

### Exit

- Windows Chrome/Edge；
- one bilingual voice turn；
- MP3 auto-play；
- local stop；
- reload 后 history/replay；
- browser 无 secret；
- no unauthenticated ingress；
- 开始累计 ≥20 次真实 voice sessions，计入未来 S4 landing gate。

---

## 7. R0.9-05′ — doctor + dev start + demo package

Tier 1 不做安装器。

### One-command dev start

建议：

```text
pnpm fairy dev
```

或 gate 认可的等价命令。

功能：

- config preflight；
- secret reference checks；
- gateway + Web UI start；
- health/status；
- browser open；
- Ctrl+C cleanup。

不自动安装系统依赖或写入 secret。

### Doctor

检查：

- Node/pnpm/Python；
- ports/data dir/config；
- model provider；
- MiMo ASR；
- MiniMax TTS；
- artifacts/replay；
- Web UI assets；
- loopback/auth；
- known warnings。

Doctor 不打印 secret，不默认发真实 API 请求。

### Demo package

必须完成：

- README quick start；
- 3 分钟演示脚本；
- 一张架构图；
- screenshots/GIF；
- 三个场景：
  1. 正常语音；
  2. secret route denial；
  3. memory/research/replay；
- known limitations；
- 面试项目说明。

不做：

- MSI；
- polished onboarding wizard；
- auto-update；
- macOS/Linux packaging。

---

## 8. R0.9-06′ — 轻量 release gate

### 名称

外部：

```text
OpenFairy v0.9 Developer Preview
```

### Exit

- real MiMo ASR owner evidence；
- real MiniMax TTS evidence；
- Web push-to-talk；
- authenticated loopback；
- replay；
- route denial；
- memory/research/tools regression；
- doctor；
- dev start；
- README/demo；
- voice-session count；
- `docs/v0.9-deferrals.md`。

### Deferral ledger

记录 reason、impact、security impact 和 landing task。

#### M3

- faster-whisper；
- streaming framing；
- VAD/endpointing；
- streaming ASR/TTS；
- Lane A/B；
- ack bank；
- barge-in；
- tray；
- latency/WER/CER。

#### M4

- Tier 2 workflow（若未做）；
- subagents；
- fan-out；
- generic workflow；
- Telegram；
- 7-day unattended exit。

#### M5

- installer；
- MCP；
- skills/hooks；
- dashboard；
- complete hardening；
- extension docs；
- 2-week soak；
- v1.0。

---

# Tier 2 — 只有余量才做

## 9. R0.9-03+04 — bounded Morning Briefing

启动条件：

- Tier 1 全部 green；
- owner evidence 完成；
- demo 可运行；
- 剩余至少 2–3 个专注日。

### 范围

```text
plan.proposed
→ owner approval
→ bounded loop
→ weather/calendar/research
→ checkpoint
→ Markdown briefing
→ optional TTS
```

### Canonical events

只使用 M0 已注册的：

- `plan.*`
- `loop.*`
- `workflow.*`

不新增 `execution.*` canonical family。

允许兼容性 additive payload：

- execution_id；
- root_execution_id；
- parent_execution_id；
- actor_kind。

### Subagent-ready seam

若 Tier 2 实施，必须加入：

- `ExecutionContext`；
- `RunExecutor`；
- explicit context scope；
- root/parent IDs；
- actor kind：
  - main
  - workflow
  - subagent reserved
- root/child-capable budget ledger；
- single-level cancellation tree；
- UI 可选 parent ID，但不做 tree UI。

当前不实现 subagent。

### Workflow

- Morning Briefing 是唯一 workflow；
- scheduler trigger-only；
- persistent next run；
- quiet hours；
- missed-run policy；
- one concurrent run；
- crash/restart resume；
- completed write 不重复。

---

# v0.9.1 — 面试后 Subagents

## 10. 固定范围

采用 agent-as-tool，不采用 handoff。

```text
depth = 1
concurrency = 2
agents = Research + Critic
```

硬规则：

- fixed registry；
- child 不得创建 child；
- child 默认无 memory write；
- child 独立 model clearance、tool permission、egress、budget；
- parent cancel → children cancel；
- child result 只含：
  - visible summary
  - artifact refs
  - citations
  - usage
  - bounded error
- no hidden reasoning。

### SA-01

- SubagentRegistry；
- child execution contract；
- parent/root linkage；
- context isolation；
- budget/cancel tree；
- same TurnRunner implementation。

### SA-02

- Research；
- Critic；
- first critic wiring 结算 persona frozen style-judge ≥90% carry-in。

### SA-03

- max two parallel children；
- deterministic synthesis order；
- partial failure；
- shared root budget；
- replay tree。

### SA-04

- owner evidence；
- README/demo；
- extension release gate。

Subagents 不进入 v0.9 主演示。

---

## 11. Computer Use

```text
STRETCH GOAL — post v0.9.1
```

未来优先 browser-only Playwright computer use，不先做完整 Windows desktop control。

---

## 12. 时间预算

| 阶段 | 预计专注日 |
|---|---:|
| Tier 1 | 5–8 |
| Tier 2 | 2–4 |
| v0.9.1 Subagents | 3–6 |

面试前只承诺 Tier 1。

---

## 13. 审查流程

每个 slice：

1. ChatGPT brief；
2. Fable gate；
3. owner commit/push；
4. Codex implement；
5. CI green；
6. ChatGPT committed-state review；
7. owner checks；
8. final close；
9. Fable countersign/docs pass。

审查深度：

| Slice | 深度 |
|---|---|
| R0.9-01 | 全量 |
| R0.9-02 | 全量 |
| R0.9-05′ | 轻量 |
| R0.9-06′ | 轻量 |
| Tier 2 | 全量 |
| SA-* | 全量 |

---

## 14. 当前行动项

### Owner

在 R0.9-01 派发前：

1. 获取 Xiaomi MiMo API key；
2. 确认 key 可调用 `mimo-v2.5-asr`；
3. 不把 key 放进聊天、commit 或文档；
4. 提交：
   - 本最终计划；
   - `v0.9-plan-review.md`；
5. M3-06 保留为延期任务。

### ChatGPT 下一步

起草：

```text
R0.9-01 — Xiaomi MiMo-V2.5-ASR cloud file worker
```

必须包含：

- coordinator carry-in；
- closed endpoint；
- `api-key` credential；
- Chat-Completions speech dialect exception；
- base64 boundary；
- pre-I/O size limit；
- WAV/MP3 artifacts；
- zero-byte denial；
- one final/turn/model；
- fake provider；
- owner live check；
- no streaming/VAD/UI。

### Codex

不得按本计划一次实现。只在 R0.9-01 brief gate 完成后接单。
