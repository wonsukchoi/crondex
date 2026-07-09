// Turns a crondex `command` field (with {{placeholder}} templating) into a script
// shellcheck can actually parse — pulled out of scripts/lint-shell.js so the
// substitution itself is unit testable (see test/shellcheck-prep.test.js).
//
// crondex substitutes {{placeholders}} as literal text before bash ever sees the
// script, so each placeholder is stood in as a real (braced) bash variable — braced
// so a literal suffix right after it (e.g. "{{days}}d") doesn't get glued into the
// variable name — just to let shellcheck catch actual quoting/syntax bugs.
const PLACEHOLDER_RE = /\{\{\s*(\w+)\s*\}\}/g;

export function extractPlaceholders(command) {
  return [...new Set([...command.matchAll(PLACEHOLDER_RE)].map((m) => m[1]))];
}

export function buildShellcheckScript(command) {
  const placeholders = extractPlaceholders(command);
  const header = placeholders.map((name) => `${name}="42"`).join("\n");
  const body = command.replace(PLACEHOLDER_RE, "$${$1}");
  return `#!/usr/bin/env bash\n${header}\n${body}`;
}
