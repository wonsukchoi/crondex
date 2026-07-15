// Integration tests that actually spawn bin/crondex.js — these cover the command
// wiring (arg parsing, file I/O) that the lib/*.test.js unit tests don't touch.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const CLI = join(ROOT, "bin/crondex.js");

// maxBuffer bumped from Node's 1MB default — full-catalog --json output (2000+ jobs,
// each with id/description/tags/schedule/etc.) comfortably exceeds that once the
// catalog has real size, which surfaced as a spurious ENOBUFS in CI, not a real bug.
function run(args, opts = {}) {
  return execFileSync("node", [CLI, ...args], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024, ...opts });
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

test("show --json: includes a verified boolean field", () => {
  const out = run(["show", "ssl-cert-expiry-check", "--json"]);
  const job = JSON.parse(out);
  assert.equal(typeof job.verified, "boolean");
});

test("show (non-json): prints a smoke-tested status line before the raw YAML", () => {
  const out = run(["show", "ssl-cert-expiry-check"]);
  assert.match(out, /smoke-tested/);
});

test("list --json: every job has a verified boolean field", () => {
  const out = run(["list", "--category", "devops", "--json"]);
  const jobs = JSON.parse(out);
  assert.ok(jobs.every((j) => typeof j.verified === "boolean"));
});

test("list --verified-only: only returns jobs with verified: true", () => {
  const out = run(["list", "--verified-only", "--json"]);
  const jobs = JSON.parse(out);
  assert.ok(jobs.every((j) => j.verified === true));
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

test("recommend --verified-only: never returns an unverified job", () => {
  const out = run(["recommend", "warn me before my SSL cert expires", "--verified-only", "--json"]);
  const results = JSON.parse(out);
  assert.ok(results.every((r) => r.verified === true));
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

test("deploy --target systemd: writes a .service + .timer pair", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const out = run(["deploy", "ssl-cert-expiry-check", "--target", "systemd", "--dest", tmp]);
    assert.match(out, /wrote/);
    assert.ok(existsSync(join(tmp, "ssl-cert-expiry-check.service")));
    assert.ok(existsSync(join(tmp, "ssl-cert-expiry-check.timer")));
    assert.match(readFileSync(join(tmp, "ssl-cert-expiry-check.timer"), "utf8"), /OnCalendar=/);
    assert.throws(
      () => run(["deploy", "ssl-cert-expiry-check", "--target", "systemd", "--dest", tmp]),
      /already exists/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("deploy --target docker: writes a Dockerfile + crontab pair", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const dest = join(tmp, "img");
    const out = run(["deploy", "ssl-cert-expiry-check", "--target", "docker", "--dest", dest]);
    assert.match(out, /wrote/);
    assert.match(readFileSync(join(dest, "Dockerfile"), "utf8"), /FROM debian/);
    assert.match(readFileSync(join(dest, "crontab"), "utf8"), /crondex:ssl-cert-expiry-check/);
    assert.throws(
      () => run(["deploy", "ssl-cert-expiry-check", "--target", "docker", "--dest", dest]),
      /already exists/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("deploy --target k8s-cronjob: writes a self-contained CronJob manifest", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const dest = join(tmp, "job.yaml");
    const out = run(["deploy", "ssl-cert-expiry-check", "--target", "k8s-cronjob", "--dest", dest]);
    assert.match(out, /wrote/);
    const content = readFileSync(dest, "utf8");
    assert.match(content, /kind: CronJob/);
    assert.match(content, /schedule: "0 6 \* \* \*"/);
    assert.throws(
      () => run(["deploy", "ssl-cert-expiry-check", "--target", "k8s-cronjob", "--dest", dest]),
      /already exists/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("deploy --target terraform: writes a kubernetes_cron_job_v1 Terraform resource", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const dest = join(tmp, "job.tf");
    const out = run(["deploy", "ssl-cert-expiry-check", "--target", "terraform", "--dest", dest]);
    assert.match(out, /wrote/);
    const content = readFileSync(dest, "utf8");
    assert.match(content, /resource "kubernetes_cron_job_v1" "ssl_cert_expiry_check"/);
    assert.match(content, /schedule\s*=\s*"0 6 \* \* \*"/);
    assert.throws(
      () => run(["deploy", "ssl-cert-expiry-check", "--target", "terraform", "--dest", dest]),
      /already exists/
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("deploy --target eventbridge: prints an aws scheduler command with a converted cron expression", () => {
  const out = run(["deploy", "ssl-cert-expiry-check", "--target", "eventbridge"]);
  assert.match(out, /aws scheduler create-schedule/);
  assert.match(out, /cron\(0 6 \* \* \? \*\)/);
});

test("deploy --target cloud-scheduler: prints a gcloud scheduler command with the raw cron schedule", () => {
  const out = run(["deploy", "ssl-cert-expiry-check", "--target", "cloud-scheduler"]);
  assert.match(out, /gcloud scheduler jobs create http/);
  assert.match(out, /--schedule="0 6 \* \* \*"/);
});

test("update: refreshes a locally pulled job to the latest catalog version, printing a diff", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const dest = join(tmp, "ssl.yaml");
    run(["add", "ssl-cert-expiry-check", "--dest", dest]);
    const upToDateOut = run(["update", dest]);
    assert.match(upToDateOut, /already up to date/);

    writeFileSync(dest, readFileSync(dest, "utf8").replace("name: SSL Certificate Expiry Check", "name: stale"));
    const updatedOut = run(["update", dest]);
    assert.match(updatedOut, /added.*removed/);
    assert.match(updatedOut, /- name: stale/);
    assert.match(updatedOut, /\+ name: SSL Certificate Expiry Check/);
    assert.match(updatedOut, /updated/);
    assert.doesNotMatch(readFileSync(dest, "utf8"), /name: stale/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("update --dry-run: shows the diff but leaves the file untouched", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const dest = join(tmp, "ssl.yaml");
    run(["add", "ssl-cert-expiry-check", "--dest", dest]);
    writeFileSync(dest, readFileSync(dest, "utf8").replace("name: SSL Certificate Expiry Check", "name: stale"));

    const out = run(["update", dest, "--dry-run"]);
    assert.match(out, /- name: stale/);
    assert.match(out, /rerun without --dry-run/);
    assert.match(readFileSync(dest, "utf8"), /name: stale/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("update: refuses a file with no id field", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const dest = join(tmp, "noid.yaml");
    writeFileSync(dest, "foo: bar\n");
    assert.throws(() => run(["update", dest]), /no "id" field/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("uninstall: removes a stubbed crontab entry by id, errors if not installed", () => {
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
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };

    run(["deploy", "ssl-cert-expiry-check", "--install"], { env });
    const listedOut = run(["deploy", "--list-installed"], { env });
    assert.match(listedOut, /crondex:ssl-cert-expiry-check/);

    const uninstallOut = run(["uninstall", "ssl-cert-expiry-check"], { env });
    assert.match(uninstallOut, /removed/);
    assert.doesNotMatch(readFileSync(state, "utf8"), /crondex:ssl-cert-expiry-check/);

    assert.throws(() => run(["uninstall", "ssl-cert-expiry-check"], { env }), /no installed crontab entry/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("bundle --dry-run: prints combined crontab lines for every job in the manifest without installing anything", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const manifest = join(tmp, "bundle.yaml");
    writeFileSync(
      manifest,
      `jobs:
  - id: ssl-cert-expiry-check
    vars:
      host: bundled.example.com
  - id: dependency-audit
`
    );
    const out = run(["bundle", manifest, "--target", "crontab", "--dry-run"]);
    assert.match(out, /bundled\.example\.com/);
    assert.match(out, /# crondex:ssl-cert-expiry-check/);
    assert.match(out, /# crondex:dependency-audit/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("bundle --out-dir: writes a github-actions workflow file per job", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const manifest = join(tmp, "bundle.yaml");
    writeFileSync(manifest, `jobs:\n  - id: ssl-cert-expiry-check\n`);
    const outDir = join(tmp, "out");
    const out = run(["bundle", manifest, "--target", "github-actions", "--out-dir", outDir]);
    assert.match(out, /wrote 1 file/);
    assert.ok(existsSync(join(outDir, "ssl-cert-expiry-check.yml")));
    assert.match(readFileSync(join(outDir, "ssl-cert-expiry-check.yml"), "utf8"), /cron: "0 6 \* \* \*"/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("bundle: errors on a manifest referencing an unknown job id", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  try {
    const manifest = join(tmp, "bundle.yaml");
    writeFileSync(manifest, `jobs:\n  - id: not-a-real-job-id\n`);
    assert.throws(() => run(["bundle", manifest]), /no job named/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("doctor: reports healthy when nothing is installed", () => {
  const tmp = mkdtempSync(join(tmpdir(), "crondex-cli-test-"));
  const fakeBin = join(tmp, "bin");
  try {
    mkdirSync(fakeBin);
    const stub = `#!/bin/sh
if [ "$1" = "-l" ]; then
  exit 1
fi
`;
    const crontabPath = join(fakeBin, "crontab");
    writeFileSync(crontabPath, stub);
    chmodSync(crontabPath, 0o755);
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };

    const out = run(["doctor"], { env });
    assert.match(out, /healthy/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("doctor: flags an orphaned entry and exits nonzero, --json returns structured issues", () => {
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
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };

    writeFileSync(state, `0 0 * * * bash -lc 'echo hi' # crondex:not-a-real-job-id@1\n`);

    assert.throws(() => run(["doctor"], { env }));

    let jsonOut;
    try {
      jsonOut = run(["doctor", "--json"], { env });
    } catch (e) {
      jsonOut = e.stdout;
    }
    const report = JSON.parse(jsonOut);
    assert.equal(report.length, 1);
    assert.equal(report[0].id, "not-a-real-job-id");
    assert.deepEqual(report[0].issues, ["orphaned"]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("doctor: real deploy --install produces a healthy versioned entry", () => {
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
    const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH}` };

    run(["deploy", "ssl-cert-expiry-check", "--install"], { env });
    assert.match(readFileSync(state, "utf8"), /# crondex:ssl-cert-expiry-check@\d+/);

    const out = run(["doctor"], { env });
    assert.match(out, /healthy/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
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
