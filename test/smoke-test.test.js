import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveJobCommand, buildSandboxScript, updateSmokeStatus, isVerified } from "../lib/smoke-test.js";

test("resolveJobCommand: substitutes placeholders with each variable's real default", () => {
  const job = {
    command: "ping {{host}} -p {{port}}",
    variables: { host: { default: "example.com" }, port: { default: 443 } },
  };
  assert.equal(resolveJobCommand(job), "ping example.com -p 443");
});

test("resolveJobCommand: job with no variables leaves command untouched", () => {
  assert.equal(resolveJobCommand({ command: "echo hi" }), "echo hi");
});

test("buildSandboxScript: enables `set -u` so unbound variables abort", () => {
  const script = buildSandboxScript("echo hi");
  assert.match(script, /^set -u/);
});

test("buildSandboxScript: defines a command_not_found_handle fallback", () => {
  const script = buildSandboxScript("echo hi");
  assert.match(script, /command_not_found_handle/);
});

test("buildSandboxScript: appends the resolved command after the sandbox preamble", () => {
  const script = buildSandboxScript("echo the-actual-command");
  assert.match(script, /echo the-actual-command$/);
});

test("updateSmokeStatus: a pass records the job's current version and test date", () => {
  const status = updateSmokeStatus({}, { id: "my-job", version: 2 }, true, "2026-07-16");
  assert.deepEqual(status, { "my-job": { version: 2, tested_at: "2026-07-16" } });
});

test("updateSmokeStatus: a fail removes any existing entry for that job", () => {
  const before = { "my-job": { version: 1, tested_at: "2026-01-01" } };
  const status = updateSmokeStatus(before, { id: "my-job", version: 2 }, false, "2026-07-16");
  assert.deepEqual(status, {});
});

test("updateSmokeStatus: does not mutate the input map", () => {
  const before = { "other-job": { version: 1, tested_at: "2026-01-01" } };
  updateSmokeStatus(before, { id: "my-job", version: 1 }, true, "2026-07-16");
  assert.deepEqual(before, { "other-job": { version: 1, tested_at: "2026-01-01" } });
});

test("updateSmokeStatus: leaves other jobs' entries untouched", () => {
  const before = { "other-job": { version: 3, tested_at: "2026-01-01" } };
  const status = updateSmokeStatus(before, { id: "my-job", version: 1 }, true, "2026-07-16");
  assert.deepEqual(status["other-job"], { version: 3, tested_at: "2026-01-01" });
});

test("isVerified: true when the status entry's version matches the job's current version", () => {
  const status = { "my-job": { version: 2, tested_at: "2026-07-16" } };
  assert.equal(isVerified(status, { id: "my-job", version: 2 }), true);
});

test("isVerified: false when the job was edited (version bumped) since its last pass", () => {
  const status = { "my-job": { version: 1, tested_at: "2026-01-01" } };
  assert.equal(isVerified(status, { id: "my-job", version: 2 }), false);
});

test("isVerified: false when there's no status entry at all", () => {
  assert.equal(isVerified({}, { id: "never-tested", version: 1 }), false);
});
