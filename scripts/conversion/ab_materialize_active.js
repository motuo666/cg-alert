#!/usr/bin/env node
const fs = require('fs'), path = require('path');
function readJSON(p, def){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{ return def; } }
const ab = readJSON('config/email_ab_test.json', null);
if(!ab){ console.log('no config/email_ab_test.json'); process.exit(0); }
const pick = readJSON('config/email_active_variant.json', {active: ab.fallback_active || 'A'});
const m = new Map(ab.variants.map(v => [v.key, v.file]));
const file = m.get(pick.active) || m.get(ab.fallback_active) || ab.variants[0].file;
if(!file || !fs.existsSync(file)){ console.log('no template file', file); process.exit(0); }
const s = fs.readFileSync(file,'utf8');
const out = 'templates/email/active.txt';
fs.mkdirSync(path.dirname(out), {recursive: true});
fs.writeFileSync(out, s);
console.log('materialized', file, '->', out);
