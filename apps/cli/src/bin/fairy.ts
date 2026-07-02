#!/usr/bin/env node
import { runDoctor } from "../doctor.js";
import { runChat, runSessions } from "../chat.js";

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

console.error("Usage: fairy <doctor|chat|sessions>");
process.exit(1);
