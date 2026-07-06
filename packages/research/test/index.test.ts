import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  budgetForDepth,
  canonicalizeUrl,
  classifyRecency,
  createResearchPlan,
  dedupeSources,
  gradeSource,
  MockResearchProvider,
  mockInjectionFixtureUrls,
  ResearchStore,
  sourceFromSearchResult
} from "../src/index.js";

describe("@fairy/research planning", () => {
  it("builds deterministic plans with bounded budgets", () => {
    const first = createResearchPlan("compare local memory with external services", { depth: "quick" });
    const second = createResearchPlan("compare local memory with external services", { depth: "quick" });

    expect(first).toEqual(second);
    expect(first.budgets).toEqual({ fetches: 4, searches: 3 });
    expect(budgetForDepth("standard")).toEqual({ fetches: 20, searches: 12 });
    expect(budgetForDepth("deep")).toEqual({ fetches: 60, searches: 40 });
  });

  it("fans Chinese intents out to zh and en subqueries", () => {
    const plan = createResearchPlan("调研本地优先 AI companion 的记忆系统设计");

    expect(plan.subqueries.map((item) => item.locale)).toEqual(["zh", "en"]);
    expect(plan.subqueries[1]?.query).toContain("local-first");
  });

  it("adds Chinese local coverage for China-related English intents", () => {
    const plan = createResearchPlan("China-local AI companion memory design");

    expect(plan.subqueries.map((item) => item.locale)).toContain("zh");
  });

  it("classifies recency deterministically", () => {
    expect(classifyRecency("latest provider update 2026")).toBe("live");
    expect(classifyRecency("recent AI memory research")).toBe("recent");
    expect(classifyRecency("what is a citation ledger")).toBe("evergreen");
  });
});

describe("@fairy/research source mechanics", () => {
  it("canonicalizes URLs and removes tracking and AMP variants", () => {
    expect(canonicalizeUrl("HTTPS://AMP.Example.TEST/path/amp/?utm_source=x&b=2&a=1#frag")).toBe("https://example.test/path?a=1&b=2");
  });

  it("dedupes tracking variants and keeps duplicate counts", () => {
    const sources = dedupeSources([
      sourceFromSearchResult({ snippet: "", title: "A", url: "https://example.test/a?utm_source=x" }, { engine: "mock" }),
      sourceFromSearchResult({ snippet: "", title: "A", url: "https://example.test/a" }, { engine: "mock" })
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ duplicate_count: 2 });
  });

  it("collapses mirrored content signatures across different URLs", () => {
    const sources = dedupeSources([
      sourceFromSearchResult({ snippet: "same article body", title: "Mirror A", url: "https://mirror-a.test/article" }, { engine: "mock" }),
      sourceFromSearchResult({ snippet: "same article body", title: "Mirror B", url: "https://mirror-b.test/article" }, { engine: "mock" })
    ]);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({ duplicate_count: 2 });
  });

  it("grades by overrides and known domain heuristics", () => {
    expect(gradeSource("https://example.test/page", { overrides: { "example.test": "official" } })).toBe("official");
    expect(gradeSource("https://reddit.com/r/test")).toBe("forum");
    expect(gradeSource("https://x.com/openfairy")).toBe("sns");
  });

  it("keeps a seeded zh/en source family on the same canonical URL", async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), "fairy-research-parity-"));
    const provider = new MockResearchProvider();
    const store = new ResearchStore(artifactsDir);
    const zh = await store.search(createResearchPlan("调研本地优先 AI companion 的记忆系统设计"), provider);
    const en = await store.search(createResearchPlan("local-first AI companion memory system design"), provider);
    const zhCanonical = new Set(zh.sources.map((source) => source.canonical_url));

    expect(en.sources.some((source) => zhCanonical.has(source.canonical_url))).toBe(true);
    expect(en.sources.some((source) => source.grade === "official")).toBe(true);
    expect(zh.sources.some((source) => source.grade === "official")).toBe(true);
  });
});

describe("@fairy/research snapshots and citations", () => {
  it("stores stable content-addressed snapshots and hits cache within TTL", async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), "fairy-research-cache-"));
    const provider = new MockResearchProvider();
    const store = new ResearchStore(artifactsDir, { ttl: "7d" });

    const first = await store.fetchSnapshot("https://docs.openfairy.test/research/memory-store", provider, {
      now: new Date("2026-07-02T10:00:00.000Z")
    });
    const second = await store.fetchSnapshot("https://docs.openfairy.test/research/memory-store?utm_source=again", provider, {
      now: new Date("2026-07-03T10:00:00.000Z")
    });

    expect(first.cache_hit).toBe(false);
    expect(second.cache_hit).toBe(true);
    expect(second.snapshot.snapshot_id).toBe(first.snapshot.snapshot_id);
    expect(provider.fetches).toBe(1);
  });

  it("misses cache after TTL and refuses deny-listed domains without provider fetch", async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), "fairy-research-deny-"));
    const provider = new MockResearchProvider();
    const store = new ResearchStore(artifactsDir, { denyDomains: ["blocked.test"], ttl: "1d" });

    await store.fetchSnapshot("https://docs.openfairy.test/research/memory-store", provider, {
      now: new Date("2026-07-02T10:00:00.000Z")
    });
    const stale = await store.fetchSnapshot("https://docs.openfairy.test/research/memory-store", provider, {
      now: new Date("2026-07-05T10:00:00.000Z")
    });
    const denied = await store.fetchSnapshot("https://blocked.test/page", provider);

    expect(stale.cache_hit).toBe(false);
    expect(provider.fetches).toBe(2);
    expect(denied.snapshot.fetch_error).toBe("domain_denied");
    expect(provider.fetches).toBe(2);
  });

  it("validates citations and propagates source grade", async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), "fairy-research-cite-"));
    const provider = new MockResearchProvider();
    const store = new ResearchStore(artifactsDir);
    const { snapshot } = await store.fetchSnapshot("https://docs.openfairy.test/research/memory-store", provider);

    const citation = await store.cite("Fairy memory is rebuildable.", snapshot.snapshot_id, { start: 0, end: 80 });

    expect(citation).toMatchObject({
      grade: "official",
      source: { snapshot_ref: snapshot.snapshot_id }
    });
    await expect(store.cite("", snapshot.snapshot_id, { start: 0, end: 1 })).rejects.toThrow(/claim/);
    await expect(store.cite("Bad span", snapshot.snapshot_id, { start: 0, end: 999999 })).rejects.toThrow(/bounds/);
    await expect(store.cite("Missing", "snap_missing", { start: 0, end: 1 })).rejects.toThrow(/not found/);
  });

  it("reviews weak and single-family source sets", async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), "fairy-research-review-"));
    const store = new ResearchStore(artifactsDir);
    const review = store.reviewSources([
      sourceFromSearchResult({ grade: "blog", snippet: "", title: "Blog", url: "https://blog.example.test/a" }, { engine: "mock" })
    ]);

    expect(review.warnings).toEqual(expect.arrayContaining(["single_source_family", "low_grade_only"]));
    expect(review.decision).toBe("needs_more_sources");
  });

  it("ships a five-page injection corpus", () => {
    expect(mockInjectionFixtureUrls()).toHaveLength(5);
  });
});
