#!/usr/bin/env node
// Insert <link rel="stylesheet" href="/assets/cg-theme-hotfix.css"> into <head> of all public/*.html if missing
import fs from 'fs';
import path from 'path';
import glob from 'glob';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const PUB = path.join(ROOT, 'public');

function injectHotfix(html){
  if (html.includes('/assets/cg-theme-hotfix.css')) return html;
  const tag = '\n<link rel="stylesheet" href="/assets/cg-theme-hotfix.css">';
  // naive: after cg-theme.css or before </head>
  if (html.includes('/assets/cg-theme.css')) {
    return html.replace('/assets/cg-theme.css">', '/assets/cg-theme.css">' + tag);
  }
  return html.replace(/<\/head>/i, tag + '\n</head>');
}

function main(){
  const files = glob.sync(path.join(PUB, '**/*.html'));
  let changed = 0;
  files.forEach(fp => {
    const html = fs.readFileSync(fp, 'utf8');
    const next = injectHotfix(html);
    if (next !== html){
      fs.writeFileSync(fp, next, 'utf8');
      changed++;
    }
  });
  console.log('✅ hotfix css injected into', changed, 'html files');
}
main();
