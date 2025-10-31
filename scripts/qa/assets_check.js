#!/usr/bin/env node
const fs=require('fs');
const missing=[];
['assets/cg.css','assets/logo-cg.png'].forEach(p=>{ if(!fs.existsSync(p)) missing.push(p); });
fs.mkdirSync('artifacts',{recursive:true});
fs.writeFileSync('artifacts/assets_check.json', JSON.stringify({missing}, null, 2));
console.log('assets_check: missing', missing.length);
