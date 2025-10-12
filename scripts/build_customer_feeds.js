#!/usr/bin/env node
// build_customer_feeds.js — prepare simple CSV feeds for customers (placeholder)
const fs=require('fs'), path=require('path');
(function main(){
  const outDir='customer-feeds'; fs.mkdirSync(outDir,{recursive:true});
  const file=path.join(outDir, 'changes.csv'); fs.writeFileSync(file, 'vendor,when,url\n', 'utf8');
  console.log('[customer-feeds] wrote changes.csv');
})();