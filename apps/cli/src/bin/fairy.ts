#!/usr/bin/env node
import { runDoctor } from "../doctor.js";
import { runAudit, runChat, runSessions } from "../chat.js";
import { runMemory } from "../memory.js";
import { runAffect, runPersona } from "../persona.js";
import { runResearch } from "../research.js";
import { runReplay } from "../replay.js";
import { runArtifacts } from "../artifacts.js";

const [command, ...args] = process.argv.slice(2);

if (command === "doctor") {
  const report = await runDoctor();
  console.log(report.lines.join("\n"));
  process.exit(report.ok ? 0 : 1);
}

if (command === "chat") {
  await runChat(args);
  process.exit(0);
}

if (command === "sessions") {
  await runSessions(args);
  process.exit(0);
}

if (command === "audit") {
  await runAudit(args);
  process.exit(0);
}

if (command === "artifacts") {
  await runArtifacts(args);
  process.exit(0);
}

if (command === "replay") {
  await runReplay(args);
  process.exit(0);
}

if (command === "memory") {
  await runMemory(args);
  process.exit(0);
}

if (command === "research") {
  await runResearch(args);
  process.exit(0);
}

if (command === "persona") {
  await runPersona(args);
  process.exit(0);
}

if (command === "affect") {
  await runAffect(args);
  process.exit(0);
}

console.error("Usage: fairy <doctor|chat|sessions|audit|artifacts|replay|memory|research|persona|affect>");
process.exit(1);
