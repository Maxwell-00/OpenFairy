import { join } from "node:path";

import { readJsonFile } from "./json.js";
import { schemasDir } from "./paths.js";
import type { EventRegistryEntry } from "./types.js";

interface RegistryManifest {
  readonly protocol_version: 1;
  readonly event_types: readonly {
    readonly family: string;
    readonly type: string;
  }[];
}

const isRegistryManifest = (value: unknown): value is RegistryManifest =>
  Boolean(
    value &&
      typeof value === "object" &&
      "protocol_version" in value &&
      "event_types" in value &&
      Array.isArray((value as RegistryManifest).event_types)
  );

const manifestPath = join(schemasDir, "registry.v1.json");
const manifest = readJsonFile(manifestPath);

if (!isRegistryManifest(manifest)) {
  throw new Error(`Invalid protocol registry manifest at ${manifestPath}`);
}

export const protocolVersion = manifest.protocol_version;

export const eventRegistry: readonly EventRegistryEntry[] = manifest.event_types.map((entry) => ({
  family: entry.family,
  type: entry.type,
  schemaFile: `${entry.type}.v1.json`
}));

export const eventTypes: readonly string[] = eventRegistry.map((entry) => entry.type);

const eventTypeSet = new Set(eventTypes);

export const isRegisteredEventType = (type: string): boolean => eventTypeSet.has(type);

export const getSchemaPath = (type: string): string => join(schemasDir, `${type}.v1.json`);
