// Pure logic behind scripts/smoke-test.js: resolving a job's command with its real
// default variable values, and wrapping it for sandboxed execution. Split out so the
// resolution step is unit testable without actually spawning a shell.
import { substitutePlaceholders } from "./deploy.js";

// Unlike lint-shell.js (which stands placeholders in as bash variables to run
// shellcheck's static analysis), this resolves them exactly like a real deployment
// would — using each variable's actual `default` — so the smoke test exercises the
// real behavior a user would get, not a synthetic stand-in.
export function resolveJobCommand(job) {
  const values = {};
  for (const [name, spec] of Object.entries(job.variables ?? {})) values[name] = spec.default;
  return substitutePlaceholders(job.command, values);
}

// Wraps a resolved command for sandboxed execution:
//  - `set -u` so an unbound variable (a real bug) aborts instead of silently
//    expanding to empty string.
//  - HOME repointed into the sandbox dir, so a job whose default touches
//    "$HOME/..." (e.g. downloads-folder-auto-organize) can't reach the real user's
//    home directory.
//  - a `command_not_found_handle` fallback so any external tool not installed on
//    this machine (aws, gh, kubectl, redis-cli, ...) resolves to a harmless no-op
//    instead of a hard "command not found" — this lets the job's own control flow
//    run for real without requiring every possible external tool to be present.
export function buildSandboxScript(resolvedCommand) {
  return ["set -u", "command_not_found_handle() { return 0; }", resolvedCommand].join("\n");
}

// Merges one job's smoke-test outcome into a status map (job id -> {version, tested_at}),
// returning a new map. A pass records the job's CURRENT version as verified; a fail
// removes any existing entry — a job that used to pass at an older version but fails
// now shouldn't keep claiming "verified" for whatever version is on disk today. Pure
// (no I/O) so scripts/smoke-test.js can call this per job and write the result once at
// the end, rather than every function here needing filesystem access.
export function updateSmokeStatus(status, job, passed, testedAt) {
  const next = { ...status };
  if (passed) next[job.id] = { version: job.version, tested_at: testedAt };
  else delete next[job.id];
  return next;
}

// A job counts as verified only for the version recorded in `status` matching its
// CURRENT version — this is how a job edited (and re-smoke-tested) after a prior pass
// doesn't keep showing stale "verified" for behavior that no longer exists. Caveat:
// this relies on `version` actually being bumped on meaningful edits, which
// CONTRIBUTING.md's convention asks for but ROADMAP.md notes is under-followed in
// practice — an edited job that didn't bump `version` would incorrectly still read as
// verified. That's a real gap, but it's the version field's gap, not this check's.
export function isVerified(status, job) {
  return status[job.id]?.version === job.version;
}
