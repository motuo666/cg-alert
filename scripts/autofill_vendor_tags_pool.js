#!/usr/bin/env node
// autofill_vendor_tags_pool.js — naive pool generator from vendors folder
const fs=require('fs'), path=require('path');
(function main(){
  const base='vendors', out='data/vendor_tags_pool.csv'; if(!fs.existsSync(base)){ console.log('[autofill-tags-pool] no vendors/'); return; }
  const lines=[]; for(const d of fs.readdirSync(base,{withFileTypes:true})){ if(!d.isDirectory()) continue; const slug=d.name; const tag = /pay|bill|stripe|checkout/i.test(slug)?'Payments':'SaaS';
    lines.push(`${slug},${tag}`);
  }
  fs.writeFileSync(out, lines.join('\n')+'\n', 'utf8'); console.log(`[autofill-tags-pool] wrote ${lines.length}`);
})();