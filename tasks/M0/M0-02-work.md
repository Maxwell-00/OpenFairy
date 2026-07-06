已完成 M0-02，工作目录：`E:\Claude_Projects\Projects\Fairy\OpenFairy`。M0 的“空但接线完整 gateway + mock client conformance”已经落地。

**1. File Tree Delta**
新增/主要改动：

```
apps/gateway/
  src/bin/gateway.ts
  src/config.ts
  src/dev/echo-responder.ts
  src/event-log.ts
  src/server.ts
  tsconfig.build.json

packages/testing/
  src/mock-client.ts
  test/gateway.e2e.test.ts
  vitest.config.ts

packages/config/
  README.md
  defaults.yaml
  src/loader.ts
  src/schema.ts

scripts/start-gateway.mjs
```

另外更新了 `apps/cli` 的 `doctor`、`packages/protocol` build 输出配置、`pnpm-lock.yaml`，并加入唯一新增依赖：`ws` + `@types/ws`。

**2. Verification Tails**

```
pnpm install
Already up to date
Done in 265ms using pnpm v11.7.0

pnpm lint
$ eslint . --max-warnings=0

pnpm -r typecheck
packages/testing typecheck: Done
apps/gateway typecheck: Done

pnpm -r test
packages/protocol test: Tests 100 passed (100)
packages/testing test: Test Files 2 passed (2)
packages/testing test: Tests 2 passed (2)

pnpm dep-check
✔ no dependency violations found (54 modules, 78 dependencies cruised)

pnpm doctor
Gateway: not running on 127.0.0.1:8787 (ok for M0)
```

Gateway start path also verified:

```
{
  "health": {
    "gateway_version": "0.0.0-m0",
    "protocol_version": 1,
    "status": "ok",
    "uptime_s": 0
  },
  "meta": {
    "protocol_version": 1,
    "echo_responder": true
  }
}
```

E2E runs locally on Windows and is wired into `pnpm -r test`, so GitHub Actions will run it on both `windows-latest` and `ubuntu-latest`. I did not trigger remote CI because no commit/push was requested.

**3. Decisions Made**

- WS client messages use small ops: `session.create`, `turn.input`, `event`; outbound stream is raw canonical envelopes.
- `gateway.auth.token` defaults to `dev-token` for M0 localhost-only boot.
- `secret://name` gateway token resolution is dev-only env lookup: `name`, normalized uppercase, or `FAIRY_SECRET_NAME`.
- `gateway.port: 0` is allowed for ephemeral e2e ports.
- Session logs are compact JSONL, one envelope per line.
- Echo responder lives only in `apps/gateway/src/dev/echo-responder.ts` and is documented as M1 replacement point.

**4. Spec Ambiguities Found**

- Protocol spec does not define the concrete WS client command envelope.
- `session.created` exists as an event, but the client “create session” request shape is not specified.
- Token auth placement is not specified; I accepted query `?token=` and `Authorization: Bearer`.
- “labels default sourced from config default” has no exact config key yet; M0 uses `internal/global-ok`.
- `secret://` edge resolution naming is not specified.

**5. Proposed Doc Edits**

- ARCHITECTURE §10: add exact config discovery order from M0-02.
- Protocol §7: define WS client ops and outbound raw-envelope stream.
- Sandbox-security §7: specify token auth locations and 4401 close behavior.
- Add a short M0 note that default `dev-token` is localhost-only and not production auth.

**6. Suggested M1 First Slice**
Replace the one-line echo responder wiring with the real `TurnRunner`, then add CLI chat over WS, append-only session resume/readback, and the first minimal `web.search`/`web.fetch` + sandboxed `shell` path.