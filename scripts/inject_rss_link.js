#!/usr/bin/env node
/**
 * inject_rss_link.js
 * Ensure homepage <head> contains RSS discovery <link>.
 */
const fs = require('fs'); const path = require('path');
const HOME = path.join('cg-alert-main','index.html');
if(!fs.existsSync(HOME)){ process.exit(0); }
let s = fs.readFileSync(HOME, 'utf8');
if(!/rel=["']alternate["'][^>]*application\/rss\+xml/i.test(s)){
  s = s.replace(/<head[^>]*>/i, m => m + '\n<link rel="alternate" type="application/rss+xml" title="CG Alert Feed" href="/rss.xml">');
  fs.writeFileSync(HOME, s, 'utf8');
  console.log('RSS link injected into homepage');
} else {
  console.log('RSS link already present');
}
