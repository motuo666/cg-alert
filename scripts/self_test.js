#!/usr/bin/env node
// self_test.js — smoke checks: files exist & JSON parse evidence
const fs=require('fs'), path=require('path');
(function main(){
  const must = ['data','scripts','vendors','updates','evidence'].filter(d=>fs.existsSync(d)); console.log('[self-test] dirs:', must.join(', ')||'(none)');
  for(const vendor of (fs.existsSync('evidence')?fs.readdirSync('evidence') : [])){ const dir=path.join('evidence',vendor);
    for(const f of fs.readdirSync(dir)){ if(!/\.json$/i.test(f)) continue; try{ JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); }catch(e){ console.error('[self-test] bad json:', path.join(dir,f)); process.exit(1);} } }
  console.log('[self-test] OK');
})();