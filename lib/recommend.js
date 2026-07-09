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

// Groups of interchangeable words, grounded in the catalog's actual vocabulary (its
// most common tags/description verbs) rather than a generic thesaurus — this closes
// the gap where a query uses a reasonable synonym the job authors didn't happen to
// write (e.g. "notify" vs. a job tagged "reminder"). Every word in a group maps to
// the group's first entry, applied on both the query and the job's own fields so
// either side using a different synonym still lines up.
const SYNONYM_GROUPS = [
  ["alert", "warn", "notify", "notification", "remind", "reminder"],
  ["check", "monitor", "watch", "scan", "inspect", "verify"],
  ["audit", "review", "compliance"],
  ["expire", "expiry", "expiration"],
  ["backup", "snapshot"],
  ["cost", "spend", "spending", "budget", "expense", "billing"],
  ["fail", "failure", "error", "crash", "outage"],
  ["delete", "remove", "cleanup", "purge", "clear"],
  ["update", "upgrade", "refresh", "sync"],
  ["duplicate", "dedupe", "dup"],
  ["deadline", "due"],
  ["schedule", "scheduling", "calendar", "planning"],
  ["drift", "diff", "change", "changed"],
  ["renew", "renewal"],
  ["followup", "follow-up"],
  ["invoice", "billing", "payment"],
  ["stale", "outdated", "old"],
];

const SYNONYM_MAP = new Map();
for (const group of SYNONYM_GROUPS) {
  for (const word of group) SYNONYM_MAP.set(word, group[0]);
}

export function canonicalize(word) {
  return SYNONYM_MAP.get(word) ?? word;
}

export function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .map(stem)
    .map(canonicalize);
}

// Bounded edit distance — used only as a fallback when no exact token match exists,
// to catch typos/near-misses (e.g. "expiery" vs "expiry") without embeddings or a
// spellcheck dependency. Short-circuits past `max` so it stays cheap across a whole
// catalog scan.
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > max) return max + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

// A query token counts as a fuzzy hit against a field token if they're a short edit
// distance apart — only tried once no exact match exists (see scoreJob), and only for
// words long enough that a 1-2 character slip is plausibly a typo rather than a
// genuinely different short word ("ssl" vs "sql" would otherwise false-positive).
function isFuzzyMatch(queryToken, fieldToken) {
  if (queryToken.length < 5 || fieldToken.length < 5) return false;
  const maxDistance = queryToken.length >= 8 ? 2 : 1;
  return editDistance(queryToken, fieldToken, maxDistance) <= maxDistance;
}

// id and name are near-duplicates of each other (id is just the slugified
// name), so they're merged into one "title" field — otherwise a match on a
// shared word like "water" gets weighted 3+3 instead of 3, which can outrank
// a more specific job that only matches once via tags.
export const RECOMMEND_WEIGHTS = { tags: 4, title: 3, category: 2, description: 1 };

export function scoreJob(queryTokens, job) {
  const fields = {
    tags: job.tags.map((t) => canonicalize(stem(t.toLowerCase()))),
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
      } else if (fields[field].some((ft) => isFuzzyMatch(qt, ft))) {
        // Fuzzy hits count for half weight (rounded up) — a real match still
        // outranks a typo-distance one for the same field.
        score += Math.ceil(weight / 2);
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
