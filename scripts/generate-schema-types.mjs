import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileFromFile } from "json-schema-to-typescript";

const repoRoot = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const protocolRoot = join(repoRoot, "packages", "protocol");
const schemasDir = join(protocolRoot, "schemas");
const outPath = join(protocolRoot, "src", "generated", "schema-types.ts");

const schemaFiles = readdirSync(schemasDir)
  .filter((file) => file.endsWith(".v1.json") && file !== "registry.v1.json")
  .sort();

const chunks = [
  "/* This file is generated from packages/protocol/schemas/*.json. */\n"
];

for (const file of schemaFiles) {
  const compiled = await compileFromFile(join(schemasDir, file), {
    bannerComment: "",
    style: { semi: true, singleQuote: false },
    unreachableDefinitions: false
  });
  chunks.push(compiled);
}

mkdirSync(join(protocolRoot, "src", "generated"), { recursive: true });
writeFileSync(outPath, chunks.join("\n"));
console.log(`Generated schema TS types for ${schemaFiles.length} protocol events.`);
