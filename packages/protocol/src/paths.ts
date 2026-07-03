import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

export const protocolRoot = resolve(here, "..");
export const schemasDir = resolve(protocolRoot, "schemas");
export const framesDir = resolve(protocolRoot, "frames");
export const fixturesDir = resolve(protocolRoot, "fixtures");
