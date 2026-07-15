#!/usr/bin/env node
import { doctorExitCode, doctorUsage, parseDoctorOptions, renderDoctorJson, runDoctor } from "../doctor.js";
import { devUsage, parseDevOptions, runDev } from "../dev.js";
import { runAudit, runChat, runSessions } from "../chat.js";
import { runChronicle } from "../chronicle.js";
import { runMemory } from "../memory.js";
import { runAffect, runPersona } from "../persona.js";
import { runResearch } from "../research.js";
import { runReplay } from "../replay.js";
import { runArtifacts } from "../artifacts.js";
import { runVoice } from "../voice.js";

const [command, ...args] = process.argv.slice(2);

if (command === "doctor") {
  try {
    const options = parseDoctorOptions(args);
    const report = await runDoctor(options);
    console.log(options.json ? renderDoctorJson(report) : report.lines.join("\n"));
    process.exit(doctorExitCode(report));
  } catch {
    console.error(doctorUsage);
    process.exit(1);
  }
}

if (command === "dev") {
  try {
    const options = parseDevOptions(args);
    const controller = new AbortController();
    const stop = (): void => controller.abort();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    try {
      const result = await runDev({ ...options, signal: controller.signal });
      process.exit(result.ok ? 0 : 1);
    } finally {
      process.removeListener("SIGINT", stop);
      process.removeListener("SIGTERM", stop);
    }
  } catch {
    console.error(devUsage);
    process.exit(1);
  }
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

if (command === "chronicle") {
  await runChronicle(args);
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

if (command === "voice") {
  await runVoice(args);
  process.exit(0);
}

console.error("Usage: fairy <doctor|dev|chat|sessions|audit|artifacts|replay|memory|chronicle|research|persona|affect|voice>");
process.exit(1);
