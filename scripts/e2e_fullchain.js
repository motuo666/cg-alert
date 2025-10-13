#!/usr/bin/env node
// e2e_fullchain.js — 端到端自检（采集→校验→外呼 DRY）
const { execSync } = require('child_process');
function run(cmd){ console.log('$', cmd); execSync(cmd, { stdio: 'inherit' }); }
try{
  run('node scripts/validate_leads.js');
  try{ run('node scripts/s1_gate.js'); }catch(e){}
  run('node scripts/send_bulk.js --dry=true --limit=5');
  process.exit(0);
}catch(e){ process.exit(1); }
