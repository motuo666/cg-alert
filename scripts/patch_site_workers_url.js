#!/usr/bin/env node
/**
 * patch_site_workers_url.js
 * Replace *.workers.dev with WORKER_URL (HTML/YAML/MD) and refresh CSP.
 */
const fs = require('fs'); const path = require('path');
const ROOT = process.cwd();
const WORKER_URL = process.env.WORKER_URL || '';
if (!WORKER_URL) { console.error('WORKER_URL not set'); process.exit(1); }

const exts = new Set(['.html','.yml','.yaml','.md']);
function walk(dir){
  for(const e of fs.readdirSync(dir, {withFileTypes:true})){
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (exts.has(path.extname(e.name))) patchFile(p);
  }
}
function patchFile(p){
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  s = s.replace(/https?:\/\/[a-z0-9.-]+\.workers\.dev/gi, WORKER_URL);
  if (p.endsWith('.html')){
    s = s.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i, (tag)=>{
      const policy = [
        "default-src 'self'",
        "img-src 'self' data:",
        `connect-src 'self' ${WORKER_URL}`,
        "frame-src https://buy.stripe.com",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self' 'unsafe-inline'",
        "base-uri 'self'",
        `form-action 'self' https://buy.stripe.com ${WORKER_URL}`
      ].join('; ');
      return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
    });
  }
  if (s !== before){
    fs.writeFileSync(p, s);
    console.log('patched', p);
  }
}
walk(ROOT);
