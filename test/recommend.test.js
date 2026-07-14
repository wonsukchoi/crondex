import { test } from "node:test";
import assert from "node:assert/strict";
import { stem, tokenize, scoreJob, rankJobs, canonicalize, editDistance } from "../lib/recommend.js";

test("stem: strips plural suffixes", () => {
  assert.equal(stem("checks"), "check");
  assert.equal(stem("policies"), "policy");
  assert.equal(stem("boxes"), "box");
  assert.equal(stem("glasses"), "glasse"); // "es" branch excludes "ses" endings, falls through to plain "-s" strip
  assert.equal(stem("status"), "statu"); // naive stemmer strips any trailing non-"ss" "s" — false positives like this are a known tradeoff
  assert.equal(stem("cat"), "cat"); // too short to strip
});

test("tokenize: lowercases, strips punctuation, drops stopwords, stems, canonicalizes synonyms", () => {
  assert.deepEqual(
    // "warn" canonicalizes to "alert" (see SYNONYM_GROUPS) so it lines up with jobs
    // tagged/described using a different word from the same synonym group.
    tokenize("Can you warn me before my SSL certs expire?"),
    ["alert", "before", "ssl", "cert", "expire"]
  );
});

test("tokenize: hyphens split into separate tokens", () => {
  // "reminder" canonicalizes to "alert", same group as "warn"/"notify"/"remind".
  assert.deepEqual(tokenize("no-show reminder"), ["no", "show", "alert"]);
});

test("tokenize: empty/all-stopword query yields no tokens", () => {
  assert.deepEqual(tokenize("can you help me with this"), []);
});

test("canonicalize: maps every word in a synonym group to the same term", () => {
  assert.equal(canonicalize("warn"), canonicalize("notify"));
  assert.equal(canonicalize("notify"), canonicalize("remind"));
});

test("canonicalize: leaves words with no synonym group untouched", () => {
  assert.equal(canonicalize("ssl"), "ssl");
});

test("editDistance: identical strings are zero apart", () => {
  assert.equal(editDistance("expiry", "expiry"), 0);
});

test("editDistance: single substitution/insertion/deletion counts as one", () => {
  assert.equal(editDistance("expiry", "expiery"), 1);
  assert.equal(editDistance("backup", "backpu"), 2);
});

test("editDistance: short-circuits past max rather than computing the full distance", () => {
  assert.equal(editDistance("expiry", "completely-different"), 3);
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
  const descOnlyHit = scoreJob(["website"], jobFixture({ tags: [], description: "Checks the website's status." }));
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

test("scoreJob: a typo'd query term still fuzzy-matches, at reduced weight vs. an exact hit", () => {
  // scoreJob takes already-tokenized/canonicalized query terms (as rankJobs feeds it
  // via tokenize) — go through tokenize() here too so canonicalization is consistent
  // between the query and the job's own fields.
  const job = jobFixture({ tags: ["backup"], description: "Runs a nightly backup." });
  const exact = scoreJob(tokenize("backup"), job);
  const typo = scoreJob(tokenize("bacup"), job); // dropped the "k"
  assert.ok(typo.score > 0, "typo should still score via fuzzy fallback");
  assert.ok(typo.score < exact.score, "fuzzy match should score lower than an exact match");
});

test("scoreJob: short words don't fuzzy-match each other (avoids false positives like ssl/sql)", () => {
  const result = scoreJob(["sql"], jobFixture({ tags: ["ssl"], description: "" }));
  assert.equal(result.score, 0);
});

test("scoreJob: plural/singular query still matches via stemming", () => {
  // scoreJob expects already-tokenized (stemmed) query terms, same as rankJobs
  // feeds it — tokenize("certs") stems to "cert", matching the job's title token.
  const result = scoreJob(tokenize("certs"), jobFixture());
  assert.ok(result.score > 0);
});

test("rankJobs: ranks higher-scoring job first and respects limit", () => {
  const jobs = [
    jobFixture({
      id: "unrelated-job",
      name: "Unrelated Job",
      tags: ["unrelated"],
      description: "Nothing to do with it.",
    }),
    jobFixture(),
    jobFixture({
      id: "cert-renewal-reminder",
      name: "Cert Renewal Reminder",
      tags: ["cert"],
      description: "Warns before a cert expires.",
    }),
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

test("canonicalize: new synonym groups map catalog-adjacent words together", () => {
  assert.equal(canonicalize("certificate"), canonicalize("certification"));
  assert.equal(canonicalize("license"), canonicalize("permit"));
  assert.equal(canonicalize("warranty"), canonicalize("guarantee"));
  assert.equal(canonicalize("subscription"), canonicalize("membership"));
  assert.equal(canonicalize("vendor"), canonicalize("supplier"));
  assert.equal(canonicalize("credential"), canonicalize("password"));
  assert.equal(canonicalize("capacity"), canonicalize("utilization"));
  assert.equal(canonicalize("headcount"), canonicalize("staffing"));
  // expire/renewal groups were merged — "renew" should now line up with "expiry".
  assert.equal(canonicalize("renew"), canonicalize("expiry"));
  assert.equal(canonicalize("lapse"), canonicalize("expire"));
});

test("rankJobs: 'certificate' query ranks a job tagged 'certification' via the new cert synonym group", () => {
  const job = jobFixture({
    id: "operator-cert-check",
    name: "Operator Certification Check",
    tags: ["certification"],
    description: "Confirms operator certifications are still valid.",
  });
  const ranked = rankJobs([job], "certificate renewal reminder");
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].score > 0);
});

test("rankJobs: 'membership' query matches a job tagged 'subscription'", () => {
  const job = jobFixture({
    id: "subscription-check",
    name: "Subscription Check",
    tags: ["subscription"],
    description: "Tracks active subscriptions.",
  });
  const ranked = rankJobs([job], "membership tracker");
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].score > 0);
});

test("rankJobs: 'supplier' query matches a job tagged 'vendor'", () => {
  const job = jobFixture({
    id: "vendor-check",
    name: "Vendor Review",
    tags: ["vendor"],
    description: "Reviews vendor contracts.",
  });
  const ranked = rankJobs([job], "supplier review");
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].score > 0);
});
