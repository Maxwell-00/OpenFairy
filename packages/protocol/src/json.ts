import { readFileSync } from "node:fs";

export const readJsonFile = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

const normalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)])
    );
  }

  return value;
};

export const stableStringify = (value: unknown): string => `${JSON.stringify(normalize(value), null, 2)}\n`;
