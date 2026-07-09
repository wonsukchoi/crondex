import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVariables, substitutePlaceholders, pickMode, buildCrontabLine, buildGithubActionsWorkflow } from "../lib/deploy.js";

test("resolveVariables: uses defaults when no override given", () => {
  const job = { variables: { host: { default: "example.com" }, port: { default: 443 } } };
  assert.deepEqual(resolveVariables(job), { host: "example.com", port: 443 });
});

test("resolveVariables: override wins over default", () => {
  const job = { variables: { host: { default: "example.com" } } };
  assert.deepEqual(resolveVariables(job, { host: "other.com" }), { host: "other.com" });
});

test("resolveVariables: job with no variables returns empty object", () => {
  assert.deepEqual(resolveVariables({}), {});
});

test("substitutePlaceholders: replaces every occurrence", () => {
  const out = substitutePlaceholders("curl {{host}}:{{port}}/{{host}}", { host: "example.com", port: 443 });
  assert.equal(out, "curl example.com:443/example.com");
});

test("substitutePlaceholders: leaves unresolved placeholders untouched rather than dropping them", () => {
  const out = substitutePlaceholders("echo {{unknown}}", {});
  assert.equal(out, "echo {{unknown}}");
});

test("pickMode: shell runner always resolves to script", () => {
  assert.equal(pickMode({ runner: "shell" }, "prompt"), "script");
});

test("pickMode: agent-prompt runner always resolves to prompt", () => {
  assert.equal(pickMode({ runner: "agent-prompt" }, "script"), "prompt");
});

test("pickMode: hybrid defaults to script unless prompt requested", () => {
  assert.equal(pickMode({ runner: "hybrid" }), "script");
  assert.equal(pickMode({ runner: "hybrid" }, "prompt"), "prompt");
});

test("buildCrontabLine: wraps a script command in bash -lc with a job marker", () => {
  const job = { id: "my-job", schedule: "0 6 * * *" };
  const line = buildCrontabLine(job, 'echo "hello"', false);
  assert.equal(line, `0 6 * * * bash -lc 'echo "hello"' # crondex:my-job`);
});

test("buildCrontabLine: flattens multi-line commands onto one line", () => {
  const job = { id: "my-job", schedule: "0 6 * * *" };
  const line = buildCrontabLine(job, "echo one;\n  echo two;", false);
  assert.equal(line.split("\n").length, 1);
  assert.match(line, /echo one; echo two;/);
});

test("buildCrontabLine: escapes embedded single quotes", () => {
  const job = { id: "my-job", schedule: "0 6 * * *" };
  const line = buildCrontabLine(job, "echo 'hi'", false);
  assert.doesNotThrow(() => {
    // the escaped form should be valid enough to round-trip through a shell-safe quote check
    assert.match(line, /'"'"'/);
  });
});

test("buildCrontabLine: prompt mode defers to CRONDEX_AGENT_CLI instead of guessing", () => {
  const job = { id: "my-job", schedule: "0 6 * * *" };
  const line = buildCrontabLine(job, "do the thing", true);
  assert.match(line, /CRONDEX_AGENT_CLI/);
  assert.match(line, /do the thing/);
});

test("buildGithubActionsWorkflow: script mode embeds the command under `run:`", () => {
  const job = { name: "My Job", schedule: "0 9 * * 1-5", timezone: "UTC", path: "jobs/x/my-job.yaml" };
  const yamlText = buildGithubActionsWorkflow(job, { command: "echo hello", mode: "script" });
  assert.match(yamlText, /cron: "0 9 \* \* 1-5"/);
  assert.match(yamlText, /run: \|/);
  assert.match(yamlText, /echo hello/);
  assert.doesNotMatch(yamlText, /TODO/);
});

test("buildGithubActionsWorkflow: non-UTC timezone gets a visible warning comment", () => {
  const job = { name: "My Job", schedule: "0 9 * * *", timezone: "America/New_York", path: "x.yaml" };
  const yamlText = buildGithubActionsWorkflow(job, { command: "echo hi", mode: "script" });
  assert.match(yamlText, /always runs in UTC/);
});

test("buildGithubActionsWorkflow: UTC timezone has no warning comment", () => {
  const job = { name: "My Job", schedule: "0 9 * * *", timezone: "UTC", path: "x.yaml" };
  const yamlText = buildGithubActionsWorkflow(job, { command: "echo hi", mode: "script" });
  assert.doesNotMatch(yamlText, /always runs in UTC/);
});

test("buildGithubActionsWorkflow: prompt mode leaves a TODO and prints the resolved prompt", () => {
  const job = { name: "My Job", schedule: "0 9 * * *", timezone: "UTC", path: "x.yaml" };
  const yamlText = buildGithubActionsWorkflow(job, { prompt: "Do the thing with {{x}}", mode: "prompt" });
  assert.match(yamlText, /TODO/);
  assert.match(yamlText, /Do the thing with \{\{x\}\}/);
});
