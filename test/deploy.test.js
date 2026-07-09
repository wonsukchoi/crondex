import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveVariables,
  substitutePlaceholders,
  pickMode,
  buildCrontabLine,
  buildGithubActionsWorkflow,
  cronToSystemdCalendar,
  buildSystemdUnits,
  buildDockerArtifacts,
  buildK8sCronJob,
  cronToAwsCron,
  buildEventBridgeCommand,
  buildCloudSchedulerCommand,
} from "../lib/deploy.js";

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

test("cronToSystemdCalendar: daily schedule with no weekday restriction", () => {
  assert.equal(cronToSystemdCalendar("0 6 * * *"), "*-*-* 6:0:00");
});

test("cronToSystemdCalendar: weekday range maps to day names", () => {
  assert.equal(cronToSystemdCalendar("0 14 * * 1-5"), "Mon-Fri *-*-* 14:0:00");
});

test("cronToSystemdCalendar: */n step becomes 0/n", () => {
  assert.equal(cronToSystemdCalendar("*/15 * * * *"), "*-*-* *:0/15:00");
});

test("cronToSystemdCalendar: comma weekday list maps to comma day names", () => {
  assert.equal(cronToSystemdCalendar("0 7 * * 1,3"), "Mon,Wed *-*-* 7:0:00");
});

test("buildSystemdUnits: timer OnCalendar matches the job schedule, service embeds the command", () => {
  const job = { id: "my-job", name: "My Job", schedule: "0 6 * * *" };
  const { service, timer } = buildSystemdUnits(job, 'echo "hello"', false);
  assert.match(timer, /OnCalendar=\*-\*-\* 6:0:00/);
  assert.match(timer, /WantedBy=timers\.target/);
  assert.match(service, /ExecStart=\/bin\/bash -c/);
  assert.match(service, /echo/);
  assert.match(service, /crondex:my-job/);
});

test("buildSystemdUnits: prompt mode notes CRONDEX_AGENT_CLI is needed", () => {
  const job = { id: "my-job", name: "My Job", schedule: "0 6 * * *" };
  const { service } = buildSystemdUnits(job, "do the thing", true);
  assert.match(service, /CRONDEX_AGENT_CLI/);
});

test("buildDockerArtifacts: crontab entry is /etc/cron.d style with a root user field", () => {
  const job = { id: "my-job", name: "My Job", schedule: "0 6 * * *", path: "jobs/x/my-job.yaml" };
  const { dockerfile, crontab } = buildDockerArtifacts(job, 'echo "hello"', false);
  assert.match(crontab, /^0 6 \* \* \* root bash -lc/);
  assert.match(crontab, /# crondex:my-job/);
  assert.match(dockerfile, /FROM debian/);
  assert.match(dockerfile, /COPY crontab \/etc\/cron\.d\/crondex-job/);
});

test("buildDockerArtifacts: prompt mode warns about CRONDEX_AGENT_CLI in the Dockerfile", () => {
  const job = { id: "my-job", name: "My Job", schedule: "0 6 * * *", path: "x.yaml" };
  const { dockerfile } = buildDockerArtifacts(job, "do the thing", true);
  assert.match(dockerfile, /CRONDEX_AGENT_CLI/);
});

test("buildK8sCronJob: embeds schedule and command without double-wrapping bash -lc", () => {
  const job = { id: "my-job", name: "My Job", schedule: "0 6 * * *", path: "jobs/x/my-job.yaml" };
  const manifest = buildK8sCronJob(job, 'echo "hello"', false);
  assert.match(manifest, /schedule: "0 6 \* \* \*"/);
  assert.match(manifest, /command: \["bash", "-lc", "echo \\"hello\\""\]/);
  assert.doesNotMatch(manifest, /bash -lc 'bash -lc/);
});

test("buildK8sCronJob: prompt mode adds a CRONDEX_AGENT_CLI env placeholder", () => {
  const job = { id: "my-job", name: "My Job", schedule: "0 6 * * *", path: "x.yaml" };
  const manifest = buildK8sCronJob(job, "do the thing", true);
  assert.match(manifest, /name: CRONDEX_AGENT_CLI/);
  assert.match(manifest, /"sh", "-lc"/);
});

test("buildK8sCronJob: escapes embedded double quotes so the YAML stays valid", () => {
  const job = { id: "my-job", name: "My Job", schedule: "0 6 * * *", path: "x.yaml" };
  const manifest = buildK8sCronJob(job, 'echo "a" && echo "b"', false);
  assert.match(manifest, /\\"a\\"/);
  assert.match(manifest, /\\"b\\"/);
});

test("cronToAwsCron: weekday-restricted schedule sets day-of-month to ? and maps weekday names", () => {
  assert.equal(cronToAwsCron("0 14 * * 1-5"), "cron(0 14 ? * MON-FRI *)");
});

test("cronToAwsCron: unrestricted weekday sets day-of-week to ? and keeps day-of-month", () => {
  assert.equal(cronToAwsCron("0 6 * * *"), "cron(0 6 * * ? *)");
  assert.equal(cronToAwsCron("0 7 1 * *"), "cron(0 7 1 * ? *)");
});

test("cronToAwsCron: */n step becomes 0/n", () => {
  assert.equal(cronToAwsCron("*/15 * * * *"), "cron(0/15 * * * ? *)");
});

test("buildEventBridgeCommand: embeds the AWS cron expression and leaves the target as a TODO", () => {
  const job = { id: "my-job", name: "My Job", schedule: "0 6 * * *", path: "x.yaml" };
  const out = buildEventBridgeCommand(job, "do the thing", false);
  assert.match(out, /cron\(0 6 \* \* \? \*\)/);
  assert.match(out, /TODO_TARGET_ARN/);
  assert.match(out, /aws scheduler create-schedule/);
});

test("buildCloudSchedulerCommand: passes cron through unchanged and leaves the endpoint as a TODO", () => {
  const job = { id: "my-job", name: "My Job", schedule: "0 6 * * *", timezone: "America/New_York", path: "x.yaml" };
  const out = buildCloudSchedulerCommand(job, "do the thing", false);
  assert.match(out, /--schedule="0 6 \* \* \*"/);
  assert.match(out, /--time-zone="America\/New_York"/);
  assert.match(out, /TODO_HTTPS_ENDPOINT/);
});
