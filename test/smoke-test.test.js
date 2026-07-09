import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveJobCommand, buildSandboxScript } from "../lib/smoke-test.js";

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
