
// scripts/diff_engine.js
// Memory-safe line diff using Hirschberg's algorithm (O(N*M) time, O(min(N,M)) space) with guardrails.
// Produces ops: ['eq'|'ins'|'del', lineString]
const MAX_LINES = parseInt(process.env.DIFF_MAX_LINES || '5000', 10);     // per side hard cap
const MAX_MS    = parseInt(process.env.DIFF_MAX_MS || '5000', 10);        // per pair time cap (ms)

function splitLines(s) {
  return (s || '').replace(/\r/g,'').split('\n');
}

function lcsLen(A, B) {
  // returns last row of DP (lengths) as Int32Array
  const m = B.length;
  let prev = new Int32Array(m+1);
  let curr = new Int32Array(m+1);
  for (let i=1;i<=A.length;i++) {
    for (let j=1;j<=m;j++) {
      if (A[i-1] === B[j-1]) curr[j] = prev[j-1] + 1;
      else curr[j] = (prev[j] >= curr[j-1]) ? prev[j] : curr[j-1];
    }
    // swap
    const t = prev; prev = curr; curr = t;
  }
  return prev;
}

function hirschberg(A, B, startedAt) {
  if (Date.now() - startedAt > MAX_MS) return []; // timeout -> empty LCS (coarse fallback on caller)
  const n = A.length, m = B.length;
  if (n === 0 || m === 0) return [];
  if (n === 1) {
    for (let j=0;j<m;j++) if (A[0] === B[j]) return [A[0]];
    return [];
  }
  const i = Math.floor(n/2);
  const L1 = lcsLen(A.slice(0,i), B);
  const L2 = lcsLen(A.slice(i).slice().reverse(), B.slice().reverse());
  // find k that maximizes L1[k] + L2[m-k]
  let k = 0, best = -1;
  for (let j=0;j<=m;j++) {
    const val = L1[j] + L2[m - j];
    if (val > best) { best = val; k = j; }
  }
  const left  = hirschberg(A.slice(0,i), B.slice(0,k), startedAt);
  const right = hirschberg(A.slice(i),   B.slice(k),   startedAt);
  return left.concat(right);
}

function opsFromLCS(A, B, LCS) {
  const ops = [];
  let i=0, j=0, t=0;
  while (t < LCS.length) {
    const target = LCS[t];
    while (i < A.length && A[i] !== target) { ops.push(['del', A[i]]); i++; }
    while (j < B.length && B[j] !== target) { ops.push(['ins', B[j]]); j++; }
    // match
    ops.push(['eq', target]); i++; j++; t++;
  }
  while (i < A.length) { ops.push(['del', A[i]]); i++; }
  while (j < B.length) { ops.push(['ins', B[j]]); j++; }
  return ops;
}

function coarseOps(A, B) {
  // Fallback: common prefix/suffix, middle as del/ins
  let i=0, j=0;
  while (i < A.length && i < B.length && A[i] === B[i]) i++;
  let aTail = A.length - 1, bTail = B.length - 1;
  while (aTail >= i && bTail >= i && A[aTail] === B[bTail]) { aTail--; bTail--; }
  const ops = [];
  for (let k=0; k<i; k++) ops.push(['eq', A[k]]);
  for (let k=i; k<=aTail; k++) ops.push(['del', A[k]]);
  for (let k=i; k<=bTail; k++) ops.push(['ins', B[k]]);
  for (let k=bTail+1; k<B.length; k++) ops.push(['eq', B[k]]);
  return ops;
}

function diffLines(aText, bText) {
  const A = splitLines(aText), B = splitLines(bText);
  if (A.length > MAX_LINES || B.length > MAX_LINES) {
    return coarseOps(A, B);
  }
  const startedAt = Date.now();
  const lcs = hirschberg(A, B, startedAt);
  if (!lcs.length && (A.length && B.length)) {
    // Could be timeout; fall back to coarse
    return coarseOps(A, B);
  }
  return opsFromLCS(A, B, lcs);
}

function renderHtml(ops) {
  const esc = s => (s||'').replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c]));
  let ins=0, del=0, eq=0;
  const rows = ops.map(([op, line]) => {
    if (op==='eq') { eq++; return `<pre class="row eq"><code>${esc(line)}</code></pre>`; }
    if (op==='ins') { ins++; return `<pre class="row ins"><code>${esc(line)}</code></pre>`; }
    del++; return `<pre class="row del"><code>${esc(line)}</code></pre>`;
  }).join('\n');
  const css = `
  <style>
    body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;line-height:1.45;padding:16px;max-width:1100px;margin:auto}
    header{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
    .meta{font-size:12px;color:#666}
    .box{background:#fafafa;border:1px solid #eee;border-radius:12px;padding:14px}
    .stats{font-size:13px;color:#555}
    pre{white-space:pre-wrap;margin:0;padding:6px 10px;border-radius:8px}
    .row.eq{background:#fff}
    .row.ins{background:#e6ffed;border:1px solid #b7efc0}
    .row.del{background:#ffeef0;border:1px solid #f5b5bb;text-decoration:line-through}
    code{font-family:ui-monospace,SFMono-Regular,Consolas,Monaco,monospace}
    .btn{padding:8px 12px;border:1px solid #ddd;border-radius:8px;text-decoration:none;color:inherit}
  </style>`;
  const summary = `<div class="box stats">Insertions: ${ins} · Deletions: ${del} · Unchanged lines: ${eq}</div>`;
  return { html: `${css}\n${summary}\n${rows}`, stats: {insertions: ins, deletions: del, equals: eq} };
}

module.exports = { diffLines, renderHtml };
