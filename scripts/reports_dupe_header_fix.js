// scripts/reports_dupe_header_fix.js
// Scan both reports/** and public/reports/**. Remove duplicate headers (keep the one with logo/icon if present).
// Also normalize evidence/report links to absolute paths.
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd();

function* walk(dir){
  const st=[dir];
  while(st.length){
    const d=st.pop();
    let ents=[];
    try{ ents=fs.readdirSync(d,{withFileTypes:true}); }catch{ continue; }
    for(const e of ents){
      const p=path.join(d,e.name);
      if(e.isDirectory()) st.push(p);
      else if(e.isFile() && e.name.toLowerCase().endsWith('.html')) yield p;
    }
  }
}

const TARGETS = [];
if (fs.existsSync(path.join(ROOT, 'reports'))) TARGETS.push(path.join(ROOT,'reports'));
if (fs.existsSync(path.join(ROOT, 'public','reports'))) TARGETS.push(path.join(ROOT,'public','reports'));

function hasLogo(h){
  return /class=["']logo["']/.test(h) || /\/icon\.svg/.test(h) || /class=["'][^"']*app-header/.test(h);
}
function dedupeHeaders(html){
  const re = /<header\b[^>]*>[\s\S]*?<\/header>/ig;
  let headers = html.match(re) || [];
  if (headers.length < 2) return {html, changed:false};
  // prefer keeping the header that has logo/icon; if both, keep the second
  let keepIndex = -1;
  for (let i=0;i<headers.length;i++){ if (hasLogo(headers[i])) { keepIndex = i; break; } }
  if (keepIndex < 0) keepIndex = 1;
  let out = html;
  headers.forEach((h,i)=>{ if (i !== keepIndex) out = out.replace(h, ''); });
  // also prune stray 'Alert' only blocks inside kept header
  const kept = (out.match(re) || [])[0];
  if (kept){
    const pruned = kept
      .replace(/<a(?![^>]*\bclass=['"][^'"]*\blogo\b)[^>]*>\s*(?:CG\s*)?Alert\s*<\/a>/ig, '')
      .replace(/<(?:div|span|h1|h2|p)[^>]*>\s*Alert\s*<\/(?:div|span|h1|h2|p)>/ig, '');
    if (pruned !== kept){
      out = out.replace(kept, pruned);
    }
  }
  return {html: out, changed:true};
}

function normalizeLinks(s){
  let out = s;
  out = out.replace(/href=(['"])(?:\.\.\/|\.\.\\|\.\/|\.\\)?evidence\/([^'"]+)\1/ig, (m,q,rest)=>`href="/evidence/${rest}"`);
  out = out.replace(/href=(['"])\/public\/reports\/([^'"]+)\1/ig, (m,q,rest)=>`href="/reports/${rest}"`);
  out = out.replace(/href=(['"])(?:\.\.\/|\.\.\\|\.\/|\.\\)?reports\/([^'"]+)\1/ig, (m,q,rest)=>`href="/reports/${rest}"`);
  return out;
}

function injectGuard(s){
  // append a small guard that removes first header if 2+ exist
  if (s.includes('reports-dupe-guard')) return s;
  return s.replace(/<\/body>\s*<\/html>\s*$/i, `
<script id="reports-dupe-guard">
(function(){
  try{
    var hs = document.querySelectorAll('body > header');
    if (hs.length >= 2) { hs[0].remove(); }
  }catch(e){}
})();
</script>
</body></html>`);
}

function processFile(file){
  const before = fs.readFileSync(file,'utf8');
  let s = before;
  const r = dedupeHeaders(s);
  s = r.html;
  s = normalizeLinks(s);
  if (/\/reports\//.test(file.replace(/\\/g,'/'))) s = injectGuard(s);
  if (s !== before){
    fs.writeFileSync(file, s, 'utf8');
    return true;
  }
  return false;
}

function main(){
  let scanned=0, changed=0;
  for (const base of TARGETS){
    for (const f of walk(base)){
      scanned++; if (processFile(f)) changed++;
    }
  }
  console.log(`reports-dupe-fix: scanned=${scanned} changed=${changed}`);
}
main();
