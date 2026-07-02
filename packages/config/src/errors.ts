import type { ErrorObject } from "ajv";

import type { ConfigIssue } from "./types.js";

const jsonPointerToPath = (pointer: string): string => {
  if (!pointer) {
    return "config";
  }

  return `config${pointer
    .split("/")
    .filter(Boolean)
    .map((part) => {
      const decoded = part.replace(/~1/g, "/").replace(/~0/g, "~");
      return /^\d+$/.test(decoded) ? `[${decoded}]` : `.${decoded}`;
    })
    .join("")}`;
};

const getAtPointer = (value: unknown, pointer: string): unknown => {
  if (!pointer) {
    return value;
  }

  return pointer
    .split("/")
    .filter(Boolean)
    .reduce<unknown>((current, part) => {
      if (current === undefined || current === null) {
        return undefined;
      }
      const decoded = part.replace(/~1/g, "/").replace(/~0/g, "~");
      return (current as Record<string, unknown>)[decoded];
    }, value);
};

const expectedFor = (error: ErrorObject): string => {
  switch (error.keyword) {
    case "required":
      return `required property ${(error.params as { missingProperty: string }).missingProperty}`;
    case "type":
      return String((error.params as { type: string }).type);
    case "enum":
      return `one of ${(error.params as { allowedValues: unknown[] }).allowedValues.join(", ")}`;
    case "const":
      return `constant ${JSON.stringify((error.params as { allowedValue: unknown }).allowedValue)}`;
    case "pattern":
      return `match pattern ${(error.params as { pattern: string }).pattern}`;
    case "minLength":
      return `length >= ${(error.params as { limit: number }).limit}`;
    case "minimum":
      return `value >= ${(error.params as { comparison: string; limit: number }).limit}`;
    default:
      return error.keyword;
  }
};

const gotFor = (value: unknown): string => {
  if (value === undefined) {
    return "missing";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null) {
    return "null";
  }
  return `${typeof value} ${JSON.stringify(value)}`;
};

export class ConfigValidationError extends Error {
  readonly issues: readonly ConfigIssue[];

  constructor(issues: readonly ConfigIssue[]) {
    super(`Invalid Fairy config:\n${issues.map((issue) => `- ${issue.path}: expected ${issue.expected}, got ${issue.got}`).join("\n")}`);
    this.name = "ConfigValidationError";
    this.issues = issues;
  }
}

export const formatAjvIssues = (errors: readonly ErrorObject[], data: unknown): ConfigIssue[] =>
  errors.map((error) => {
    const missingProperty =
      error.keyword === "required" ? (error.params as { missingProperty: string }).missingProperty : undefined;
    const instancePath = missingProperty ? `${error.instancePath}/${missingProperty}` : error.instancePath;
    const got = getAtPointer(data, instancePath);

    return {
      path: jsonPointerToPath(instancePath),
      expected: expectedFor(error),
      got: gotFor(got),
      message: error.message ?? error.keyword
    };
  });
