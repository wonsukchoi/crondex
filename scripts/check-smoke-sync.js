#!/usr/bin/env node
// Advisory-only check: flags shell/hybrid jobs that changed in this diff but whose
// smoke-test-status.json entry doesn't match their current `version` — i.e. an edit
// that (per CONTRIBUTING.md convention) should have been re-smoke-tested and
// re-committed with an updated status, but wasn't. See ROADMAP.md §2 "Not yet done:
// keeping this fresh" and §5 "Version-bump discipline".
//
// Deliberately does NOT fail the build: smoke-test itself is local-only (network
// calls, see scripts/smoke-test.js), so a contributor without local smoke-test access
// shouldn't be blocked from merging. This just makes the drift visible in the PR
// comment instead of silently falling back to "unverified" with no signal why.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";
import { isVerified } from "../lib/smoke-test.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const JOBS_DIR = join(ROOT, "jobs");
const STATUS_PATH = join(ROOT, "smoke-test-status.json");
const baseRef = process.argv[2] ?? "HEAD^";

function loadStatus() {
  if (!existsSync(STATUS_PATH)) return {};
  return JSON.parse(readFileSync(STATUS_PATH, "utf8"));
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) out.push(full);
  }
  return out;
}

function changedJobFiles(base) {
  let diffOutput;
  try {
    diffOutput = execFileSync("git", ["diff", "--name-only", "--diff-filter=ACM", `${base}...HEAD`, "--", "jobs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch {
    // No merge-base with `base` (e.g. shallow clone, or base doesn't exist locally) —
    // fall back to checking every job file instead of silently checking nothing.
    return walk(JOBS_DIR).map((f) => relative(ROOT, f));
  }
  return diffOutput
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".yaml") || l.endsWith(".yml"));
}

const status = loadStatus();
const stale = [];

for (const relPath of changedJobFiles(baseRef)) {
  const fullPath = join(ROOT, relPath);
  if (!existsSync(fullPath)) continue; // deleted in this diff
  const doc = yaml.load(readFileSync(fullPath, "utf8"));
  if (!doc || (doc.runner !== "shell" && doc.runner !== "hybrid") || !doc.command) continue;
  if (!isVerified(status, doc)) stale.push({ id: doc.id, version: doc.version, path: relPath });
}

if (stale.length > 0) {
  console.log(`${stale.length} changed shell/hybrid job(s) not smoke-tested at their current version:\n`);
  for (const j of stale) console.log(`  ${j.id} (v${j.version}) — ${j.path}`);
  console.log("\nRun `npm run smoke-test` locally and commit the updated smoke-test-status.json.");
  console.log("Not a hard failure — smoke-test needs local network access, see CONTRIBUTING.md.");
} else {
  console.log("all changed shell/hybrid jobs are smoke-tested at their current version");
}
