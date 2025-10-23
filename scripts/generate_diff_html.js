    #!/usr/bin/env node
    const fs = require('fs');
    const path = require('path');

    const root = process.argv[2] || 'public/evidence';

    function listDirs(p) {
      try { return fs.readdirSync(p, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>path.join(p,d.name)); }
      catch(e){ return []; }
    }

    function readIf(p) {
      try { return fs.readFileSync(p,'utf8'); } catch(e){ return null; }
    }

    function ensureDir(p) { fs.mkdirSync(p, {recursive:true}); }

    function htmlEscape(s){ return s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

    function diffLines(a, b) {
      const A = a.split(/\r?\n/);
      const B = b.split(/\r?\n/);
      const n=A.length, m=B.length;
      const dp = Array.from({length:n+1}, ()=>Array(m+1).fill(0));
      for (let i=1;i<=n;i++) for (let j=1;j<=m;j++) dp[i][j] = A[i-1]===B[j-1]? dp[i-1][j-1]+1 : Math.max(dp[i-1][j], dp[i][j-1]);
      const ops=[];
      let i=n, j=m;
      while (i>0 || j>0) {
        if (i>0 && j>0 && A[i-1]===B[j-1]) { ops.push({type:'eq', text:A[i-1]}); i--; j--; }
        else if (j>0 && (i===0 || dp[i][j-1] >= dp[i-1][j])) { ops.push({type:'ins', text:B[j-1]}); j--; }
        else { ops.push({type:'del', text:A[i-1]}); i--; }
      }
      ops.reverse();
      return ops;
    }

    function renderHTML(title, ops) {
      const rows = ops.map(op => {
        if (op.type==='eq') return `<div class="eq">${htmlEscape(op.text)}</div>`;
        if (op.type==='del') return `<div class="del">- ${htmlEscape(op.text)}</div>`;
        return `<div class="ins">+ ${htmlEscape(op.text)}</div>`;
      }).join('\n');
      return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>${htmlEscape(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font:14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; padding:16px; max-width:1000px; margin:0 auto;}
h1{font-size:18px;margin:0 0 12px 0}
.eq{background:#f9f9f9;padding:2px 6px;border-left:4px solid #eee;white-space:pre-wrap}
.del{background:#fff5f5;padding:2px 6px;border-left:4px solid #e11;white-space:pre-wrap;text-decoration:line-through;}
.ins{background:#f5fff5;padding:2px 6px;border-left:4px solid #1a1;white-space:pre-wrap;}
.meta{font-size:12px;color:#666;margin-bottom:8px}
</style>
</head>
<body>
<h1>Change Diff</h1>
<div class="meta">Auto-generated visual diff</div>
${rows}
</body></html>`;
    }

    function processPack(dir) {
      const candidates = [
        ['prev.txt','curr.txt'],
        ['before.txt','after.txt'],
        ['old.txt','new.txt']
      ];
      let pair=null;
      for (const [a,b] of candidates) {
        const A = path.join(dir, a);
        const B = path.join(dir, b);
        if (fs.existsSync(A) && fs.existsSync(B)) { pair=[A,B]; break; }
      }
      if (!pair) return false;
      const [A,B]=pair;
      const a=readIf(A), b=readIf(B);
      if (a==null || b==null) return false;
      const ops = diffLines(a,b);
      const html = renderHTML(path.basename(dir), ops);
      fs.writeFileSync(path.join(dir,'diff.html'), html, 'utf8');
      fs.writeFileSync(path.join(dir,'diff.json'), JSON.stringify(ops, null, 2), 'utf8');
      return true;
    }

    let count=0;
    const L1 = listDirs(root);
    for (const d1 of L1) {
      for (const d2 of listDirs(d1)) {
        for (const d3 of listDirs(d2)) {
          if (processPack(d3)) count++;
        }
      }
    }
    console.log(`[diff] generated ${count} diff pages`);
