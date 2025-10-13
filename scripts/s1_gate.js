#!/usr/bin/env node
// s1_gate.js — 48h 内是否存在 kind=change 的证据？有则 gate=1，否则0
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const EVI  = path.join(ROOT, 'evidence');
const WINDOW_H = Number(process.env.TRIGGER_WINDOW_H || 48);

function hasRecentChange(){
  if(!fs.existsSync(EVI)) return false;
  const since = Date.now() - WINDOW_H*3600e3;
  for(const v of fs.readdirSync(EVI, { withFileTypes:true })){
    if(!v.isDirectory()) continue;
    const dir = path.join(EVI, v.name);
    for(const f of fs.readdirSync(dir)){
      if(!f.endsWith('.json')) continue;
      try{
        const j = JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
        if(j && j.kind === 'change'){
          const t = Date.parse(j.detected_at || '');
          if(!Number.isNaN(t) && t >= since) return true;
        }
      }catch(e){}
    }
  }
  return false;
}

(function main(){
  const ok = hasRecentChange() ? '1' : '0';
  console.log(`gate=${ok} (window_h=${WINDOW_H})`);
  if (process.env.GITHUB_OUTPUT) {
    require('fs').appendFileSync(process.env.GITHUB_OUTPUT, `ok=${ok}\n`);
  }
  process.exit(0);
})();
