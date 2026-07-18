#!/usr/bin/env node
import { runCli } from "./commands.js";

// The executable wrapper is intentionally thin: all behavior stays in
// `runCli`, which keeps command logic testable without spawning a process.
const result = await runCli(process.argv.slice(2));

if (result.stdout) {
  process.stdout.write(`${result.stdout}\n`);
}

if (result.stderr) {
  // Errors and warnings go to stderr so stdout can stay useful for structured
  // command output such as dry-run and validation summaries.
  process.stderr.write(`${result.stderr}\n`);
}

process.exitCode = result.exitCode;
