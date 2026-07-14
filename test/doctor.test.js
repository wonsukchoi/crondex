import { test } from "node:test";
import assert from "node:assert/strict";
import { parseInstalledLine, auditInstalled } from "../lib/doctor.js";

const CATALOG_JOBS = [
  { id: "ssl-cert-expiry-check", version: 2, schedule: "0 6 * * *" },
  { id: "dependency-audit", version: 1, schedule: "0 8 * * 1" },
];

test("parseInstalledLine: parses a versioned marker", () => {
  const parsed = parseInstalledLine("0 6 * * * bash -lc 'echo hi' # crondex:ssl-cert-expiry-check@2");
  assert.deepEqual(parsed, {
    id: "ssl-cert-expiry-check",
    version: 2,
    schedule: "0 6 * * *",
    line: "0 6 * * * bash -lc 'echo hi' # crondex:ssl-cert-expiry-check@2",
  });
});

test("parseInstalledLine: parses an unversioned marker (backward compat)", () => {
  const parsed = parseInstalledLine("0 6 * * * bash -lc 'echo hi' # crondex:ssl-cert-expiry-check");
  assert.equal(parsed.id, "ssl-cert-expiry-check");
  assert.equal(parsed.version, undefined);
  assert.equal(parsed.schedule, "0 6 * * *");
});

test("parseInstalledLine: returns null for a non-crondex line", () => {
  assert.equal(parseInstalledLine("0 6 * * * echo hi"), null);
});

test("auditInstalled: healthy versioned entry produces no report", () => {
  const line = "0 6 * * * bash -lc 'echo hi' # crondex:ssl-cert-expiry-check@2";
  assert.deepEqual(auditInstalled([line], CATALOG_JOBS), []);
});

test("auditInstalled: flags an orphaned entry (id no longer in catalog)", () => {
  const line = "0 6 * * * bash -lc 'echo hi' # crondex:deleted-job@1";
  const report = auditInstalled([line], CATALOG_JOBS);
  assert.equal(report.length, 1);
  assert.equal(report[0].id, "deleted-job");
  assert.deepEqual(report[0].issues, ["orphaned"]);
});

test("auditInstalled: flags schedule drift when installed schedule no longer matches catalog", () => {
  const line = "0 5 * * * bash -lc 'echo hi' # crondex:ssl-cert-expiry-check@2";
  const report = auditInstalled([line], CATALOG_JOBS);
  assert.equal(report.length, 1);
  assert.deepEqual(report[0].issues, ["schedule drift"]);
});

test("auditInstalled: flags version unknown for unversioned markers", () => {
  const line = "0 6 * * * bash -lc 'echo hi' # crondex:ssl-cert-expiry-check";
  const report = auditInstalled([line], CATALOG_JOBS);
  assert.equal(report.length, 1);
  assert.deepEqual(report[0].issues, ["version unknown"]);
});

test("auditInstalled: flags outdated version when installed version is behind the catalog", () => {
  const line = "0 6 * * * bash -lc 'echo hi' # crondex:ssl-cert-expiry-check@1";
  const report = auditInstalled([line], CATALOG_JOBS);
  assert.equal(report.length, 1);
  assert.deepEqual(report[0].issues, ["outdated"]);
});

test("auditInstalled: a line can carry multiple issues at once", () => {
  const line = "0 5 * * * bash -lc 'echo hi' # crondex:ssl-cert-expiry-check@1";
  const report = auditInstalled([line], CATALOG_JOBS);
  assert.equal(report.length, 1);
  assert.deepEqual(report[0].issues, ["schedule drift", "outdated"]);
});

test("auditInstalled: ignores non-crondex lines and mixes healthy/unhealthy entries", () => {
  const lines = [
    "0 6 * * * bash -lc 'echo hi' # crondex:ssl-cert-expiry-check@2",
    "0 8 * * 1 bash -lc 'echo bye' # crondex:dependency-audit@1",
    "0 0 * * * echo not-a-crondex-line",
    "0 0 * * * bash -lc 'echo x' # crondex:gone@1",
  ];
  const report = auditInstalled(lines, CATALOG_JOBS);
  assert.equal(report.length, 1);
  assert.equal(report[0].id, "gone");
});

test("auditInstalled: empty input produces an empty report", () => {
  assert.deepEqual(auditInstalled([], CATALOG_JOBS), []);
});
