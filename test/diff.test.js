import { test } from "node:test";
import assert from "node:assert/strict";
import { diffLines, formatDiff } from "../lib/diff.js";

test("diffLines: identical texts produce only context ops", () => {
  const ops = diffLines("a\nb\nc", "a\nb\nc");
  assert.ok(ops.every((o) => o.type === "context"));
  assert.equal(ops.length, 3);
});

test("diffLines: a single changed line produces one remove and one add", () => {
  const ops = diffLines("a\nb\nc", "a\nX\nc");
  assert.deepEqual(
    ops.map((o) => o.type),
    ["context", "remove", "add", "context"]
  );
});

test("diffLines: pure addition produces only an add op", () => {
  const ops = diffLines("a\nb", "a\nb\nc");
  assert.deepEqual(
    ops.map((o) => o.type),
    ["context", "context", "add"]
  );
});

test("formatDiff: identical texts return an empty string", () => {
  assert.equal(formatDiff("a\nb\nc", "a\nb\nc"), "");
});

test("formatDiff: reports counts and shows the changed line with +/- prefixes", () => {
  const out = formatDiff("a\nb\nc", "a\nX\nc");
  assert.match(out, /^1 added, 1 removed/);
  assert.match(out, /^- b$/m);
  assert.match(out, /^\+ X$/m);
});

test("formatDiff: collapses unchanged runs far from any change into a single '...'", () => {
  const oldText = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n");
  const newText = oldText.replace("line10", "CHANGED");
  const out = formatDiff(oldText, newText);
  const ellipses = out.split("\n").filter((l) => l.trim() === "...").length;
  assert.ok(ellipses >= 1, "expected unchanged runs to collapse");
  assert.doesNotMatch(out, /line0\n/);
});
