#!/usr/bin/env node
// repair_index_csp.js — replace broken meta CSP in index.html with a sane default
const fs=require('fs'); const p='index.html'; if(!fs.existsSync(p)){ console.log('index.html not found'); process.exit(0); }
let html=fs.readFileSync(p,'utf8');
html = html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '');
const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self' https: data: blob:; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline' https:; script-src 'self' https:; connect-src *; frame-src https://buy.stripe.com https://forms.gle; form-action 'self' https://buy.stripe.com https://forms.gle;">`;
html = html.replace(/<head>/i, `<head>\n${csp}`);
fs.writeFileSync(p, html, 'utf8'); console.log('[index] CSP repaired');