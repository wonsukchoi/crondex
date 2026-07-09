import { test } from "node:test";
import assert from "node:assert/strict";
import { modesForRunner, countByCategory, findMissingDescriptions, buildSummaryLines, spliceReadmeSummary } from "../lib/catalog-summary.js";

test("modesForRunner: maps each runner to its modes", () => {
  assert.deepEqual(modesForRunner("shell"), ["script"]);
  assert.deepEqual(modesForRunner("agent-prompt"), ["agent-prompt"]);
  assert.deepEqual(modesForRunner("hybrid"), ["script", "agent-prompt"]);
});

test("modesForRunner: unknown runner returns empty array, not undefined", () => {
  assert.deepEqual(modesForRunner("bogus"), []);
});

test("countByCategory: tallies jobs per category", () => {
  const jobs = [{ category: "devops" }, { category: "devops" }, { category: "security" }];
  const counts = countByCategory(jobs);
  assert.equal(counts.get("devops"), 2);
  assert.equal(counts.get("security"), 1);
});

test("findMissingDescriptions: flags categories with no description entry", () => {
  const missing = findMissingDescriptions(["devops", "newcategory"], { devops: "Infra stuff." });
  assert.deepEqual(missing, ["newcategory"]);
});

test("findMissingDescriptions: all present returns empty", () => {
  const missing = findMissingDescriptions(["devops"], { devops: "Infra stuff." });
  assert.deepEqual(missing, []);
});

test("buildSummaryLines: builds a sorted markdown table with counts and descriptions", () => {
  const jobs = [
    { category: "security" },
    { category: "devops" },
    { category: "devops" },
  ];
  const lines = buildSummaryLines(jobs, { devops: "Infra stuff.", security: "Security stuff." });
  assert.equal(lines[0], "3 jobs across 2 categories:");
  assert.equal(lines[2], "| category | jobs | description |");
  // devops sorts before security
  assert.match(lines[4], /`devops`.*\| 2 \|.*Infra stuff\./);
  assert.match(lines[5], /`security`.*\| 1 \|.*Security stuff\./);
});

test("buildSummaryLines: missing description renders as empty cell, not 'undefined'", () => {
  const lines = buildSummaryLines([{ category: "newcategory" }], {});
  const row = lines.find((l) => l.includes("newcategory"));
  assert.ok(row);
  assert.doesNotMatch(row, /undefined/);
});

test("spliceReadmeSummary: replaces content between markers", () => {
  const readme = "before\n<!-- BEGIN JOB SUMMARY -->\nold content\n<!-- END JOB SUMMARY -->\nafter";
  const updated = spliceReadmeSummary(readme, ["new line 1", "new line 2"]);
  assert.match(updated, /new line 1\nnew line 2/);
  assert.doesNotMatch(updated, /old content/);
  assert.match(updated, /^before/);
  assert.match(updated, /after$/);
});

test("spliceReadmeSummary: returns null when markers are missing", () => {
  assert.equal(spliceReadmeSummary("no markers here", ["x"]), null);
});
