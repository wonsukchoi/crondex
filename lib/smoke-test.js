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
  return [
    "set -u",
    "command_not_found_handle() { return 0; }",
    resolvedCommand,
  ].join("\n");
}
