#!/usr/bin/env node
const fs = require('fs');
const HOOK = process.env.SLACK_WEBHOOK_URL || '';
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
async function main(){
  if(!HOOK){ console.log('no SLACK_WEBHOOK_URL; skip'); return; }
  let msg = `Evidence harvest complete. Visit ${SITE}/dashboard/`;
  if(fs.existsSync('artifacts/health_report.txt')){
    const t = fs.readFileSync('artifacts/health_report.txt','utf8').split(/\r?\n/).slice(0,10).join('\n');
    msg += `\n\n--- health report (head) ---\n` + t;
  }
  await fetch(HOOK, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ text: msg })});
  console.log('slack: notified');
}
main().catch(e=>{ console.error(e); process.exit(1); });
