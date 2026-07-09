# M3-03 Brief Gate — WebSocket speech transport skeleton + loopback conformance

Gate date: 2026-07-09
Reviewer role: task-brief gate (spec fidelity + invariants). **Not** an implementation review — M3-03 is unbuilt.
Brief under review: `tasks/M3-03-websocket-speech-transport.md` (ChatGPT draft, committed at HEAD `f6e971f`)
Repo state: M3-02 closed (`fe8afc3` delivered, countersigned; docs pass landed at `acab510`).

Method: gated inline (evidence held from the M3-01/M3-02 gates and countersigns; two decisive checks verified directly at HEAD — the gateway already uses the `ws` library (`apps/gateway/src/server.ts:21`, `WebSocketServer` at `:348`) and already carries token auth machinery (`Bearer`/`?token=` vs `authToken`, close `4401`; `:520-521`)).

---

## Verdict

**ACCEPTED WITH REQUIRED EDITS — edits applied in place.**

The draft is well-scoped and threads everything it should: the two-stream FIFO interleave carry-in from the M3-02 countersign (its own deliverable, with real non-vacuity requirements — "fails if ordering is global-only", "fails if stream ids are ignored"), the frame contract reused via the M3-02 validator with an explicit "do not fork the mock-worker behavior stack" clause, the `additionalProperties` config sharp edge remembered unprompted, the single `#submitVoiceFinalTranscript`→`#acceptTurnInput` path named, suite naming conventional (`voice.websocket-transport-v0`), owner-check N/A convention kept, loopback-only + no-external-network boundaries stated, and no M2 deferral landing gate triggered (no vector work; S4 keeps accumulating toward M4 entry on its own).

Five edits were required. Two matter for trust; the sockets-cross-a-real-boundary nature of this slice is exactly where a skeleton's shortcuts become standing holes.

## BLOCKER

None.

---

## REQUIRED EDITS (applied in place)

### RE-1 — Binary framing must reconcile with voice-pipeline §2 (MED)

§2 specifies the binary subprotocol as "**4-byte channel id + payload**" — a compact channel-prefix framing designed for 20 ms Opus streams. The draft suggests a different shape (4-byte header length + UTF-8 JSON header + payload) without mentioning §2's. Same divergence class as M3-01's payload shapes and M3-02's frame names — third time, same drafter, same fix: silent divergence is not acceptable, recorded supersession is. Edit: the voice-pipeline docs proposal must either implement §2's framing or record the JSON-header envelope as the v0 conformance shape with the compact framing explicitly reserved for the real-audio slice.

### RE-2 — No unauthenticated listener, even on loopback (HIGH, trust)

The draft said "No TLS/auth/client productization in this slice." TLS, yes — but an **unauthenticated** WS endpoint that accepts frames triggering real turns (model calls, MemoryGate admissions, egress attempts) is a standing door into Fairy sessions for any local process, and skeleton code outlives its slice. The fix is nearly free: the gateway's token auth already exists (`:520-521`). Edit: the voice WS endpoint enforces the gateway token (or an ephemeral per-run token) on connect; unauthenticated connect closes `4401` with zero frames processed; acceptance adds a wrong-token/no-token rejection test asserting zero frames handled and zero session events emitted.

### RE-3 — Loopback binding hard-coded; `allow_external_hosts` removed (MED)

The draft's suggested config included `allow_external_hosts: false`. A config key that can widen the binding is a bigger hole than no key: it turns "loopback-only" from a code property into a one-line YAML change, ungated. Edit: binding is hard-coded `127.0.0.1` this slice, no host/interface key or flag exists; exposing a non-loopback voice listener is a future slice with its own TLS + auth design and its own gate. Boundary added.

### RE-4 — One WebSocket library in the workspace (LOW)

The gateway already depends on `ws`. Edit: reuse it — no second WebSocket library; client side may use Node's builtin `WebSocket` if cleaner; no native-build dependency (so no `pnpm approve-builds` cascade).

### RE-5 — Deadline + port hygiene (LOW; standing rule §5.4 class)

Sockets are exactly where tests hang. Edit: every test await on socket open/message/close/server-listen carries its own explicit timeout, failing fast with a named error rather than at the vitest global timeout; ephemeral ports only (bind `0`, read the assigned port — no fixed port numbers; Windows CI collision hygiene); servers closed in `afterEach`/`finally`.

---

## CARRY-IN

- Two-stream audio FIFO interleave test (this seat's M3-02 countersign note) — threaded by the draft itself as Deliverable 6. Discharged at gate level; verify at countersign.
- M2 deferral landing gates: none lands at M3-03.

## NIT

- `fairy voice ws` as the CLI verb is fine alongside `loopback`/`duplex`.
- Deliverable 3's "no second mock-worker behavior path diverges silently" is a good self-imposed guard — countersign will hold it to that (the WS path should wrap `MockSpeechDuplexWorker`, not reimplement it).
- If the endpoint is mounted on the existing gateway HTTP server rather than a separate listener, RE-2's auth comes nearly free and RE-3 is inherited — a reasonable implementation choice, Codex's call.

---

## Reviewer-gate clauses for the delivery countersign

1. Binary-framing reconciliation vs §2 present in the docs proposal (implemented shape + what is reserved). (RE-1)
2. Auth on connect: wrong/no token ⇒ close `4401`, zero frames processed, zero session events — test quoted; no unauthenticated frame-handling path exists. (RE-2)
3. Loopback binding hard-coded; grep confirms no host/interface config key, flag, or parameter. (RE-3)
4. Single `ws` library (gateway's); no native-build deps; no vendor SDK. (RE-4)
5. Socket awaits carry explicit deadlines; ephemeral ports only; clean handle shutdown (no dangling servers on Windows CI). (RE-5)
6. Two-stream interleave test non-vacuous per Deliverable 6's own criteria (fails on global-only ordering; fails on ignored stream ids; ≥2 streams × ≥3 frames).
7. Standing invariants: one TurnRunner; single voice→turn construction site preserved; frames/binary never in JSONL (`voice.ws.*`/`voice.frame.*`/`speech.worker.*` grep clean); label clamp on emitted events; corrupt-tail byte-identical; no repo-tree writes; tsx world; weakening scan on all pre-existing test files; mock worker reused, not forked.

## Dispatch instruction

Owner: diff both files (`tasks/M3-03-websocket-speech-transport.md` patched in place, this gate record new), commit via GitHub Desktop, then dispatch the patched brief to Codex. RE-2/RE-3 are the ones to care about: this is the first slice where voice crosses a real OS boundary, and the difference between "test scaffolding" and "standing unauthenticated door" is exactly the two clauses the draft was missing. With the edits in, this is a well-cut third M3 slice — dispatch-ready.
