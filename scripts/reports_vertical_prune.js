// scripts/reports_vertical_prune.js
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd();
const REP = path.join(ROOT, 'public', 'reports');

function* walk(dir){
  const st=[dir];
  while(st.length){
    const d=st.pop();
    let ents=[];
    try{ ents = fs.readdirSync(d,{withFileTypes:true}); }catch{ continue; }
    for(const e of ents){
      const p=path.join(d,e.name);
      if(e.isDirectory()) st.push(p);
      else if(e.isFile() && e.name.toLowerCase().endsWith('.html')) yield p;
    }
  }
}

function pruneVerticalBrand(headerHtml){
  let h = headerHtml;
  // Remove any element inside header whose textContent (rough approximation) is exactly 'Alert' or 'CG Alert' and is not class="logo"
  // 1) kill <a ...>CG Alert</a> when it is NOT class=logo
  h = h.replace(/<a(?![^>]*\bclass=['"][^'"]*\blogo\b)[^>]*>\s*(?:CG\s*)?Alert\s*<\/a>/ig, '');
  // 2) kill lone 'Alert' blocks inside header (div/span/h1/h2)
  h = h.replace(/<(?:div|span|h1|h2|p)[^>]*>\s*Alert\s*<\/(?:div|span|h1|h2|p)>/ig, '');
  // 3) collapse multiple spaces/newlines
  h = h.replace(/\n{3,}/g, "\n\n");
  return h;
}

function fixHtml(html){
  let s = html;
  let changed = false;
  // Find all headers
  const headers = s.match(/<header\b[^>]*>[\s\S]*?<\/header>/ig) || [];
  if (headers.length >= 2){
    // Prefer to keep the one with class app-header; remove the other
    let keepIdx = headers.findIndex(h => /\bapp-header\b/.test(h));
    if (keepIdx < 0) keepIdx = 1; // keep second by default
    for(let i=0;i<headers.length;i++){
      let h = headers[i];
      let pruned = pruneVerticalBrand(h);
      if (i !== keepIdx){
        s = s.replace(h, ''); changed = true;
      }else if (pruned !== h){
        s = s.replace(h, pruned); changed = true;
      }
    }
  } else if (headers.length === 1){
    const h = headers[0];
    const pruned = pruneVerticalBrand(h);
    if (pruned !== h){ s = s.replace(h, pruned); changed = true; }
  }
  // Normalize links
  s = s.replace(/href=(['"])(?:\.\.\/|\.\.\\|\.\/|\.\\)?evidence\/([^'"]+)\1/ig, (m,q,rest)=>{ changed=true; return `href="/evidence/${rest}"`; });
  s = s.replace(/href=(['"])\/public\/reports\/([^'"]+)\1/ig, (m,q,rest)=>{ changed=true; return `href="/reports/${rest}"`; });
  s = s.replace(/href=(['"])(?:\.\.\/|\.\.\\|\.\/|\.\\)?reports\/([^'"]+)\1/ig, (m,q,rest)=>{ changed=true; return `href="/reports/${rest}"`; });
  return {s, changed};
}

function main(){
  if (!fs.existsSync(REP)) { console.log("no public/reports"); return; }
  let scanned=0, fixed=0;
  for (const file of walk(REP)){
    const inp = fs.readFileSync(file,'utf8'); scanned++;
    const out = fixHtml(inp);
    if (out.changed){
      fs.writeFileSync(file, out.s, 'utf8'); fixed++;
    }
  }
  console.log(`reports-vertical-prune: scanned=${scanned} fixed=${fixed}`);
}
main();
