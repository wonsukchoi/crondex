#!/usr/bin/env node
// Runs shellcheck over every jobs/**/*.yaml `command` field (runner: shell or hybrid).
// See lib/shellcheck-prep.js for how a command gets turned into a checkable script.
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";
import { buildShellcheckScript } from "../lib/shellcheck-prep.js";

const ROOT = new URL("..", import.meta.url).pathname;
const JOBS_DIR = join(ROOT, "jobs");

// SC2269 (self-assignment), SC2016 (no expansion in single quotes), and SC2034
// (appears unused) are expected: `name="{{name}}"`, `{{name}}` inside single quotes,
// and placeholders referenced only inside a single-quoted jq/awk script are all fine
// in the real deployed command, since crondex's substitution happens as literal text
// before bash ever runs — they only look self-referential/inert/unused here because
// placeholders are stood in as real bash variables just to catch quoting/syntax bugs.
// SC2015 (A && B || C) and SC2004 ($/{} in arithmetic) are pure style choices used
// consistently across the catalog — not worth a mass edit for a style preference.
const IGNORED_CODES = "SC2269,SC2016,SC2034,SC2015,SC2004";

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) out.push(full);
  }
  return out;
}

try {
  execFileSync("shellcheck", ["--version"], { stdio: "ignore" });
} catch {
  console.error("shellcheck not found on PATH — install it (e.g. `brew install shellcheck`) to run this check.");
  process.exit(1);
}

const tmp = mkdtempSync(join(tmpdir(), "crondex-shellcheck-"));
let failed = 0;

try {
  for (const file of walk(JOBS_DIR)) {
    const doc = yaml.load(readFileSync(file, "utf8"));
    if (doc.runner !== "shell" && doc.runner !== "hybrid") continue;
    if (!doc.command) continue;

    const rel = relative(ROOT, file);
    const script = buildShellcheckScript(doc.command);
    const scriptPath = join(tmp, "check.sh");
    writeFileSync(scriptPath, script);

    try {
      execFileSync("shellcheck", ["-s", "bash", "-e", IGNORED_CODES, scriptPath], { stdio: "pipe" });
    } catch (err) {
      console.error(`${rel}:`);
      console.error(err.stdout?.toString() ?? err.message);
      failed++;
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed} job(s) failed shellcheck`);
  process.exit(1);
}
console.log("all shell commands passed shellcheck");
