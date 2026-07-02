#!/usr/bin/env node
import { runDoctor } from "../doctor.js";

const [command] = process.argv.slice(2);

if (command === "doctor") {
  const report = await runDoctor();
  console.log(report.lines.join("\n"));
  process.exit(report.ok ? 0 : 1);
}

console.error("Usage: fairy doctor");
process.exit(1);
