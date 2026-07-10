import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { ArtifactRegistry, detectMime } from "../src/index.js";

describe("@fairy/artifacts", () => {
  it("registers speech MP3 bytes in the moved content-addressed registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairy-artifacts-speech-"));
    const registry = new ArtifactRegistry(root);
    const audio = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const registered = await registry.register({
      content: audio,
      kind: "speech",
      labels: { residency: "region-restricted", sensitivity: "personal" },
      mime: "audio/mpeg",
      origin: "speech:tts",
      sourceFilename: "speech.mp3"
    });

    expect(registered.record.kind).toBe("speech");
    expect(registered.record.mime).toBe("audio/mpeg");
    expect(extname(registered.record.path)).toBe(".mp3");
    expect(relative(root, registered.record.path)).not.toMatch(/^\.\./);
    expect(await readFile(registered.record.path)).toEqual(audio);
    expect(detectMime("voice.mp3")).toBe("audio/mpeg");
  });
});
