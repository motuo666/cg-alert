#!/usr/bin/env node
const fs=require('fs'), path=require('path');
const ROOT=process.cwd(), PUB=path.join(ROOT,'public');
const HOST=(process.env.SITE_ORIGIN||'https://www.cg-alert.com').replace(/\/$/,'');
function listHtml(dir){ let out=[]; if(!fs.existsSync(dir)) return out;
  for(const e of fs.readdirSync(dir,{withFileTypes:true})){ const p=path.join(dir,e.name);
    if(e.isDirectory()) out=out.concat(listHtml(p)); else if(/\.html?$/i.test(e.name)) out.push(p); } return out; }
function inject(file){
  let html = fs.readFileSync(file,'utf8');
  if(html.includes('application/ld+json') && html.includes('og:title')) return false;
  const org = {"@context":"https://schema.org","@type":"Organization","name":"CG Alert","url":HOST+"/","logo":HOST+"/icon.svg"};
  const ld = `<script type="application/ld+json">${JSON.stringify(org)}</script>`;
  const og = [`<meta property="og:site_name" content="CG Alert">`,`<meta property="og:type" content="website">`,`<meta property="og:url" content="${HOST}">`].join('\n');
  if(html.includes('</head>')){ html = html.replace('</head>', `${ld}\n${og}\n</head>`); fs.writeFileSync(file, html); return true; }
  return false;
}
let changed=0; for(const f of listHtml(PUB)){ if(inject(f)) changed++; } console.log('inject_meta changed', changed, 'files');
