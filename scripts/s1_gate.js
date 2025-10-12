#!/usr/bin/env node
// s1_gate.js — allow send only if evidence updated within TRIGGER_WINDOW_H hours
const fs=require('fs'), path=require('path'); const WINDOW_H = Number(process.env.TRIGGER_WINDOW_H||'48');
(function main(){ const base=path.join(__dirname,'..','evidence'); let latest=0;
  if(!fs.existsSync(base)){ console.log('no evidence dir → skip'); finish(0); return; }
  for(const d of fs.readdirSync(base,{withFileTypes:true})){ if(!d.isDirectory()) continue; for(const f of fs.readdirSync(path.join(base,d.name))){ if(!/\.json$/i.test(f)) continue; const mt=fs.statSync(path.join(base,d.name,f)).mtimeMs; if(mt>latest) latest=mt; } }
  const ageH = (Date.now()-latest)/3600e3; const ok = latest && ageH <= WINDOW_H ? 1 : 0; console.log(ok?`fresh evidence found ${ageH.toFixed(1)}h → gate=1`:`no fresh evidence in ${WINDOW_H}h → gate=0`); finish(ok);
})();
function finish(ok){ const out=process.env.GITHUB_OUTPUT; if(out){ require('fs').appendFileSync(out, `ok=${ok}\n`);} console.log(`::set-output name=ok::${ok}`); }