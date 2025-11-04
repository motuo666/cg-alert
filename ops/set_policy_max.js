#!/usr/bin/env node
const fs=require('fs');
const path='config/volume_policy.json';
const target=parseInt(process.argv[2]||'100',10);
const j=JSON.parse(fs.readFileSync(path,'utf8'));
j.max=target;
fs.writeFileSync(path, JSON.stringify(j,null,2)+'\n');
console.log('set max ->', target);
