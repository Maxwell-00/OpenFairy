已按 M2-01 完成推进，且没有修改 `docs/` / `docs-zh/`。

**1. File Tree Delta**
新增/重点修改：

- [model-gateway governance (line 94)](E:\\Claude_Projects\\Projects\\Fairy\\OpenFairy\\packages\\model-gateway\\src\\governance.ts:94)：清晰度比较、residency/home region gate、`prefer_local` 非门控。
- [model-gateway route gate (line 58)](E:\\Claude_Projects\\Projects\\Fairy\\OpenFairy\\packages\\model-gateway\\src\\gateway.ts:58)：provider I/O 前拒绝不合规候选，fallback 前也先做 clearance。
- [kernel semantic escalation (line 52)](E:\\Claude_Projects\\Projects\\Fairy\\OpenFairy\\packages\\kernel\\src\\governance.ts:52)：table-driven raise-only。
- [TurnRunner integration (line 386)](E:\\Claude_Projects\\Projects\\Fairy\\OpenFairy\\packages\\kernel\\src\\index.ts:386)：MemoryGate、route.denied、labels 贯穿事件/工具/模型请求。
- [MemoryGate v0 (line 36)](E:\\Claude_Projects\\Projects\\Fairy\\OpenFairy\\packages\\memory\\src\\index.ts:36)：`allow | deny | hold`，显式 remember 候选。
- [gateway labels/history wiring (line 647)](E:\\Claude_Projects\\Projects\\Fairy\\OpenFairy\\apps\\gateway\\src\\server.ts:647)：profile 默认 labels、客户端 labels、语义升级、history 污染追踪。
- [replay trust visibility (line 111)](E:\\Claude_Projects\\Projects\\Fairy\\OpenFairy\\apps\\cli\\src\\replay.ts:111)。
- [kernel provider guard (line 18)](E:\\Claude_Projects\\Projects\\Fairy\\OpenFairy\\packages\\kernel\\test\\provider-guard.test.ts:18)。
- `pnpm-lock.yaml` 更新：`@fairy/kernel` 新增 `@fairy/memory` workspace 依赖。

**2. Verification Tails**
全部本地通过：

- `pnpm install`
- `pnpm lint`
- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm dep-check`
- `pnpm conformance`

Mock conformance：18/18 PASS，JSON verdict 现在包含 per-case `status: "pass"`。
CI：本地无法直接确认 GitHub Actions 状态，需 push 后看远端。

**3. Decisions**

- Governance config：默认 `profile: balanced`，`home_regions: [cn]`。
- Profile defaults：balanced=`internal/global-ok`，sovereign=`personal/local-only`，cloud-friendly=`personal/global-ok`。
- Clearance：sensitivity 按 `public < internal < personal < secret`；residency 是硬约束，`region-restricted` 要求 provider `regions ⊆ home_regions`，local trivially qualifies。
- Route denied：无合规候选时 emit `route.denied` + safe `turn.final`，且 disallowed provider 请求数为 0；有合规 fallback 时记录 `progress.update stage=route-denied` 和 `model_trace.denied_candidates`。
- MemoryGate：显式 remember 才生成候选；secret 默认 deny；personal 默认 hold；internal/public 默认 allow；不做 retrieval、不注入 prompt。

**4. Spec Ambiguities**

- live tool-call conformance 的 `degraded` 是否应影响进程 exit code：当前实现不把 “model_did_not_call_tool” 当 FAIL，但 JSON/table 明确不是 PASS。
- `route.denied` 在“有合规 fallback”时是否也必须 emit：当前按任务文字采用 progress/trace 可见，只有无路可走时 emit `route.denied`。
- append-only log 与 secret label 持久化边界仍需 reviewer 决定更细规则；当前保证 secret 不写入 memory，且不发给不合规 provider。

**5. Proposed Docs Edits**
供 reviewer 应用：

- `docs/specs/protocol.md`：`memory.gate.decision` decision enum 更新为 `allow | deny | hold`。
- `docs/specs/data-governance.md`：补 profile 默认 labels 和 route-denied fallback 记录语义。
- `docs/specs/memory.md`：补 MemoryGate v0 当前只 admission/events，不 retrieval、不 embeddings、不 prompt injection。

**6. Manual Owner Checklist**

```
pnpm conformance --model <deepseek-model-id> --config <path>
pnpm conformance --model <ollama-model-id> --config <path>
pnpm fairy replay <sid> --json --data-dir <data-dir>
```

手测再跑两类 chat turn：明显 secret 应 route denied 且 provider 0 请求；安全 “remember that ...” 应出现 `memory.gate.decision` + `memory.written`。