// Minimal dependency-free LCS-based word diff -> HTML
function tokenize(text) {
  return text
    .replace(/\r/g, '')
    .split(/(\s+|[^\w\s])/u)
    .filter(t => t !== '');
}
function lcs(a, b) {
  const n = a.length, m = b.length;
  const dp = Array(n+1).fill(null).map(()=>Array(m+1).fill(0));
  for (let i=1;i<=n;i++) for (let j=1;j<=m;j++)
    dp[i][j] = (a[i-1]===b[j-1]) ? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const ops = []; let i=n, j=m;
  while (i>0 && j>0) {
    if (a[i-1]===b[j-1]) { ops.push(['eq', a[i-1]]); i--; j--; }
    else if (dp[i-1][j] >= dp[i][j-1]) { ops.push(['del', a[i-1]]); i--; }
    else { ops.push(['ins', b[j-1]]); j--; }
  }
  while (i>0) { ops.push(['del', a[i-1]]); i--; }
  while (j>0) { ops.push(['ins', b[j-1]]); j--; }
  return ops.reverse();
}
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function opsToHtml(ops) {
  let ins=0, del=0, eq=0;
  const out = ops.map(([op, tok]) => {
    if (op==='eq') { eq++; return escapeHtml(tok); }
    if (op==='ins') { ins++; return `<ins>${escapeHtml(tok)}</ins>`; }
    del++; return `<del>${escapeHtml(tok)}</del>`;
  }).join('');
  return { html: out, stats: {insertions: ins, deletions: del, equals: eq} };
}
function textToTokens(text) {
  const compact = text.replace(/\s+/g, ' ').trim();
  return tokenize(compact);
}
function diffToHtml(oldText, newText) {
  const A = textToTokens(oldText);
  const B = textToTokens(newText);
  const ops = lcs(A, B);
  return opsToHtml(ops);
}
module.exports = { diffToHtml };
