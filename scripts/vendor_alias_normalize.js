#!/usr/bin/env node
const fs = require('fs');
const aliasPath = process.argv[2] || 'config/vendor_aliases.json';
const leadsPath = 'data/leads.csv';
if (!fs.existsSync(leadsPath)) process.exit(0);
const map = Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(aliasPath,'utf8'))).map(([k,v])=>[k.toLowerCase(),v]));
const L = fs.readFileSync(leadsPath,'utf8').split(/\r?\n/).map(l=>l.trimEnd());
const O = L.map(ln=>{
  if(!ln) return ln;
  const c=ln.split(',');
  for(let j=3;j<=5;j++){ const s=(c[j]||'').trim().toLowerCase(); if(s) c[j]=map[s]||map[s.replace(/^www\./,'')]||c[j]; }
  return c.join(',');
});
fs.writeFileSync(leadsPath,O.join('\n'));
console.log('leads.csv normalized');
