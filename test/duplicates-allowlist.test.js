import { test } from "node:test";
import assert from "node:assert/strict";
import { isAllowedPair, ALLOWED_DUPLICATE_PAIRS } from "../lib/duplicates-allowlist.js";

test("isAllowedPair: matches regardless of argument order", () => {
  const [idA, idB] = ALLOWED_DUPLICATE_PAIRS[0];
  assert.equal(isAllowedPair(idA, idB), true);
  assert.equal(isAllowedPair(idB, idA), true);
});

test("isAllowedPair: unrelated ids are not allowed", () => {
  assert.equal(isAllowedPair("some-job", "some-other-job"), false);
});

test("every allowlist entry has a reason", () => {
  for (const [a, b, reason] of ALLOWED_DUPLICATE_PAIRS) {
    assert.ok(reason && reason.length > 0, `${a} <-> ${b} has no reason recorded`);
  }
});
