import js from "@eslint/js";
import tseslint from "typescript-eslint";

const nodeGlobals = {
  AbortController: "readonly",
  Buffer: "readonly",
  URL: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  fetch: "readonly",
  process: "readonly",
  setTimeout: "readonly"
};

export default tseslint.config(
  {
    ignores: [
      ".auto-memory/**",
      "ChatGPT_Suggestions/**",
      "coverage/**",
      "dist/**",
      "docs-zh/**",
      "node_modules/**",
      "apps/*/dist/**",
      "packages/*/dist/**",
      "packages/protocol/fixtures/**",
      "packages/protocol/schemas/**",
      "pnpm-lock.yaml"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: nodeGlobals,
      sourceType: "module"
    }
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      globals: {
        module: "readonly",
        require: "readonly"
      },
      sourceType: "script"
    }
  },
  {
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { "fixStyle": "inline-type-imports" }
      ]
    }
  }
);
