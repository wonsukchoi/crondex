// Catalog-building logic behind scripts/build-catalog.js — pulled out so it's unit
// testable directly (see test/catalog-summary.test.js).

export const MODES_BY_RUNNER = {
  "agent-prompt": ["agent-prompt"],
  shell: ["script"],
  hybrid: ["script", "agent-prompt"],
};

export function modesForRunner(runner) {
  return MODES_BY_RUNNER[runner] ?? [];
}

export function countByCategory(jobs) {
  const counts = new Map();
  for (const j of jobs) counts.set(j.category, (counts.get(j.category) ?? 0) + 1);
  return counts;
}

export function findMissingDescriptions(categories, categoryDescriptions) {
  return categories.filter((c) => !categoryDescriptions[c]);
}

// Builds the markdown lines that go between the BEGIN/END JOB SUMMARY markers.
export function buildSummaryLines(jobs, categoryDescriptions) {
  const byCategory = countByCategory(jobs);
  const categories = [...byCategory.keys()].sort();
  return [
    `${jobs.length} jobs across ${categories.length} categories:`,
    "",
    "| category | jobs | description |",
    "|---|---|---|",
    ...categories.map((c) => `| \`${c}\` | ${byCategory.get(c)} | ${categoryDescriptions[c] ?? ""} |`),
  ];
}

const BEGIN = "<!-- BEGIN JOB SUMMARY -->";
const END = "<!-- END JOB SUMMARY -->";

// Splices `lines` between a `beginMarker`/`endMarker` pair anywhere in `text`. Returns
// null if either marker isn't found (caller decides how to warn/handle that). Generic
// so it can splice a generated block into any markdown file (README's job table,
// ROADMAP's catalog stats, etc.) — not just the original README use case.
export function spliceMarkedSection(text, beginMarker, endMarker, lines) {
  const start = text.indexOf(beginMarker);
  const end = text.indexOf(endMarker);
  if (start === -1 || end === -1) return null;
  return text.slice(0, start + beginMarker.length) + "\n" + lines.join("\n") + "\n" + text.slice(end);
}

// Splices summaryLines between the BEGIN/END JOB SUMMARY markers in readmeText.
// Returns null if the markers aren't found (caller decides how to warn/handle that).
export function spliceReadmeSummary(readmeText, summaryLines) {
  return spliceMarkedSection(readmeText, BEGIN, END, summaryLines);
}

// Builds the single-line "N jobs across M categories, as of vX.Y.Z" stats line that
// goes between ROADMAP.md's BEGIN/END CATALOG STATS markers, so it can't drift out of
// sync with catalog.json the way the old hand-maintained note did.
export function buildRoadmapStatsLine(jobs, categoryCount, version) {
  return `- **Catalog**: ${jobs.length} jobs across ${categoryCount} categories, as of ${version}.`;
}
