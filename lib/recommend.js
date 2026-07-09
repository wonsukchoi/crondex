// Scoring logic behind `crondex recommend` — pulled out of bin/crondex.js so it can
// be unit tested directly (see test/recommend.test.js).

export const STOPWORDS = new Set([
  "a", "an", "the", "to", "for", "of", "in", "on", "at", "by", "and", "or", "my", "me", "i",
  "can", "you", "do", "does", "this", "that", "these", "those", "please", "want", "wants",
  "wanted", "need", "needs", "help", "with", "is", "are", "be", "it", "so", "when", "should",
  "could", "would", "how", "what", "which", "up", "down", "get", "make", "set", "just", "really",
  "some", "something", "any", "want", "us", "our", "your", "yours", "if", "then", "than",
]);

export function stem(word) {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && word.endsWith("es") && !word.endsWith("ses")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem);
}

// id and name are near-duplicates of each other (id is just the slugified
// name), so they're merged into one "title" field — otherwise a match on a
// shared word like "water" gets weighted 3+3 instead of 3, which can outrank
// a more specific job that only matches once via tags.
export const RECOMMEND_WEIGHTS = { tags: 4, title: 3, category: 2, description: 1 };

export function scoreJob(queryTokens, job) {
  const fields = {
    tags: job.tags.map((t) => stem(t.toLowerCase())),
    title: [...new Set([...tokenize(job.name), ...tokenize(job.id.replace(/-/g, " "))])],
    category: tokenize(job.category ?? ""),
    description: tokenize(job.description ?? ""),
  };
  let score = 0;
  const matched = new Set();
  for (const qt of queryTokens) {
    for (const [field, weight] of Object.entries(RECOMMEND_WEIGHTS)) {
      if (fields[field].includes(qt)) {
        score += weight;
        matched.add(qt);
      }
    }
  }
  return { score, matchedTerms: [...matched] };
}

export function rankJobs(jobs, queryText, limit = 5) {
  const queryTokens = tokenize(queryText);
  if (!queryTokens.length) return [];
  return jobs
    .map((job) => ({ job, ...scoreJob(queryTokens, job) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
