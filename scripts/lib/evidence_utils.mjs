
// Utility: build stable evidence ID and create a compact diff snippet
import crypto from 'node:crypto';

/**
 * Build a stable ID from vendor, path and hash.
 * If hash is missing, compute from content.
 */
export function buildStableId({ vendor, path, hash, content }) {
  const v = (vendor || '').trim().toLowerCase();
  const p = (path || '').strip ? ('' + (path || '')).trim() : ('' + (path || '')).trim();
  if (hash && hash.length >= 6) {
    return `${v}/${p}`.replace(/\/+/g, '/').replace(/^\/|\/$/g, '') + '/' + hash;
  }
  const h = crypto.createHash('sha1').update(String(content || '')).digest('hex').slice(0, 12);
  return `${v}/${p}`.replace(/\/+/g, '/').replace(/^\/|\/$/g, '') + '/' + h;
}

/**
 * Create a tiny diff snippet with +/- context lines. The inputs are strings.
 * Returns HTML-safe preformatted snippet with <mark> highlights on changes.
 */
export function diffSnippet(oldText = '', newText = '', { context = 2, maxBlocks = 3, maxChars = 1200 } = {}) {
  const oldLines = String(oldText).split(/\r?\n/);
  const newLines = String(newText).split(/\r?\n/);

  // Simple LCS-based diff to find changed hunks
  const dp = Array.from({ length: oldLines.length + 1 }, () => Array(newLines.length + 1).fill(0));
  for (let i = oldLines.length - 1; i >= 0; i--) {
    for (let j = newLines.length - 1; j >= 0; j--) {
      dp[i][j] = oldLines[i] === newLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  // backtrack to mark kept lines
  let i = 0, j = 0;
  const ops = [];
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      ops.push([' ', oldLines[i]]);
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push(['-', oldLines[i++]]);
    } else {
      ops.push(['+', newLines[j++]]);
    }
  }
  while (i < oldLines.length) ops.push(['-', oldLines[i++]]);
  while (j < newLines.length) ops.push(['+', newLines[j++]]);

  // Group into hunks where +/- appears
  const hunks = [];
  let start = 0;
  while (start < ops.length) {
    // find next change
    while (start < ops.length && ops[start][0] === ' ') start++;
    if (start >= ops.length) break;
    let end = start;
    while (end < ops.length && ops[end][0] !== ' ') end++;
    hunks.push([start, end]);
    start = end;
  }

  // Select up to maxBlocks hunks and include context lines
  const pieces = [];
  let added = 0;
  for (const [hs, he] of hunks) {
    if (added >= maxBlocks) break;
    const cs = Math.max(0, hs - context);
    const ce = Math.min(ops.length, he + context);
    pieces.push([cs, ce]);
    added++;
  }

  function esc(s) {
    return String(s).replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
  }

  let out = '';
  let totalChars = 0;
  for (const [ps, pe] of pieces) {
    if (out) out += '\n<span class="diff-divider">…</span>\n';
    for (let k = ps; k < pe; k++) {
      const [tag, line] = ops[k];
      let cls = tag === '+' ? 'ins' : (tag === '-' ? 'del' : 'ctx');
      let prefix = tag === '+' ? '+' : (tag === '-' ? '-' : ' ');
      let row = `<span class="${cls}">${prefix} ${esc(line)}</span>`;
      out += row + '\n';
      totalChars += row.length;
      if (totalChars > maxChars) break;
    }
    if (totalChars > maxChars) break;
  }

  if (!out) {
    // No diff — show last few lines as context
    const tail = newLines.slice(-Math.max(3, context)).map(l => `<span class="ctx">  ${esc(l)}</span>`).join('\n');
    out = tail + '\n';
  }

  return `<pre class="diff-snippet">\n${out}</pre>`;
}
