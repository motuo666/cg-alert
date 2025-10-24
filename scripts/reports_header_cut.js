// scripts/reports_header_cut.js
// Remove any page-scoped <header> from vendor report pages so only site-shell header remains.
// Also ensure CSS links present and normalize evidence/report links.
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd();
const TARGETS = [];
if (fs.existsSync(path.join(ROOT,'reports'))) TARGETS.push(path.join(ROOT,'reports'));
if (fs.existsSync(path.join(ROOT,'public','reports'))) TARGETS.push(path.join(ROOT,'public','reports'));

function* walk(dir){
  const st=[dir];
  while(st.length){
    const d=st.pop();
    let ents=[];
    try { ents = fs.readdirSync(d, {withFileTypes:true}); } catch { continue; }
    for (const e of ents){
      const p = path.join(d, e.name);
      if (e.isDirectory()) st.push(p);
      else if (e.isFile() && e.name.toLowerCase()==='index.html') yield p;
    }
  }
}

function ensureCssHead(html){
  let s = html;
  // insert CSS links if not present
  if (!/href=["']\/styles\.css["']/.test(s)){
    s = s.replace(/<\/head>/i, '  <link rel="stylesheet" href="/styles.css">\n</head>');
  }
  if (!/href=["']\/assets\/cg-theme\.css["']/.test(s)){
    s = s.replace(/<\/head>/i, '  <link rel="stylesheet" href="/assets/cg-theme.css">\n</head>');
  }
  return s;
}

function normalizeLinks(s){
  s = s.replace(/href=(['"])(?:\.\.\/|\.\.\\|\.\/|\.\\)?evidence\/([^'"]+)\1/ig, (m,q,rest)=>`href="/evidence/${rest}"`);
  s = s.replace(/href=(['"])\/public\/reports\/([^'"]+)\1/ig, (m,q,rest)=>`href="/reports/${rest}"`);
  s = s.replace(/href=(['"])(?:\.\.\/|\.\.\\|\.\/|\.\\)?reports\/([^'"]+)\1/ig, (m,q,rest)=>`href="/reports/${rest}"`);
  return s;
}

function cutHeader(s){
  // remove ALL <header>...</header> blocks in the page
  const out = s.replace(/<header\b[^>]*>[\s\S]*?<\/header>/ig, '');
  return out;
}

function processFile(file){
  let before = fs.readFileSync(file,'utf8');
  let s = before;
  s = cutHeader(s);
  s = ensureCssHead(s);
  s = normalizeLinks(s);
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
  console.log(`reports-header-cut: scanned=${scanned} changed=${changed}`);
}
main();
