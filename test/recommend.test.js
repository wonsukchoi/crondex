import { test } from "node:test";
import assert from "node:assert/strict";
import { stem, tokenize, scoreJob, rankJobs } from "../lib/recommend.js";

test("stem: strips plural suffixes", () => {
  assert.equal(stem("checks"), "check");
  assert.equal(stem("policies"), "policy");
  assert.equal(stem("boxes"), "box");
  assert.equal(stem("glasses"), "glasse"); // "es" branch excludes "ses" endings, falls through to plain "-s" strip
  assert.equal(stem("status"), "statu"); // naive stemmer strips any trailing non-"ss" "s" — false positives like this are a known tradeoff
  assert.equal(stem("cat"), "cat"); // too short to strip
});

test("tokenize: lowercases, strips punctuation, drops stopwords, stems", () => {
  assert.deepEqual(
    tokenize("Can you warn me before my SSL certs expire?"),
    ["warn", "before", "ssl", "cert", "expire"]
  );
});

test("tokenize: hyphens split into separate tokens", () => {
  assert.deepEqual(tokenize("no-show reminder"), ["no", "show", "reminder"]);
});

test("tokenize: empty/all-stopword query yields no tokens", () => {
  assert.deepEqual(tokenize("can you help me with this"), []);
});

const jobFixture = (overrides = {}) => ({
  id: "ssl-cert-expiry-check",
  name: "SSL Cert Expiry Check",
  category: "devops",
  tags: ["ssl", "certificates", "expiry"],
  description: "Checks how many days are left before a website's SSL certificate expires.",
  modes: ["script"],
  ...overrides,
});

test("scoreJob: tags weigh more than description", () => {
  const tagHit = scoreJob(["ssl"], jobFixture());
  const descOnlyHit = scoreJob(
    ["website"],
    jobFixture({ tags: [], description: "Checks the website's status." })
  );
  assert.ok(tagHit.score > descOnlyHit.score);
});

test("scoreJob: id and name don't double-count the same shared word", () => {
  // Regression test for the id+name double-counting bug: a query term that
  // matches both `name` and `id` (slugified) should only score once for
  // the merged "title" field, not twice.
  const job = jobFixture({ id: "water-leak-check", name: "Water Leak Check", tags: [] });
  const result = scoreJob(["water"], job);
  assert.equal(result.score, 3); // title weight only, not title*2
});

test("scoreJob: no match yields zero score and no matched terms", () => {
  const result = scoreJob(["gardening"], jobFixture());
  assert.equal(result.score, 0);
  assert.deepEqual(result.matchedTerms, []);
});

test("scoreJob: plural/singular query still matches via stemming", () => {
  // scoreJob expects already-tokenized (stemmed) query terms, same as rankJobs
  // feeds it — tokenize("certs") stems to "cert", matching the job's title token.
  const result = scoreJob(tokenize("certs"), jobFixture());
  assert.ok(result.score > 0);
});

test("rankJobs: ranks higher-scoring job first and respects limit", () => {
  const jobs = [
    jobFixture({ id: "unrelated-job", name: "Unrelated Job", tags: ["unrelated"], description: "Nothing to do with it." }),
    jobFixture(),
    jobFixture({ id: "cert-renewal-reminder", name: "Cert Renewal Reminder", tags: ["cert"], description: "Warns before a cert expires." }),
  ];
  const ranked = rankJobs(jobs, "ssl cert expiry", 2);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].job.id, "ssl-cert-expiry-check");
  assert.ok(ranked[0].score >= ranked[1].score);
});

test("rankJobs: vague/stopword-only query returns nothing", () => {
  assert.deepEqual(rankJobs([jobFixture()], "can you help me with this"), []);
});

test("rankJobs: no jobs score above zero returns empty", () => {
  assert.deepEqual(rankJobs([jobFixture()], "gardening"), []);
});
