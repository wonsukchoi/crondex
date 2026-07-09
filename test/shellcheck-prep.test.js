import { test } from "node:test";
import assert from "node:assert/strict";
import { extractPlaceholders, buildShellcheckScript } from "../lib/shellcheck-prep.js";

test("extractPlaceholders: finds unique placeholder names", () => {
  assert.deepEqual(extractPlaceholders('echo "{{host}}:{{port}} and {{host}} again"'), ["host", "port"]);
});

test("extractPlaceholders: no placeholders returns empty array", () => {
  assert.deepEqual(extractPlaceholders("echo hello"), []);
});

test("buildShellcheckScript: declares each placeholder as a header variable", () => {
  const script = buildShellcheckScript('echo "{{host}}"');
  assert.match(script, /^#!\/usr\/bin\/env bash\n/);
  assert.match(script, /host="42"/);
});

test("buildShellcheckScript: substitutes {{name}} with braced variable expansion", () => {
  const script = buildShellcheckScript('echo "{{threshold}}s"');
  // Braced so a literal suffix right after the placeholder (here "s") doesn't glue
  // into the variable name — this is the actual bug lint-shell.js was designed to avoid.
  assert.match(script, /\$\{threshold\}s/);
  assert.doesNotMatch(script, /\$thresholds\b/);
});

test("buildShellcheckScript: a command with no placeholders has an empty header line but still parses", () => {
  const script = buildShellcheckScript("echo hello");
  assert.equal(script, "#!/usr/bin/env bash\n\necho hello");
});
