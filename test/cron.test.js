import { test } from "node:test";
import assert from "node:assert/strict";
import { isValidSchedule, nextRuns, parseSchedule } from "../lib/cron.js";

test("isValidSchedule: accepts a standard 5-field expression", () => {
  assert.deepEqual(isValidSchedule("0 9 * * 1-5"), { valid: true });
});

test("isValidSchedule: accepts wildcards, lists, ranges, and steps", () => {
  assert.equal(isValidSchedule("*/15 0,12 1-15 */2 *").valid, true);
});

test("isValidSchedule: rejects wrong field count", () => {
  const result = isValidSchedule("0 9 * *");
  assert.equal(result.valid, false);
  assert.match(result.error, /expected 5 fields/);
});

test("isValidSchedule: rejects an out-of-range value", () => {
  const result = isValidSchedule("99 * * * *");
  assert.equal(result.valid, false);
  assert.match(result.error, /out of range/);
});

test("isValidSchedule: rejects garbage in a field", () => {
  const result = isValidSchedule("0 9 * * mon");
  assert.equal(result.valid, false);
});

test("isValidSchedule: rejects an empty schedule", () => {
  assert.equal(isValidSchedule("").valid, false);
  assert.equal(isValidSchedule(undefined).valid, false);
});

test("parseSchedule: day-of-week 7 folds to 0 (Sunday)", () => {
  const parsed = parseSchedule("0 0 * * 7");
  assert.ok(parsed.dayOfWeek.has(0));
  assert.equal(parsed.dayOfWeek.has(7), false);
});

test("nextRuns: daily schedule returns times exactly 24h apart", () => {
  const from = new Date("2026-01-01T00:00:00Z");
  const runs = nextRuns("0 9 * * *", { timezone: "UTC", count: 3, from });
  assert.equal(runs.length, 3);
  assert.equal(runs[0].toISOString(), "2026-01-01T09:00:00.000Z");
  assert.equal(runs[1].toISOString(), "2026-01-02T09:00:00.000Z");
  assert.equal(runs[2].toISOString(), "2026-01-03T09:00:00.000Z");
});

test("nextRuns: weekday-only schedule skips the weekend", () => {
  // 2026-01-01 is a Thursday.
  const from = new Date("2026-01-01T10:00:00Z");
  const runs = nextRuns("0 9 * * 1-5", { timezone: "UTC", count: 3, from });
  assert.equal(runs[0].toISOString(), "2026-01-02T09:00:00.000Z"); // Friday
  assert.equal(runs[1].toISOString(), "2026-01-05T09:00:00.000Z"); // Monday
  assert.equal(runs[2].toISOString(), "2026-01-06T09:00:00.000Z"); // Tuesday
});

test("nextRuns: respects a non-UTC timezone", () => {
  const from = new Date("2026-01-01T00:00:00Z");
  const runs = nextRuns("0 9 * * *", { timezone: "America/Los_Angeles", count: 1, from });
  // 09:00 America/Los_Angeles on 2026-01-01 (PST, UTC-8) is 17:00 UTC.
  assert.equal(runs[0].toISOString(), "2026-01-01T17:00:00.000Z");
});

test("nextRuns: results are strictly after `from`, even on an exact boundary minute", () => {
  const from = new Date("2026-01-01T09:00:00Z");
  const runs = nextRuns("0 9 * * *", { timezone: "UTC", count: 1, from });
  assert.equal(runs[0].toISOString(), "2026-01-02T09:00:00.000Z");
});

test("nextRuns: throws for an invalid schedule", () => {
  assert.throws(() => nextRuns("not a cron"), /expected 5 fields/);
});
