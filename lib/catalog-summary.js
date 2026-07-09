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

// Splices summaryLines between the BEGIN/END markers in readmeText. Returns null if
// the markers aren't found (caller decides how to warn/handle that).
export function spliceReadmeSummary(readmeText, summaryLines) {
  const start = readmeText.indexOf(BEGIN);
  const end = readmeText.indexOf(END);
  if (start === -1 || end === -1) return null;
  return readmeText.slice(0, start + BEGIN.length) + "\n" + summaryLines.join("\n") + "\n" + readmeText.slice(end);
}
