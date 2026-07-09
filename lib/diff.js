// Dependency-free line diff — used by `crondex update` to show what actually changed
// in a catalog job instead of just "it changed". Job files are small (tens of lines),
// so a plain O(n*m) LCS table is plenty fast; no need for a real Myers-diff package.

// Returns the line-by-line edit script as {type: "context"|"add"|"remove", line}.
export function diffLines(oldText, newText) {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "context", line: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "remove", line: a[i] });
      i++;
    } else {
      ops.push({ type: "add", line: b[j] });
      j++;
    }
  }
  while (i < n) ops.push({ type: "remove", line: a[i++] });
  while (j < m) ops.push({ type: "add", line: b[j++] });
  return ops;
}

// Renders the edit script as a compact +/-/context diff, collapsing unchanged runs
// longer than 2*context into a single "..." marker so a one-line change in a
// 100-line job doesn't dump the whole file. Returns "" when the texts are identical.
export function formatDiff(oldText, newText, { context = 2 } = {}) {
  const ops = diffLines(oldText, newText);
  const added = ops.filter((o) => o.type === "add").length;
  const removed = ops.filter((o) => o.type === "remove").length;
  if (!added && !removed) return "";

  const keep = new Array(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.type === "context") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(ops.length - 1, idx + context); k++) keep[k] = true;
  });

  const lines = [`${added} added, ${removed} removed`];
  let skipping = false;
  ops.forEach((op, idx) => {
    if (!keep[idx]) {
      if (!skipping) lines.push("  ...");
      skipping = true;
      return;
    }
    skipping = false;
    const prefix = op.type === "add" ? "+ " : op.type === "remove" ? "- " : "  ";
    lines.push(prefix + op.line);
  });
  return lines.join("\n");
}
