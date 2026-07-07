import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

import {
  artifactEventPayload,
  ArtifactRegistry,
  compactPerceptionText,
  detectMime,
  escalateLabelsForPerceptionText,
  labelsForFixture,
  MockPerceptionProvider,
  quarantinePerceptionText
} from "../src/index.js";

describe("@fairy/perception artifacts", () => {
  it("registers content-addressed artifacts without embedding blobs in event payloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairy-perception-artifacts-"));
    const registry = new ArtifactRegistry(root);
    const registered = await registry.register({
      content: "not a blob in jsonl",
      labels: { residency: "global-ok", sensitivity: "internal" },
      mime: "text/plain",
      origin: "user",
      sourceFilename: "note.txt"
    });

    expect(registered.created).toBe(true);
    expect(registered.record.artifact_id).toMatch(/^art_[a-f0-9]{20}$/);
    expect(registered.record.hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(relative(root, registered.record.path)).not.toMatch(/^\.\./);
    expect(registered.record.labels).toEqual({ residency: "global-ok", sensitivity: "internal" });
    expect(artifactEventPayload(registered.record)).not.toHaveProperty("content");
    expect(artifactEventPayload(registered.record)).not.toHaveProperty("bytes");
  });

  it("detects common MIME types and preserves fixture labels", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairy-perception-fixture-"));
    const registry = new ArtifactRegistry(root);
    const fixture = await registry.registerFixture("fake-api-key-image");

    expect(detectMime("screen.png")).toBe("image/png");
    expect(detectMime("doc.pdf")).toBe("application/pdf");
    expect(fixture.record.mime).toBe("image/png");
    expect(fixture.record.labels).toEqual(labelsForFixture("fake-api-key-image"));
  });

  it("keeps registered paths contained under the artifact root", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairy-perception-contained-"));
    const registry = new ArtifactRegistry(root);
    const registered = await registry.register({
      content: "hello",
      labels: { residency: "global-ok", sensitivity: "internal" },
      origin: "user",
      sourceFilename: "../escape.png"
    });

    expect(relative(root, registered.record.path)).not.toMatch(/^\.\./);
    await expect(registry.readText({ ...registered.record, path: join(root, "..", "escape.txt") })).rejects.toThrow(/escapes/);
  });
});

describe("@fairy/perception mock provider", () => {
  it("produces deterministic descriptions, OCR, and document extraction", async () => {
    const root = await mkdtemp(join(tmpdir(), "fairy-perception-provider-"));
    const registry = new ArtifactRegistry(root);
    const provider = new MockPerceptionProvider();
    const image = (await registry.registerFixture("bilingual-text-image")).record;
    const document = (await registry.registerFixture("simple-document")).record;

    const first = await provider.describe(image, { question: "What text is visible?" });
    const second = await provider.describe(image, { question: "What text is visible?" });
    const ocr = await provider.ocr(image);
    const extracted = await provider.extractDocument(document);

    expect(first).toEqual(second);
    expect(ocr.ocr_text).toContain("\u4f60\u597d");
    expect(extracted.ocr_text).toContain("simple document fixture");
    expect(compactPerceptionText(ocr)).toContain("perception.ocr");
    expect(quarantinePerceptionText("perception:test", compactPerceptionText(ocr))).toContain("FAIRY QUARANTINE BEGIN");
  });

  it("raises labels for OCR text containing a fake API key", () => {
    const escalated = escalateLabelsForPerceptionText("API_KEY=sk_test_1234567890abcdef", {
      residency: "global-ok",
      sensitivity: "internal"
    });

    expect(escalated).toMatchObject({
      escalated: true,
      labels: { residency: "local-only", sensitivity: "secret" },
      reason: "ocr_secret_pattern"
    });
  });
});
