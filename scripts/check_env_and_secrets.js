// scripts/check_env_and_secrets.js
const fs = require('fs');
const requiredVars = [
  'SITE_ORIGIN','WORKER_URL','UNSUB_ORIGIN','MAIL_FROM','REPLY_TO','MAIL_POSTAL_ADDRESS',
  'STRIPE_LINK_PORTFOLIO','STRIPE_LINK_BUSINESS','INTAKE_FORM_URL'
];
const optionalVars = [
  'DOMAIN_LIMIT','SEND_SPACING_MS','ERROR_ABORT_THRESHOLD','ERROR_ABORT_WINDOW',
  'SEED_SEND','RAMP_BASE','RAMP_WEEKLY_INCREMENT','RAMP_MAX'
];
const requiredSecrets = [
  'SMTP_HOST','SMTP_PORT','SMTP_USER','SMTP_PASS',
  'UNSUB_HMAC_SECRET',
  'CF_ACCOUNT_ID','KV_NAMESPACE_ID','CF_API_TOKEN',
  'IMAP_HOST','IMAP_PORT','IMAP_USER','IMAP_PASS'
];
const optionalSecrets = ['SLACK_WEBHOOK_URL','STRIPE_WEBHOOK_SECRET'];

function checkList(list, kind) {
  const rows = [];
  let missing = 0;
  for (const k of list) {
    const v = process.env[k];
    const ok = !!(v && String(v).trim().length>0);
    rows.push({key:k, ok, value: ok ? '✓ set' : '✗ missing'});
    if (!ok) missing++;
    if (!ok) console.log(`::error title=${kind} missing::${k} is not set`);
  }
  return {rows, missing};
}

const reqV = checkList(requiredVars, 'Variable');
const reqS = checkList(requiredSecrets, 'Secret');
const optV = checkList(optionalVars, 'Variable (optional)');
const optS = checkList(optionalSecrets, 'Secret (optional)');

const summary = [];
function table(title, rows) {
  summary.push(`### ${title}`);
  summary.push('| Name | Status |');
  summary.push('|------|--------|');
  for (const r of rows) summary.push(`| \`${r.key}\` | ${r.value} |`);
  summary.push('');
}
summary.push('# CG Alert — Vars & Secrets Check');
table('Required Variables', reqV.rows);
table('Required Secrets', reqS.rows);
table('Optional Variables', optV.rows);
table('Optional Secrets', optS.rows);

const out = process.env.GITHUB_STEP_SUMMARY;
if (out) fs.appendFileSync(out, summary.join('\n'));

const missingTotal = reqV.missing + reqS.missing;
if (missingTotal>0) {
  console.log(`Missing required items: ${missingTotal}`);
  process.exit(1);
} else {
  console.log('All required variables & secrets are set.');
}
