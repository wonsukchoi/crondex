// Near-duplicate detection logic behind scripts/check-duplicates.js — pulled out so
// it's unit testable directly (see test/duplicates.test.js).

export function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  for (const x of a) if (b.has(x)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// jobs: array of { id, tags: Set<string>, description: Set<string>, ...rest }.
// A pair is flagged only when BOTH tag and description overlap clear their
// threshold — tag overlap alone false-positives on jobs that just share a couple
// of generic tags, and description overlap alone false-positives on jobs
// following the same wording template for genuinely different systems.
export function findDuplicates(jobs, { tagThreshold = 0.6, descThreshold = 0.5 } = {}) {
  const flagged = [];
  for (let i = 0; i < jobs.length; i++) {
    for (let j = i + 1; j < jobs.length; j++) {
      const a = jobs[i];
      const b = jobs[j];
      const tagSim = jaccard(a.tags, b.tags);
      const descSim = jaccard(a.description, b.description);
      if (tagSim >= tagThreshold && descSim >= descThreshold) flagged.push({ a, b, tagSim, descSim });
    }
  }
  return flagged.sort((x, y) => y.tagSim + y.descSim - (x.tagSim + x.descSim));
}
