#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const WF = path.join('.github','workflows');
if (!fs.existsSync(WF)) process.exit(0);
let changed = 0;
for(const f of fs.readdirSync(WF)){
  if (!/\.(yml|yaml)$/.test(f)) continue;
  const p = path.join(WF,f);
  let s = fs.readFileSync(p,'utf8');
  if (/workers\.dev/.test(s) && !/vars\.WORKER_URL/.test(s)){
    s = s.replace(/https?:\/\/[a-z0-9.-]+\.workers\.dev[^\s"']*/gi, '${{ vars.WORKER_URL }}');
    fs.writeFileSync(p,s); changed++;
  }
}
console.log('patched workflows:', changed);
