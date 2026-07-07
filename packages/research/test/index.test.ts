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
  sourceFromSearchResult,
  type ResearchProvider
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

  it("fans escaped Chinese research and memory intent out unchanged", () => {
    const intent = `OpenFairy ${"\u8c03\u7814"} ${"\u8bb0\u5fc6"} system design`;
    const plan = createResearchPlan(intent);

    expect(plan.subqueries.map((item) => item.locale)).toEqual(["zh", "en"]);
    expect(plan.subqueries[0]?.query).toBe(intent);
    expect(plan.subqueries[1]?.query).toContain("memory system");
  });

  it("adds Chinese local coverage for China-related English intents", () => {
    const plan = createResearchPlan("China-local AI companion memory design");

    expect(plan.subqueries.map((item) => item.locale)).toContain("zh");
  });

  it("keeps plain-English intents without China-local signals on en-only subqueries", () => {
    const plan = createResearchPlan("compare local memory with hosted companion services");

    expect(plan.subqueries.map((item) => item.locale)).toEqual(["en"]);
    expect(plan.subqueries).toHaveLength(1);
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

  it("counts three deduped sources across two independence families", () => {
    const store = new ResearchStore("unused");
    const sources = dedupeSources([
      sourceFromSearchResult({
        grade: "news",
        independence_key: "wire:shared-family",
        snippet: "wire story version alpha with unique wording",
        title: "Wire Alpha",
        url: "https://alpha.example.test/wire"
      }, { engine: "mock" }),
      sourceFromSearchResult({
        grade: "news",
        independence_key: "wire:shared-family",
        snippet: "wire story version beta with different wording",
        title: "Wire Beta",
        url: "https://beta.example.test/wire"
      }, { engine: "mock" }),
      sourceFromSearchResult({
        grade: "official",
        snippet: "primary official source with separate provenance",
        title: "Official",
        url: "https://official.example.test/policy"
      }, { engine: "mock" })
    ]);

    const review = store.reviewSources(sources);

    expect(sources).toHaveLength(3);
    expect(review.independent_family_count).toBe(2);
    expect(review.sources.filter((source) => source.independence_key === "wire:shared-family")).toHaveLength(2);
    expect(review.warnings).not.toContain("single_source_family");
  });

  it("warns only when multiple deduped sources share one independence family", () => {
    const store = new ResearchStore("unused");
    const sameFamily = [
      sourceFromSearchResult({
        grade: "news",
        independence_key: "wire:one-family",
        snippet: "first outlet with unique words",
        title: "Outlet One",
        url: "https://one.example.test/story"
      }, { engine: "mock" }),
      sourceFromSearchResult({
        grade: "news",
        independence_key: "wire:one-family",
        snippet: "second outlet with different words",
        title: "Outlet Two",
        url: "https://two.example.test/story"
      }, { engine: "mock" })
    ];
    const twoFamilies = [
      sameFamily[0]!,
      sourceFromSearchResult({
        grade: "official",
        snippet: "independent official source",
        title: "Official",
        url: "https://official.example.test/story"
      }, { engine: "mock" })
    ];

    expect(store.reviewSources(sameFamily).warnings).toContain("single_source_family");
    expect(store.reviewSources(twoFamilies).warnings).not.toContain("single_source_family");
  });

  it("preserves override-assigned shared independence keys across hosts through search", async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), "fairy-research-family-override-"));
    const store = new ResearchStore(artifactsDir);
    const provider: ResearchProvider = {
      id: "override-provider",
      async fetch() {
        throw new Error("not used");
      },
      async search() {
        return [
          {
            independence_key: "wire:override-family",
            snippet: "first host carries a distinct body",
            title: "First Host",
            url: "https://first-host.example.test/a"
          },
          {
            independence_key: "wire:override-family",
            snippet: "second host carries different wording",
            title: "Second Host",
            url: "https://second-host.example.test/b"
          }
        ];
      }
    };

    const result = await store.search("shared family", provider);
    const review = store.reviewSources(result.sources);

    expect(result.sources).toHaveLength(2);
    expect(result.sources.map((source) => source.independence_key)).toEqual(["wire:override-family", "wire:override-family"]);
    expect(review.independent_family_count).toBe(1);
    expect(review.warnings).toContain("single_source_family");
  });

  it("ships seeded shared-key wire fixtures with distinct canonical URLs and bodies", async () => {
    const provider = new MockResearchProvider();
    const first = await provider.fetch("https://metro-wire-a.example.test/technology/local-memory-wire");
    const second = await provider.fetch("https://daily-wire-b.example.test/ai/assistant-memory-wire");

    expect(first.canonical_url).not.toBe(second.canonical_url);
    expect(first.body).not.toBe(second.body);
    expect(first.independence_key).toBe("wire:local-memory-policy");
    expect(second.independence_key).toBe("wire:local-memory-policy");
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

  it("writes an honest empty-text snapshot when the provider fetch throws", async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), "fairy-research-fetch-throw-"));
    const provider: ResearchProvider = {
      id: "throwing-provider",
      async fetch(url) {
        throw new Error(`provider exploded for ${url}`);
      },
      async search() {
        return [];
      }
    };
    const store = new ResearchStore(artifactsDir);

    const result = await store.fetchSnapshot("https://throws.example.test/page?utm_source=x", provider, {
      now: new Date("2026-07-02T10:00:00.000Z")
    });
    const snapshots = await store.listSnapshots();

    expect(result.cache_hit).toBe(false);
    expect(result.snapshot).toMatchObject({
      canonical_url: "https://throws.example.test/page",
      cleaning_method: "fetch-error-v1",
      engine: "throwing-provider",
      fetch_error: "provider exploded for https://throws.example.test/page?utm_source=x",
      retrieved_at: "2026-07-02T10:00:00.000Z",
      text: "",
      untrusted: true,
      url: "https://throws.example.test/page?utm_source=x"
    });
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.snapshot_id).toBe(result.snapshot.snapshot_id);
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

  it("reviews weak one-source sets without treating them as a same-family set", async () => {
    const artifactsDir = await mkdtemp(join(tmpdir(), "fairy-research-review-"));
    const store = new ResearchStore(artifactsDir);
    const review = store.reviewSources([
      sourceFromSearchResult({ grade: "blog", snippet: "", title: "Blog", url: "https://blog.example.test/a" }, { engine: "mock" })
    ]);

    expect(review.independent_family_count).toBe(1);
    expect(review.warnings).toEqual(["low_grade_only"]);
    expect(review.decision).toBe("needs_more_sources");
  });

  it("ships a five-page injection corpus", () => {
    expect(mockInjectionFixtureUrls()).toHaveLength(5);
  });
});
