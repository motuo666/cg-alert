#!/usr/bin/env node
// auto_append_tags.js — merge vendor_tags_pool.csv into vendor_tags.csv (no duplicates)
const fs=require('fs'), path=require('path');
(function main(){
  const pool='data/vendor_tags_pool.csv', out='data/vendor_tags.csv'; if(!fs.existsSync(pool)){ console.log('[auto-tags] no pool'); return; }
  const have = new Set(fs.existsSync(out)?fs.readFileSync(out,'utf8').split(/\r?\n/).filter(Boolean):[]);
  const add=[]; for(const l of fs.readFileSync(pool,'utf8').split(/\r?\n/).filter(Boolean)){ if(!have.has(l)){ add.push(l); have.add(l); } }
  if(add.length){ fs.appendFileSync(out, add.join('\n')+'\n','utf8'); console.log(`[auto-tags] appended ${add.length}`);} else { console.log('[auto-tags] none'); }
})();