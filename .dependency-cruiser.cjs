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
