import { existsSync } from "node:fs";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { createStandardToolRegistry, PolicyError } from "../src/index.js";

const makeRegistry = async () => {
  const root = await mkdtemp(join(tmpdir(), "fairy-tools-"));
  const artifactsDir = join(root, ".artifacts");
  await mkdir(artifactsDir, { recursive: true });
  return {
    artifactsDir,
    registry: createStandardToolRegistry({ artifactsDir, env: {}, workspaceRoot: root }),
    root
  };
};

const hasDocker = (): boolean => spawnSync("docker", ["--version"], { timeout: 2000, windowsHide: true }).status === 0;

describe("@fairy/tools-std", () => {
  it("reads, writes, and lists workspace files", async () => {
    const { artifactsDir, registry, root } = await makeRegistry();
    const ctx = { artifactsDir, env: {}, workspaceRoot: root };

    await registry.get("fs.write")?.execute({ content: "hello", path: "notes/a.txt" }, ctx);
    const read = await registry.get("fs.read")?.execute({ path: "notes/a.txt" }, ctx);
    const list = await registry.get("fs.list")?.execute({ path: "notes" }, ctx);

    expect(read?.content).toBe("hello");
    expect(list?.content).toContain("a.txt");
  });

  it("rejects path escapes", async () => {
    const { artifactsDir, registry, root } = await makeRegistry();
    const ctx = { artifactsDir, env: {}, workspaceRoot: root };
    await writeFile(join(root, "inside.txt"), "ok");

    await expect(registry.get("fs.read")?.execute({ path: "../outside.txt" }, ctx)).rejects.toBeInstanceOf(PolicyError);
  });

  it.skipIf(process.platform === "win32")("rejects symlink escapes", async () => {
    const { artifactsDir, registry, root } = await makeRegistry();
    const ctx = { artifactsDir, env: {}, workspaceRoot: root };
    const outside = join(dirname(root), "outside-secret.txt");
    await writeFile(outside, "secret");
    await symlink(outside, join(root, "escape-link.txt"));

    await expect(registry.get("fs.read")?.execute({ path: "escape-link.txt" }, ctx)).rejects.toBeInstanceOf(PolicyError);
  });

  // Probe uses a fixed-IP TCP connect with its own deadline: DNS-based probes are
  // nondeterministic under --network none (glibc resolver waits up to 5 s per
  // nameserver depending on the runner's resolv.conf — caused a CI flake).
  // Generous vitest timeout covers container cold-start weather on shared runners.
  it.skipIf(!hasDocker() || process.platform === "win32")("runs safe shell profile without network", { timeout: 60_000 }, async () => {
    const { artifactsDir, registry, root } = await makeRegistry();
    const ctx = { artifactsDir, env: {}, workspaceRoot: root };
    const shell = registry.get("shell.run");

    await expect(shell?.execute({
      command: "node -e \"const s=require('node:net').connect({host:'1.1.1.1',port:80,timeout:1500});s.on('error',()=>process.exit(0));s.on('timeout',()=>{s.destroy();process.exit(0)});s.on('connect',()=>process.exit(1))\"",
      profile: "safe"
    }, ctx)).resolves.toMatchObject({ provenance: "tool:shell.run" });
  });

  it.skipIf(!hasDocker() || process.platform === "win32")("keeps writes outside /workspace inside the container", { timeout: 60_000 }, async () => {
    const { artifactsDir, registry, root } = await makeRegistry();
    const ctx = { artifactsDir, env: {}, workspaceRoot: root };
    const marker = `fairy-sandbox-${process.pid}-${Date.now()}`;
    const shell = registry.get("shell.run");

    await shell?.execute({ command: `printf container-only > /tmp/${marker}`, profile: "safe" }, ctx);

    expect(existsSync(join(tmpdir(), marker))).toBe(false);
  });

  it("registers fs and web tools without requiring Docker", async () => {
    const { registry } = await makeRegistry();
    expect([...registry.keys()]).toEqual(expect.arrayContaining(["fs.read", "fs.write", "fs.list", "web.fetch", "web.search", "research.plan", "research.search", "research.fetch", "research.cite", "research.sources"]));
  });

  it("runs research tools with quarantined snapshots, citations, and source reviews", async () => {
    const { artifactsDir, registry, root } = await makeRegistry();
    const ctx = { artifactsDir, env: { CI: "true" }, workspaceRoot: root };

    const plan = await registry.get("research.plan")?.execute({ intent: "compare local memory with external services" }, ctx);
    expect(plan).toMatchObject({ provenance: "tool:research.plan", labels: { sensitivity: "public", residency: "global-ok" } });

    const search = await registry.get("research.search")?.execute({ plan_or_query: JSON.parse(plan?.content ?? "{}") }, ctx);
    const searchBody = JSON.parse(search?.content ?? "{}") as { sources: { id: string; canonical_url: string; grade: string }[] };
    expect(search).toMatchObject({ provenance: "tool:research.search" });
    expect(searchBody.sources.some((source) => source.canonical_url === "https://docs.openfairy.test/research/memory-store")).toBe(true);

    const source = searchBody.sources.find((item) => item.grade === "official") ?? searchBody.sources[0];
    const fetched = await registry.get("research.fetch")?.execute({ url_or_source_id: source?.id }, ctx);
    expect(fetched).toMatchObject({
      labels: { sensitivity: "public", residency: "global-ok" },
      provenance: "tool:research.fetch"
    });
    expect(fetched?.content).toContain("FAIRY QUARANTINE BEGIN");
    expect(fetched?.events?.[0]).toMatchObject({
      provenance: "web:docs.openfairy.test",
      type: "snapshot.created"
    });

    const snapshotId = fetched?.metadata?.snapshot_id;
    expect(typeof snapshotId).toBe("string");
    const cited = await registry.get("research.cite")?.execute({
      claim: "Fairy memory is rebuildable.",
      snapshot_id: snapshotId,
      span: { start: 0, end: 80 }
    }, ctx);
    expect(cited?.events?.[0]).toMatchObject({
      provenance: "web:docs.openfairy.test",
      type: "citation.recorded"
    });

    const sources = await registry.get("research.sources")?.execute({}, ctx);
    expect(sources?.events?.[0]).toMatchObject({
      provenance: "tool:research.sources",
      type: "sourceset.reviewed"
    });
    expect(sources?.content).toContain("independence_key");
  });
});
