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
          context_window: { type: "integer", minimum: 1 },
          max_output: { type: "integer", minimum: 1 },
          capabilities: {
            type: "object",
            additionalProperties: true,
            properties: {
              tools: { type: "string", enum: ["native", "prompted", "none"] }
            }
          },
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
        required: ["id", "transport", "base_url", "model", "data_clearance"]
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
        },
        watchdog_s: { type: "number", exclusiveMinimum: 0 }
      },
      required: ["port", "auth"]
    },
    kernel: {
      type: "object",
      additionalProperties: true,
      properties: {
        max_tool_iterations: { type: "integer", minimum: 1 },
        system_prompt: { type: "string", minLength: 1 }
      },
      required: ["system_prompt"]
    },
    permissions: {
      type: "object",
      additionalProperties: true,
      properties: {
        ask_timeout_s: { type: "number", exclusiveMinimum: 0 },
        rules: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: true,
            properties: {
              channel_trust: { type: "string", enum: ["trusted", "untrusted"] },
              decision: { type: "string", enum: ["allow", "ask", "deny"] },
              path: { type: "string", minLength: 1 },
              provenance: { type: "string", minLength: 1 },
              tool: { type: "string", minLength: 1 },
              untrusted_content: { type: "boolean" }
            },
            required: ["tool", "decision"]
          }
        }
      },
      required: ["ask_timeout_s", "rules"]
    },
    context: {
      type: "object",
      additionalProperties: true,
      properties: {
        reduce_at: { type: "number", exclusiveMinimum: 0, maximum: 1 },
        output_reserve: { type: "integer", minimum: 1 },
        memory_digest_budget: { type: "integer", minimum: 1 },
        min_recent_turns: { type: "integer", minimum: 0 }
      },
      required: ["reduce_at", "min_recent_turns"]
    },
    persona: {
      oneOf: [
        { type: "string", enum: ["none"] },
        {
          type: "object",
          additionalProperties: true,
          properties: {
            enabled: { type: "boolean" },
            id: { type: "string", minLength: 1 },
            root: { type: "string", minLength: 1 }
          }
        }
      ]
    },
    affect: {
      type: "object",
      additionalProperties: true,
      properties: {
        enabled: { type: "boolean" }
      }
    },
    workspace: {
      type: "object",
      additionalProperties: true,
      properties: {
        root: { type: "string", minLength: 1 }
      }
    },
    search: {
      type: "object",
      additionalProperties: true,
      properties: {
        engine: {
          type: "object",
          additionalProperties: true,
          properties: {
            api_key_ref: { type: "string", pattern: "^secret://[A-Za-z0-9_.-]+$" },
            base_url: { type: "string", minLength: 1 },
            kind: { type: "string", enum: ["mock", "searx", "brave"] }
          },
          required: ["kind"]
        }
      },
      required: ["engine"]
    },
    governance: {
      type: "object",
      additionalProperties: true,
      properties: {
        profile: { type: "string", enum: ["balanced", "sovereign", "cloud-friendly"] },
        home_regions: { type: "array", items: { type: "string", minLength: 1 } },
        egress: {
          type: "object",
          additionalProperties: true,
          properties: {
            external_tools: { type: "array", items: { type: "string", minLength: 1 } },
            personal_allowed_tools: { type: "array", items: { type: "string", minLength: 1 } }
          }
        },
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
        profiles: { type: "object", additionalProperties: true },
        timeout_s: { type: "number", exclusiveMinimum: 0 }
      },
      required: ["image", "default_profile", "profiles", "timeout_s"]
    }
  },
  required: ["models", "roles", "gateway", "kernel", "permissions", "context", "search", "governance", "research", "sandbox"]
} as const;
