import { test } from "node:test";
import assert from "node:assert/strict";
import { jaccard, findDuplicates } from "../lib/duplicates.js";

test("jaccard: identical sets score 1", () => {
  assert.equal(jaccard(new Set(["a", "b"]), new Set(["a", "b"])), 1);
});

test("jaccard: disjoint sets score 0", () => {
  assert.equal(jaccard(new Set(["a"]), new Set(["b"])), 0);
});

test("jaccard: partial overlap", () => {
  // intersection {b} = 1, union {a,b,c} = 3
  assert.equal(jaccard(new Set(["a", "b"]), new Set(["b", "c"])), 1 / 3);
});

test("jaccard: two empty sets score 0, not NaN", () => {
  assert.equal(jaccard(new Set(), new Set()), 0);
});

function job(id, tags, description) {
  return { id, tags: new Set(tags), description: new Set(description) };
}

test("findDuplicates: flags a pair only when both tag AND description overlap clear threshold", () => {
  const jobs = [
    job("a", ["ssl", "cert"], ["check", "expiry"]),
    job("b", ["ssl", "cert"], ["check", "expiry"]),
  ];
  const flagged = findDuplicates(jobs, { tagThreshold: 0.6, descThreshold: 0.5 });
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].a.id, "a");
  assert.equal(flagged[0].b.id, "b");
});

test("findDuplicates: high tag overlap alone does not flag if description diverges", () => {
  // Regression case for the sla-breach-warning / ticket-backlog-aging-check false positive:
  // same tags, but genuinely different jobs (different description vocabulary).
  const jobs = [
    job("sla-breach-warning", ["support", "sla", "tickets"], ["flags", "open", "tickets", "about", "breach"]),
    job("ticket-backlog-aging-check", ["support", "sla", "tickets"], ["checks", "backlog", "aged", "past", "window"]),
  ];
  const flagged = findDuplicates(jobs, { tagThreshold: 0.6, descThreshold: 0.5 });
  assert.equal(flagged.length, 0);
});

test("findDuplicates: high description overlap alone does not flag if tags diverge", () => {
  const jobs = [
    job("a", ["firewall"], ["diff", "rules", "against", "baseline", "flag", "drift"]),
    job("b", ["waf"], ["diff", "rules", "against", "baseline", "flag", "drift"]),
  ];
  const flagged = findDuplicates(jobs, { tagThreshold: 0.6, descThreshold: 0.5 });
  assert.equal(flagged.length, 0);
});

test("findDuplicates: returns results sorted by combined similarity descending", () => {
  const jobs = [
    job("low", ["a", "b", "c", "d"], ["w", "x", "y", "z"]),
    job("high", ["a", "b"], ["w", "x"]),
    job("target", ["a", "b"], ["w", "x"]),
  ];
  const flagged = findDuplicates(jobs, { tagThreshold: 0.1, descThreshold: 0.1 });
  assert.ok(flagged.length >= 1);
  for (let i = 1; i < flagged.length; i++) {
    const prevCombined = flagged[i - 1].tagSim + flagged[i - 1].descSim;
    const currCombined = flagged[i].tagSim + flagged[i].descSim;
    assert.ok(prevCombined >= currCombined);
  }
});

test("findDuplicates: empty input returns empty", () => {
  assert.deepEqual(findDuplicates([]), []);
});
