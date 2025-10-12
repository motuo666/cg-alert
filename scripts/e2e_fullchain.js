#!/usr/bin/env node
// e2e_fullchain.js — DRY E2E: validate leads -> gate -> bulk(dry) -> triggered(dry) -> reports -> seo
const { execSync } = require('child_process'); function run(cmd){ console.log('$', cmd); execSync(cmd, { stdio:'inherit' }); }
(function main(){
  run('node scripts/validate_leads.js');
  run('node scripts/s1_gate.js');
  run('node scripts/send_bulk.js --dry=true --limit=5');
  run('node scripts/send_triggered.js --dry=true --limit=5 --window-h=48');
  run('node scripts/build_public_monthly.js');
  run('node scripts/build_updates.js');
  run('node scripts/seo_inject.js');
  console.log('[e2e] DRY chain OK');
})();