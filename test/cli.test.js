// Integration tests that actually spawn bin/crondex.js — these cover the command
// wiring (arg parsing, file I/O) that the lib/*.test.js unit tests don't touch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ROOT = new URL("..", import.meta.url).pathname;
const CLI = join(ROOT, "bin/crondex.js");

function run(args, opts = {}) {
  return execFileSync("node", [CLI, ...args], { encoding: "utf8", ...opts });
}

test("list: with no args prints the catalog info line and at least one job", () => {
  const out = run(["list"]);
  assert.match(out, /crondex v\d+\.\d+\.\d+/);
  assert.match(out, /jobs\./);
});

test("list --category devops --json: returns only devops jobs as valid JSON", () => {
  const out = run(["list", "--category", "devops", "--json"]);
  const jobs = JSON.parse(out);
  assert.ok(jobs.length > 0);
  assert.ok(jobs.every((j) => j.category === "devops"));
});

test("list --category nonexistent: reports no jobs matched", () => {
  const out = run(["list", "--category", "nonexistent-category-xyz"]);
  assert.match(out, /no jobs matched/);
});

test("show ssl-cert-expiry-check: prints raw YAML containing the job id", () => {
  const out = run(["show", "ssl-cert-expiry-check"]);
  assert.match(out, /id: ssl-cert-expiry-check/);
});

test("show --json: returns parsed job object with a command field", () => {
  const out = run(["show", "ssl-cert-expiry-check", "--json"]);
  const job = JSON.parse(out);
  assert.equal(job.id, "ssl-cert-expiry-check");
  assert.ok(job.command);
});

test("show unknown-job-id: exits nonzero with an error message", () => {
  assert.throws(() => run(["show", "not-a-real-job-id"]), /no job named/);
});

test("categories --json: returns every category with a nonempty description", () => {
  const out = run(["categories", "--json"]);
  const categories = JSON.parse(out);
  assert.ok(categories.length > 10);
  for (const c of categories) {
    assert.ok(c.description.length > 0, `${c.category} has no description`);
  }
});

test("recommend: finds a relevant job for a plain-language query", () => {
  const out = run(["recommend", "warn me before my SSL cert expires", "--json"]);
  const results = JSON.parse(out);
  assert.ok(results.some((r) => r.id === "ssl-cert-expiry-check"));
});

test("add: writes the job YAML to --dest and refuses to overwrite", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const dest = join(tmp, "ssl.yaml");
    run(["add", "ssl-cert-expiry-check", "--dest", dest]);
    assert.ok(existsSync(dest));
    assert.match(readFileSync(dest, "utf8"), /id: ssl-cert-expiry-check/);
    assert.throws(() => run(["add", "ssl-cert-expiry-check", "--dest", dest]), /already exists/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("init: scaffolds a template with the given id and category, refuses invalid ids", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const dest = join(tmp, "new-job.yaml");
    run(["init", "my-new-job", "--category", "testing", "--dest", dest]);
    const content = readFileSync(dest, "utf8");
    assert.match(content, /id: my-new-job/);
    assert.match(content, /category: testing/);
    assert.throws(() => run(["init", "Not A Valid Id", "--dest", join(tmp, "x.yaml")]), /isn't a valid job id/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("deploy --target crontab: prints a ready crontab line with variable overrides applied", () => {
  const out = run(["deploy", "ssl-cert-expiry-check", "--var", "host=example.org", "--var", "port=8443"]);
  assert.match(out, /^0 6 \* \* \*/);
  assert.match(out, /host=example\.org/);
  assert.match(out, /port=8443/);
  assert.match(out, /# crondex:ssl-cert-expiry-check/);
});

test("deploy --target github-actions: writes a workflow file with the job's schedule", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const dest = join(tmp, "workflow.yml");
    const out = run(["deploy", "ssl-cert-expiry-check", "--target", "github-actions", "--dest", dest]);
    assert.match(out, /wrote/);
    const content = readFileSync(dest, "utf8");
    assert.match(content, /cron: "0 6 \* \* \*"/);
    assert.match(content, /run job/);
    assert.throws(
      () => run(["deploy", "ssl-cert-expiry-check", "--target", "github-actions", "--dest", dest]),
      /already exists/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("deploy --target github-actions --mode prompt: works for a hybrid job's prompt side", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const dest = join(tmp, "workflow.yml");
    run(["deploy", "cost-alert", "--target", "github-actions", "--mode", "prompt", "--dest", dest]);
    const content = readFileSync(dest, "utf8");
    assert.match(content, /TODO/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("deploy --target bogus: exits nonzero with an error", () => {
  assert.throws(() => run(["deploy", "ssl-cert-expiry-check", "--target", "bogus"]), /unknown --target/);
});

test("deploy --install: installs into crontab via a stubbed crontab binary, idempotently", () => {
  // Never touch the real system crontab — stub `crontab` on PATH and point at it.
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  const fakeBin = join(tmp, "bin");
  const state = join(tmp, "state.txt");
  try {
    mkdirSync(fakeBin);
    const stub = `#!/bin/sh
if [ "$1" = "-l" ]; then
  [ -f "${state}" ] && cat "${state}" || exit 1
elif [ "$1" = "-" ]; then
  cat > "${state}"
fi
`;
    const crontabPath = join(fakeBin, "crontab");
    writeFileSync(crontabPath, stub);
    chmodSync(crontabPath, 0o755);

    run(["deploy", "ssl-cert-expiry-check", "--install"], {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    });
    const firstState = readFileSync(state, "utf8");
    assert.match(firstState, /crondex:ssl-cert-expiry-check/);

    run(["deploy", "ssl-cert-expiry-check", "--var", "host=changed.example.com", "--install"], {
      env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` },
    });
    const secondState = readFileSync(state, "utf8");
    const matches = secondState.match(/crondex:ssl-cert-expiry-check/g) ?? [];
    assert.equal(matches.length, 1, "reinstalling should replace, not duplicate, the existing entry");
    assert.match(secondState, /changed\.example\.com/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
