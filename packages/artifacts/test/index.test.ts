import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import { ArtifactRegistry, detectMime, hasAudioMagic, isSupportedAudioMime } from "../src/index.js";

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

  it("adds WAV input support without changing the content-addressed registry", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairy-artifacts-wav-"));
    const registry = new ArtifactRegistry(root);
    const audio = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
    const registered = await registry.register({
      content: audio,
      kind: "input",
      labels: { residency: "region-restricted", sensitivity: "personal" },
      mime: "audio/wav",
      origin: "voice:import-audio",
      sourceFilename: "input.wav"
    });

    expect(registered.record).toMatchObject({ kind: "input", mime: "audio/wav", size_bytes: audio.byteLength });
    expect(extname(registered.record.path)).toBe(".wav");
    expect(detectMime("input.wav")).toBe("audio/wav");
    expect(isSupportedAudioMime("audio/wav")).toBe(true);
    expect(hasAudioMagic(audio, "audio/wav")).toBe(true);
    expect(hasAudioMagic(Buffer.from("not wav"), "audio/wav")).toBe(false);
  });
});
