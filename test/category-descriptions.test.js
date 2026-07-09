import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CATEGORY_DESCRIPTIONS } from "../lib/category-descriptions.js";

const ROOT = new URL("..", import.meta.url).pathname;
const catalog = JSON.parse(readFileSync(join(ROOT, "catalog.json"), "utf8"));

test("every category in the catalog has a description", () => {
  const categories = new Set(catalog.jobs.map((j) => j.category));
  const missing = [...categories].filter((c) => !CATEGORY_DESCRIPTIONS[c]);
  assert.deepEqual(missing, [], `missing description(s) in lib/category-descriptions.js: ${missing.join(", ")}`);
});

test("no orphaned description for a category that no longer exists", () => {
  const categories = new Set(catalog.jobs.map((j) => j.category));
  const orphaned = Object.keys(CATEGORY_DESCRIPTIONS).filter((c) => !categories.has(c));
  assert.deepEqual(orphaned, [], `lib/category-descriptions.js has entries for nonexistent categories: ${orphaned.join(", ")}`);
});
