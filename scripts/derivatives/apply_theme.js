#!/usr/bin/env node
const fs = require('fs'); 
const path = require('path');

const CANON = 'https://www.cg-alert.com/';
const headerTpl = fs.readFileSync(path.join('partials','header.html'),'utf8');
const footerTpl = fs.readFileSync(path.join('partials','footer.html'),'utf8');
const headAdd = `
<link rel="stylesheet" href="/assets/cg.css">
<link rel="alternate" type="application/rss+xml" title="CG Alert Reports" href="/reports/rss.xml">
<link rel="canonical" href="${CANON}">
`;

// Collect all .html files without using generators (Node v20-safe)
function allHtml(){
  const out = [];
  (function walk(dir){
    for(const name of fs.readdirSync(dir)){
      if (name.startsWith('.') || name === 'node_modules' || name === '.git' || name === 'assets') continue;
      const fp = path.join(dir, name);
      const st = fs.statSync(fp);
      if (st.isDirectory()) walk(fp);
      else if (name.toLowerCase().endsWith('.html')) out.push(fp);
    }
  })('.');
  return out;
}

let touched = 0;
for(const fp of allHtml()){
  let html = fs.readFileSync(fp, 'utf8');
  const before = html;

  // inject <head> additions (avoid duplicates)
  if (!/rel="canonical"/i.test(html)) {
    html = html.replace(/<head(.*?)>/i, (m)=> m + headAdd);
  }

  // inject header/footer once
  if (!/<header[\s>]/i.test(html)) {
    html = html.replace(/<body(.*?)>/i, (m)=> m + "\n" + headerTpl);
  }
  if (!/<footer[\s>]/i.test(html)) {
    html = html.replace(/<\/body>/i, footerTpl + "\n</body>");
  }

  if (html !== before) {
    fs.writeFileSync(fp, html, 'utf8');
    touched++;
  }
}
console.log('apply_theme(light): updated files', touched);
