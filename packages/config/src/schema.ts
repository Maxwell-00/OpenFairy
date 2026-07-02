export const configSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: true,
  properties: {
    models: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { type: "string", minLength: 1 },
          transport: { type: "string", enum: ["openai-chat", "openai-responses", "anthropic"] },
          base_url: { type: "string", minLength: 1 },
          api_key_ref: { type: "string", pattern: "^secret://[A-Za-z0-9_.-]+$" },
          model: { type: "string", minLength: 1 },
          capabilities: { type: "object", additionalProperties: true },
          pricing: { type: "object", additionalProperties: true },
          data_clearance: {
            type: "object",
            additionalProperties: true,
            properties: {
              max_sensitivity: { type: "string", enum: ["public", "internal", "personal", "secret"] },
              residency: {
                type: "array",
                items: { type: "string", enum: ["local-only", "region-restricted", "global-ok"] }
              },
              regions: { type: "array", items: { type: "string", minLength: 1 } }
            },
            required: ["max_sensitivity", "residency"],
            allOf: [
              {
                if: {
                  properties: {
                    residency: { contains: { const: "region-restricted" } }
                  },
                  required: ["residency"]
                },
                then: {
                  required: ["regions"]
                }
              }
            ]
          },
          tags: { type: "array", items: { type: "string" } }
        },
        required: ["id", "transport", "model"]
      }
    },
    roles: {
      type: "object",
      additionalProperties: {
        type: "object",
        additionalProperties: true,
        properties: {
          model: { type: "string", minLength: 1 },
          fallback: { type: "array", items: { type: "string", minLength: 1 } },
          max_cost_per_call: { type: "number", minimum: 0 },
          max_latency_ms: { type: "integer", minimum: 1 }
        },
        required: ["model"]
      }
    },
    gateway: {
      type: "object",
      additionalProperties: true,
      properties: {
        port: { type: "integer", minimum: 0, maximum: 65535 },
        data_dir: { type: "string", minLength: 1 },
        auth: {
          type: "object",
          additionalProperties: true,
          properties: {
            token: {
              type: "string",
              anyOf: [
                { minLength: 1 },
                { pattern: "^secret://[A-Za-z0-9_.-]+$" }
              ]
            }
          },
          required: ["token"]
        }
      },
      required: ["port", "auth"]
    },
    governance: {
      type: "object",
      additionalProperties: true,
      properties: {
        home_regions: { type: "array", items: { type: "string", minLength: 1 } },
        categories: {
          type: "object",
          additionalProperties: {
            type: "object",
            additionalProperties: true,
            properties: {
              sensitivity: { type: "string", enum: ["public", "internal", "personal", "secret"] },
              residency: { type: "string", enum: ["local-only", "region-restricted", "global-ok"] },
              patterns: { type: "array", items: { type: "string" } },
              domains: { type: "array", items: { type: "string" } }
            },
            required: ["sensitivity"]
          }
        }
      },
      required: ["home_regions", "categories"]
    },
    research: {
      type: "object",
      additionalProperties: true,
      properties: {
        engines: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true,
            properties: {
              id: { type: "string", minLength: 1 },
              kind: { type: "string", minLength: 1 },
              weight: { type: "number", minimum: 0 },
              locale: { type: "string" }
            },
            required: ["id", "kind"]
          }
        },
        budgets: { type: "object", additionalProperties: true },
        domains: { type: "object", additionalProperties: true },
        snapshots: { type: "object", additionalProperties: true }
      },
      required: ["engines", "budgets", "domains", "snapshots"]
    },
    sandbox: {
      type: "object",
      additionalProperties: true,
      properties: {
        image: { type: "string", minLength: 1 },
        default_profile: { type: "string", enum: ["safe", "dev", "trusted"] },
        profiles: { type: "object", additionalProperties: true }
      },
      required: ["image", "default_profile", "profiles"]
    }
  },
  required: ["models", "roles", "gateway", "governance", "research", "sandbox"]
} as const;
