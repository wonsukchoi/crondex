#!/usr/bin/env node
// Local, opt-in smoke test: actually executes each shell/hybrid job's command with
// its real default variable values, sandboxed (see lib/smoke-test.js), to catch
// runtime bugs static analysis can't — an unbound variable, a hang, a bash parse
// error that only shows up once real default values are substituted in.
//
// NOT wired into CI: some jobs' commands make real network calls with their default
// values (e.g. curl to a real RPC endpoint), which is slow/flaky/rate-limit-risky as
// an automated merge gate. Run this locally when writing or editing a shell/hybrid
// job — see CONTRIBUTING.md.
import { readFileSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import yaml from "js-yaml";
import { resolveJobCommand, buildSandboxScript } from "../lib/smoke-test.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const JOBS_DIR = join(ROOT, "jobs");
const TIMEOUT_SECONDS = Number(process.env.CRONDEX_SMOKE_TIMEOUT) || 8;
const onlyId = process.argv[2];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".yaml") || entry.endsWith(".yml")) out.push(full);
  }
  return out;
}

let failed = 0;
let ran = 0;

for (const file of walk(JOBS_DIR)) {
  const doc = yaml.load(readFileSync(file, "utf8"));
  if (doc.runner !== "shell" && doc.runner !== "hybrid") continue;
  if (!doc.command) continue;
  if (onlyId && doc.id !== onlyId) continue;

  const rel = relative(ROOT, file);
  const resolved = resolveJobCommand(doc);
  const script = buildSandboxScript(resolved);
  const sandbox = mkdtempSync(join(tmpdir(), "crondex-smoke-"));
  ran++;

  try {
    execFileSync("bash", ["-c", script], {
      cwd: sandbox,
      env: { ...process.env, HOME: sandbox },
      timeout: TIMEOUT_SECONDS * 1000,
      stdio: "pipe",
    });
  } catch (err) {
    const stderr = err.stderr?.toString() ?? "";
    const timedOut = err.signal === "SIGTERM";
    const isRealBug =
      timedOut ||
      /unbound variable/.test(stderr) ||
      /command not found/.test(stderr) ||
      /syntax error/.test(stderr) ||
      err.status === 126 ||
      err.status === 127;
    if (isRealBug) {
      console.error(`${rel}:`);
      console.error(`  ${timedOut ? `timed out after ${TIMEOUT_SECONDS}s` : `exit ${err.status}`}`);
      if (stderr.trim()) console.error(`  stderr: ${stderr.trim().split("\n").slice(0, 5).join("\n  ")}`);
      console.error();
      failed++;
    }
    // otherwise: a nonzero exit from the job's own "warning found" / "tool not
    // installed" / "file not found" branch logic is an expected, non-bug outcome.
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

console.log(`ran ${ran} shell/hybrid job(s), ${failed} failed`);
if (failed > 0) process.exit(1);
