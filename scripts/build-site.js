#!/usr/bin/env node
// Generates a static, self-contained catalog browser from catalog.json into site/.
//
// Output layout:
//   site/index.html      single-page app: client-side search, category filter,
//                         job cards, hash-routed job detail (#/job/<id>).
//                         Inline CSS + JS only, no CDN/external dependencies.
//   site/jobs/<id>.yaml   raw copy of each job's YAML source, fetched on demand
//                         by the detail view so index.html itself stays small.
//
// Run: node scripts/build-site.js
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SITE_DIR = join(ROOT, "site");
const JOBS_OUT_DIR = join(SITE_DIR, "jobs");

const catalog = JSON.parse(readFileSync(join(ROOT, "catalog.json"), "utf8"));

// Reset output dir.
if (existsSync(SITE_DIR)) rmSync(SITE_DIR, { recursive: true, force: true });
mkdirSync(JOBS_OUT_DIR, { recursive: true });

// Lightweight catalog embedded directly in index.html for search/filter/cards.
// Full YAML is NOT embedded here (it would blow the page well past a few MB for
// ~1900 jobs) — instead each job's raw YAML is written to site/jobs/<id>.yaml and
// fetched on demand when the user opens a job's detail view.
const lightJobs = catalog.jobs.map((job) => ({
  id: job.id,
  name: job.name,
  description: job.description ?? "",
  category: job.category,
  tags: job.tags ?? [],
  schedule: job.schedule,
  timezone: job.timezone ?? null,
  runner: job.runner,
  path: job.path,
}));

let missing = 0;
for (const job of catalog.jobs) {
  const src = join(ROOT, job.path);
  if (!existsSync(src)) {
    missing++;
    console.warn(`build-site: missing source file for ${job.id} (${job.path}), skipping`);
    continue;
  }
  const yamlText = readFileSync(src, "utf8");
  writeFileSync(join(JOBS_OUT_DIR, `${job.id}.yaml`), yamlText);
}

const categories = [...new Set(lightJobs.map((j) => j.category))].sort();

const catalogJson = JSON.stringify(lightJobs);
const categoriesJson = JSON.stringify(categories);

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>crondex catalog</title>
<meta name="description" content="Browse ${lightJobs.length} pre-made, agent-editable cron jobs.">
<style>
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --bg-elevated: #f6f7f9;
  --fg: #1a1d23;
  --fg-muted: #5b6270;
  --border: #e2e5ea;
  --accent: #2f6feb;
  --accent-fg: #ffffff;
  --card-bg: #ffffff;
  --code-bg: #f3f4f7;
  --tag-bg: #eef1f6;
  --tag-fg: #3a4150;
  --shadow: 0 1px 2px rgba(20, 24, 32, 0.06);
  --radius: 10px;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14161b;
    --bg-elevated: #1b1e25;
    --fg: #e7e9ee;
    --fg-muted: #9aa1b0;
    --border: #2a2e38;
    --accent: #6ea8ff;
    --accent-fg: #0d1117;
    --card-bg: #1b1e25;
    --code-bg: #101216;
    --tag-bg: #232733;
    --tag-fg: #b7bdca;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
  }
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  line-height: 1.5;
  min-height: 100vh;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
header {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--bg);
  border-bottom: 1px solid var(--border);
  padding: 1rem 1.25rem;
}
header .header-inner {
  max-width: 1100px;
  margin: 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem;
}
header h1 {
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0;
  white-space: nowrap;
}
header h1 .count {
  font-weight: 400;
  color: var(--fg-muted);
  font-size: 0.85rem;
}
.controls {
  display: flex;
  flex: 1 1 320px;
  gap: 0.5rem;
  min-width: 0;
}
input[type="search"], select {
  font: inherit;
  padding: 0.5rem 0.7rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--fg);
}
input[type="search"] { flex: 1 1 auto; min-width: 0; }
input[type="search"]:focus, select:focus {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}
main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.25rem;
}
#results-meta {
  color: var(--fg-muted);
  font-size: 0.85rem;
  margin: 0 0 0.85rem;
}
#grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 0.85rem;
}
.card {
  background: var(--card-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 0.9rem 1rem;
  box-shadow: var(--shadow);
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  cursor: pointer;
}
.card:hover { border-color: var(--accent); }
.card h3 {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 650;
}
.card .desc {
  color: var(--fg-muted);
  font-size: 0.82rem;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.card .meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  font-size: 0.72rem;
  color: var(--fg-muted);
  margin-top: auto;
}
.pill {
  background: var(--tag-bg);
  color: var(--tag-fg);
  border-radius: 999px;
  padding: 0.15rem 0.55rem;
  font-size: 0.72rem;
  white-space: nowrap;
}
.pill.cat { background: var(--accent); color: var(--accent-fg); }
code, pre, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
#empty {
  display: none;
  color: var(--fg-muted);
  padding: 2.5rem 0;
  text-align: center;
}
/* Detail view */
#detail {
  display: none;
}
#detail .back {
  display: inline-block;
  margin-bottom: 1rem;
  font-size: 0.85rem;
}
#detail h2 {
  margin: 0 0 0.25rem;
  font-size: 1.35rem;
}
#detail .id { color: var(--fg-muted); font-size: 0.85rem; margin-bottom: 0.75rem; }
#detail .desc { margin: 0.5rem 0 1rem; color: var(--fg); }
#detail .meta-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 0.6rem;
  margin-bottom: 1rem;
}
#detail .meta-box {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 0.6rem 0.75rem;
}
#detail .meta-box .label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--fg-muted);
  margin-bottom: 0.2rem;
}
#detail .meta-box .value { font-size: 0.88rem; word-break: break-word; }
#detail .tags { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-bottom: 1rem; }
#yaml-wrap {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: auto;
  max-height: 65vh;
}
#yaml-wrap pre {
  margin: 0;
  padding: 1rem;
  font-size: 0.82rem;
  white-space: pre;
}
#yaml-status { color: var(--fg-muted); font-size: 0.85rem; }
footer {
  max-width: 1100px;
  margin: 2rem auto 1.5rem;
  padding: 0 1.25rem;
  color: var(--fg-muted);
  font-size: 0.78rem;
}
</style>
</head>
<body>
<header>
  <div class="header-inner">
    <h1>crondex <span class="count" id="count-label"></span></h1>
    <div class="controls">
      <input type="search" id="search" placeholder="Search jobs by name, description, tag..." autocomplete="off">
      <select id="category-filter">
        <option value="">All categories</option>
      </select>
    </div>
  </div>
</header>
<main>
  <section id="browse">
    <p id="results-meta"></p>
    <div id="grid"></div>
    <p id="empty">No jobs match your search.</p>
  </section>
  <section id="detail">
    <a href="#/" class="back">&larr; Back to all jobs</a>
    <h2 id="d-name"></h2>
    <div class="id" id="d-id"></div>
    <p class="desc" id="d-desc"></p>
    <div class="meta-grid">
      <div class="meta-box"><div class="label">Category</div><div class="value" id="d-category"></div></div>
      <div class="meta-box"><div class="label">Schedule</div><div class="value mono" id="d-schedule"></div></div>
      <div class="meta-box"><div class="label">Timezone</div><div class="value" id="d-timezone"></div></div>
      <div class="meta-box"><div class="label">Runner</div><div class="value" id="d-runner"></div></div>
    </div>
    <div class="tags" id="d-tags"></div>
    <h3>Job YAML</h3>
    <p id="yaml-status"></p>
    <div id="yaml-wrap"><pre id="d-yaml"></pre></div>
  </section>
</main>
<footer>
  Generated by scripts/build-site.js from catalog.json &mdash; ${lightJobs.length} jobs.
</footer>
<script>
(function () {
  "use strict";
  var CATALOG = ${catalogJson};
  var CATEGORIES = ${categoriesJson};

  // Precompute a lowercase search blob per job.
  for (var i = 0; i < CATALOG.length; i++) {
    var j = CATALOG[i];
    j._search = [j.id, j.name, j.description, j.category, (j.tags || []).join(" ")]
      .join(" ")
      .toLowerCase();
  }

  var byId = {};
  for (var i2 = 0; i2 < CATALOG.length; i2++) byId[CATALOG[i2].id] = CATALOG[i2];

  var searchInput = document.getElementById("search");
  var categorySelect = document.getElementById("category-filter");
  var grid = document.getElementById("grid");
  var emptyEl = document.getElementById("empty");
  var resultsMeta = document.getElementById("results-meta");
  var countLabel = document.getElementById("count-label");
  var browseSection = document.getElementById("browse");
  var detailSection = document.getElementById("detail");

  countLabel.textContent = "(" + CATALOG.length + " jobs)";

  CATEGORIES.forEach(function (cat) {
    var opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    categorySelect.appendChild(opt);
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function cardHtml(job) {
    var tags = (job.tags || [])
      .slice(0, 4)
      .map(function (t) { return '<span class="pill">' + escapeHtml(t) + "</span>"; })
      .join("");
    return (
      '<article class="card" data-id="' + escapeHtml(job.id) + '" tabindex="0" role="button" aria-label="Open ' +
      escapeHtml(job.name) + '">' +
      "<h3>" + escapeHtml(job.name) + "</h3>" +
      '<p class="desc">' + escapeHtml(job.description) + "</p>" +
      '<div class="meta-row">' +
      '<span class="pill cat">' + escapeHtml(job.category) + "</span>" +
      '<span class="pill mono">' + escapeHtml(job.schedule) + "</span>" +
      '<span class="pill">' + escapeHtml(job.runner) + "</span>" +
      tags +
      "</div>" +
      "</article>"
    );
  }

  function currentFilters() {
    return {
      q: searchInput.value.trim().toLowerCase(),
      category: categorySelect.value,
    };
  }

  function filteredJobs() {
    var f = currentFilters();
    return CATALOG.filter(function (job) {
      if (f.category && job.category !== f.category) return false;
      if (f.q && job._search.indexOf(f.q) === -1) return false;
      return true;
    });
  }

  function renderGrid() {
    var jobs = filteredJobs();
    resultsMeta.textContent = jobs.length + " of " + CATALOG.length + " jobs";
    if (jobs.length === 0) {
      grid.innerHTML = "";
      emptyEl.style.display = "block";
      return;
    }
    emptyEl.style.display = "none";
    // Cap rendered cards for very broad queries to keep the DOM light; search narrows it down.
    var MAX_RENDER = 400;
    var toRender = jobs.slice(0, MAX_RENDER);
    grid.innerHTML = toRender.map(cardHtml).join("");
    if (jobs.length > MAX_RENDER) {
      resultsMeta.textContent += " (showing first " + MAX_RENDER + " — refine your search to see more)";
    }
  }

  grid.addEventListener("click", function (e) {
    var card = e.target.closest(".card");
    if (!card) return;
    location.hash = "#/job/" + encodeURIComponent(card.getAttribute("data-id"));
  });
  grid.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var card = e.target.closest(".card");
    if (!card) return;
    e.preventDefault();
    location.hash = "#/job/" + encodeURIComponent(card.getAttribute("data-id"));
  });

  searchInput.addEventListener("input", renderGrid);
  categorySelect.addEventListener("change", renderGrid);

  var yamlCache = {};

  function renderDetail(id) {
    var job = byId[id];
    if (!job) {
      location.hash = "#/";
      return;
    }
    document.getElementById("d-name").textContent = job.name;
    document.getElementById("d-id").textContent = job.id + " · v" + (job.version || 1);
    document.getElementById("d-desc").textContent = job.description;
    document.getElementById("d-category").textContent = job.category;
    document.getElementById("d-schedule").textContent = job.schedule;
    document.getElementById("d-timezone").textContent = job.timezone || "—";
    document.getElementById("d-runner").textContent = job.runner;
    document.getElementById("d-tags").innerHTML = (job.tags || [])
      .map(function (t) { return '<span class="pill">' + escapeHtml(t) + "</span>"; })
      .join("");

    var yamlEl = document.getElementById("d-yaml");
    var statusEl = document.getElementById("yaml-status");
    document.title = job.name + " · crondex";

    if (yamlCache[id]) {
      statusEl.textContent = "";
      yamlEl.textContent = yamlCache[id];
    } else {
      yamlEl.textContent = "";
      statusEl.textContent = "Loading YAML…";
      fetch("jobs/" + encodeURIComponent(id) + ".yaml")
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.text();
        })
        .then(function (text) {
          yamlCache[id] = text;
          statusEl.textContent = "";
          yamlEl.textContent = text;
        })
        .catch(function (err) {
          statusEl.textContent =
            "Could not load YAML (" + err.message + "). " +
            "If you opened this file directly from disk, serve the site over http instead " +
            "(e.g. \\"python3 -m http.server\\" from the site/ directory) — browsers block " +
            "same-origin fetch() for file:// pages.";
        });
    }
  }

  function route() {
    var hash = location.hash || "#/";
    var m = hash.match(/^#\\/job\\/(.+)$/);
    if (m) {
      browseSection.style.display = "none";
      detailSection.style.display = "block";
      renderDetail(decodeURIComponent(m[1]));
    } else {
      detailSection.style.display = "none";
      browseSection.style.display = "block";
      document.title = "crondex catalog";
    }
  }

  window.addEventListener("hashchange", route);
  renderGrid();
  route();
})();
</script>
</body>
</html>
`;

writeFileSync(join(SITE_DIR, "index.html"), html);

console.log(`wrote site/index.html (${lightJobs.length} jobs indexed)`);
console.log(`wrote ${lightJobs.length - missing} job YAML files to site/jobs/`);
if (missing > 0) console.warn(`warning: ${missing} job(s) had no source file on disk`);
