#!/usr/bin/env node
// promote_intakes.js — dedupe-append data/intakes.csv -> data/customers.csv
const fs=require('fs'), path=require('path'); const F_IN='data/intakes.csv', F_OUT='data/customers.csv';
function readCSV(p){ if(!fs.existsSync(p)) return []; return fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean).map(l=>l.split(',')); }
(function main(){
  const inRows = readCSV(F_IN), outRows = readCSV(F_OUT); const keys = new Set(outRows.map(r=>r[0]));
  const add = inRows.filter(r => r.length && !keys.has(r[0])); if(!add.length){ console.log('[promote] nothing new'); return; }
  const lines = add.map(r=>r.join(',')).join('\n')+'\n'; fs.appendFileSync(F_OUT, lines, 'utf8'); console.log(`[promote] appended ${add.length}`);
})();