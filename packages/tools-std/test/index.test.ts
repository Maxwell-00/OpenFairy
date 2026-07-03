import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

  it("registers fs and web tools without requiring Docker", async () => {
    const { registry } = await makeRegistry();
    expect([...registry.keys()]).toEqual(expect.arrayContaining(["fs.read", "fs.write", "fs.list", "web.fetch", "web.search"]));
  });
});
