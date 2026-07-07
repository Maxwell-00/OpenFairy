import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const ignoredDirectories = new Set([".git", "coverage", "dist", "node_modules"]);
const scanRoots = ["packages", "apps"];
const sourcePattern = /^(?:packages|apps)\/[^/]+\/(?:src|test)\/.*\.ts$/u;
const protocolJsonPattern = /^packages\/protocol\/(?:schemas|fixtures)\/.*\.json$/u;
const replacementCharacter = "\uFFFD";
const nulByte = "\u0000";

const blockedFragments = [
  { name: "otp-mojibake-yanzhengma", value: "\u6960\u5c83\u7609\u942e\u4e63" },
  { name: "legacy-invalid-mojibake-check-a", value: "\u59a4\u72b2\u77c1" },
  { name: "legacy-invalid-mojibake-check-b", value: "\u9426\u5910\u60cd\u6d94" }
];

const toPosix = (path) => path.split(sep).join("/");

const shouldScan = (path) => sourcePattern.test(path) || protocolJsonPattern.test(path);

const locationFor = (content, index) => {
  const prefix = content.slice(0, index);
  const lines = prefix.split(/\r?\n/u);
  return { column: lines.at(-1).length + 1, line: lines.length };
};

const walk = async (directory, files) => {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) {
        await walk(join(directory, entry.name), files);
      }
      continue;
    }
    if (entry.isFile()) {
      const absolute = join(directory, entry.name);
      const posix = toPosix(relative(process.cwd(), absolute));
      if (shouldScan(posix)) {
        files.push({ absolute, posix });
      }
    }
  }
};

const files = [];
for (const root of scanRoots) {
  await walk(root, files);
}

const failures = [];
for (const file of files.sort((left, right) => left.posix.localeCompare(right.posix))) {
  const bytes = await readFile(file.absolute);
  const nulIndex = bytes.indexOf(0);
  if (nulIndex !== -1) {
    failures.push(`${file.posix}: byte ${nulIndex + 1}: NUL byte`);
  }

  const content = bytes.toString("utf8");
  const replacementIndex = content.indexOf(replacementCharacter);
  if (replacementIndex !== -1) {
    const location = locationFor(content, replacementIndex);
    failures.push(`${file.posix}:${location.line}:${location.column}: U+FFFD replacement character`);
  }

  for (const fragment of blockedFragments) {
    const index = content.indexOf(fragment.value);
    if (index !== -1) {
      const location = locationFor(content, index);
      failures.push(`${file.posix}:${location.line}:${location.column}: blocklisted mojibake fragment ${fragment.name}`);
    }
  }

  const nulCharacterIndex = content.indexOf(nulByte);
  if (nulCharacterIndex !== -1) {
    const location = locationFor(content, nulCharacterIndex);
    failures.push(`${file.posix}:${location.line}:${location.column}: NUL character`);
  }
}

if (failures.length > 0) {
  console.error("Encoding guard failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log(`Encoding guard passed (${files.length} files scanned)`);
