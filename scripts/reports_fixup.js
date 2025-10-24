// scripts/reports_fixup.js
// Fix duplicate headers and broken links inside /public/reports/**/*.html
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd();
const REP = path.join(ROOT, 'public', 'reports');

function* walk(dir){
  const st=[dir];
  while(st.length){
    const d = st.pop();
    let ents=[];
    try { ents = fs.readdirSync(d, {withFileTypes:true}); } catch { continue; }
    for (const e of ents){
      const p = path.join(d, e.name);
      if (e.isDirectory()) st.push(p);
      else if (e.isFile() && e.name.toLowerCase().endsWith('.html')) yield p;
    }
  }
}

function fixHtml(s){
  let changed = false;
  // 1) Remove duplicate <header> - keep the second if there are two or more
  const headers = s.match(/<header\b[^>]*>[\s\S]*?<\/header>/ig) || [];
  if (headers.length >= 2){
    // Remove the *first* occurrence only
    s = s.replace(headers[0], '');
    changed = true;
  }
  // 2) evidence links -> absolute
  //    href="evidence/..." or "../evidence/..." or "./evidence/..." -> "/evidence/..."
  s = s.replace(/href=(['"])(?:\.\.\/|\.\.\\|\.\/|\.\\)?evidence\/([^'"]+)\1/ig, (m,q,rest)=>{
    changed = true; return `href="/evidence/${rest}"`;
  });
  // 3) reports links: /public/reports/... -> /reports/...
  s = s.replace(/href=(['"])\/public\/reports\/([^'"]+)\1/ig, (m,q,rest)=>{
    changed = true; return `href="/reports/${rest}"`;
  });
  // also fix relative "reports/..." to "/reports/..."
  s = s.replace(/href=(['"])(?:\.\.\/|\.\.\\|\.\/|\.\\)?reports\/([^'"]+)\1/ig, (m,q,rest)=>{
    changed = true; return `href="/reports/${rest}"`;
  });
  return {s, changed};
}

function main(){
  if (!fs.existsSync(REP)) { console.log('no public/reports directory'); return; }
  let scanned=0, changed=0;
  for (const file of walk(REP)){
    scanned++;
    const inp = fs.readFileSync(file,'utf8');
    const out = fixHtml(inp);
    if (out.changed){
      fs.writeFileSync(file, out.s, 'utf8');
      changed++;
    }
  }
  console.log(`reports-fixup: scanned=${scanned} changed=${changed}`);
}
main();
