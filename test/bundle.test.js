import { test } from "node:test";
import assert from "node:assert/strict";
import { runBundle } from "../lib/bundle.js";

const JOB_YAML = {
  "jobs/a.yaml": `id: job-a
version: 1
name: Job A
category: devops
schedule: "0 6 * * *"
runner: shell
command: echo {{greeting}}
variables:
  greeting:
    default: hello
`,
  "jobs/b.yaml": `id: job-b
version: 1
name: Job B
category: devops
schedule: "0 7 * * *"
runner: shell
command: echo bye
`,
  "jobs/prompt-only.yaml": `id: prompt-only
version: 1
name: Prompt Only
category: devops
schedule: "0 8 * * *"
runner: agent-prompt
prompt: do the thing
`,
};

const CATALOG = {
  jobs: [
    { id: "job-a", path: "jobs/a.yaml" },
    { id: "job-b", path: "jobs/b.yaml" },
    { id: "prompt-only", path: "jobs/prompt-only.yaml" },
  ],
};

function readJobFile(path) {
  return JOB_YAML[path];
}

test("runBundle: crontab target produces one line per job with vars applied", () => {
  const manifest = { jobs: [{ id: "job-a", vars: { greeting: "hi" } }, { id: "job-b" }] };
  const result = runBundle(manifest, CATALOG, { target: "crontab", readJobFile });
  assert.equal(result.entries.length, 2);
  assert.match(result.entries[0].line, /echo hi/);
  assert.match(result.entries[0].line, /# crondex:job-a@1/);
  assert.match(result.entries[1].line, /echo bye/);
  assert.equal(result.output, result.entries.map((e) => e.line).join("\n") + "\n");
});

test("runBundle: defaults to crontab target when none given", () => {
  const manifest = { jobs: [{ id: "job-a" }] };
  const result = runBundle(manifest, CATALOG, { readJobFile });
  assert.equal(result.entries.length, 1);
});

test("runBundle: github-actions target produces one file per job with header sections", () => {
  const manifest = { jobs: [{ id: "job-a" }, { id: "job-b" }] };
  const result = runBundle(manifest, CATALOG, { target: "github-actions", readJobFile });
  assert.equal(result.files.length, 2);
  assert.deepEqual(result.files.map((f) => f.name), ["job-a.yml", "job-b.yml"]);
  assert.match(result.output, /=== job-a\.yml ===/);
  assert.match(result.output, /=== job-b\.yml ===/);
});

test("runBundle: systemd target produces a .service + .timer pair per job", () => {
  const manifest = { jobs: [{ id: "job-a" }] };
  const result = runBundle(manifest, CATALOG, { target: "systemd", readJobFile });
  assert.deepEqual(result.files.map((f) => f.name), ["job-a.service", "job-a.timer"]);
});

test("runBundle: docker target produces a Dockerfile + crontab pair per job", () => {
  const manifest = { jobs: [{ id: "job-a" }] };
  const result = runBundle(manifest, CATALOG, { target: "docker", readJobFile });
  assert.deepEqual(result.files.map((f) => f.name), ["job-a/Dockerfile", "job-a/crontab"]);
});

test("runBundle: respects per-job mode for hybrid/prompt jobs", () => {
  const manifest = { jobs: [{ id: "prompt-only" }] };
  const result = runBundle(manifest, CATALOG, { target: "crontab", readJobFile });
  assert.match(result.entries[0].line, /CRONDEX_AGENT_CLI/);
});

test("runBundle: throws on unknown target", () => {
  const manifest = { jobs: [{ id: "job-a" }] };
  assert.throws(() => runBundle(manifest, CATALOG, { target: "bogus", readJobFile }), /unknown --target/);
});

test("runBundle: throws when a job id isn't in the catalog", () => {
  const manifest = { jobs: [{ id: "not-a-real-job" }] };
  assert.throws(() => runBundle(manifest, CATALOG, { target: "crontab", readJobFile }), /no job named/);
});

test("runBundle: throws on an empty or missing jobs list", () => {
  assert.throws(() => runBundle({ jobs: [] }, CATALOG, { readJobFile }), /non-empty "jobs" list/);
  assert.throws(() => runBundle({}, CATALOG, { readJobFile }), /non-empty "jobs" list/);
});

test("runBundle: throws when a manifest entry has no id", () => {
  const manifest = { jobs: [{ vars: { x: "y" } }] };
  assert.throws(() => runBundle(manifest, CATALOG, { readJobFile }), /missing "id"/);
});
