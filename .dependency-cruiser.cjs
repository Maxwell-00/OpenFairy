/** @type {import("dependency-cruiser").IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "protocol-imports-no-workspace-packages",
      severity: "error",
      comment: "packages/protocol is the canon and must not depend on other workspace packages.",
      from: { path: "^packages/protocol" },
      to: {
        path: "^(packages|apps)/",
        pathNot: "^packages/protocol"
      }
    },
    {
      name: "kernel-does-not-import-channels-or-apps",
      severity: "error",
      comment: "The kernel cannot depend on channel adapters or app composition roots.",
      from: { path: "^packages/kernel" },
      to: { path: "^(packages/channels|apps)/" }
    },
    {
      name: "research-no-model-gateway",
      severity: "error",
      comment: "Research planning and source mechanics stay deterministic and must not import the model gateway.",
      from: { path: "^packages/research" },
      to: { path: "^(packages/model-gateway|@fairy/model-gateway)(/|$)" }
    },
    {
      name: "vendor-sdks-only-in-model-gateway-or-speech-workers",
      severity: "error",
      comment: "Vendor SDK usage is confined to model-gateway transports and speech worker adapters.",
      from: {
        pathNot: "^(packages/model-gateway|workers/speech)/"
      },
      to: {
        dependencyTypes: ["npm"],
        path: "^(openai|@anthropic-ai/|anthropic|@google/generative-ai|groq-sdk|mistralai|ollama)(/|$)"
      }
    }
  ],
  options: {
    doNotFollow: {
      path: "node_modules"
    },
    exclude: {
      path: "(^|/)(dist|coverage|node_modules)/"
    },
    enhancedResolveOptions: {
      conditionNames: ["import", "types", "node"],
      exportsFields: ["exports"],
      mainFields: ["module", "main", "types"]
    },
    tsPreCompilationDeps: true
  }
};
