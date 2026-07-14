#!/usr/bin/env node
// CLI over catalog.json — browse jobs, read one, or pull one into your project.
// Thin shim: all argument parsing and command routing lives in lib/cli.js so
// it's unit-testable without spawning a subprocess (see test/cli-unit.test.js).
import { runCli } from "../lib/cli.js";

runCli(process.argv.slice(2));
