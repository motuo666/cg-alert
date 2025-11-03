#!/usr/bin/env node
/**
 * scripts/ci/apply_env_fallback.js
 * Insert/replace a top-level env: block in each .github/workflows/*.yml|*.yaml
 * using secrets||vars fallback. Skips itself (patch workflow) by name.
 */
const fs = require('fs');
const path = require('path');

const repo = process.cwd();
const wfDir = path.join(repo, '.github', 'workflows');
if (!fs.existsSync(wfDir)) {
  console.error('No .github/workflows directory found'); process.exit(1);
}
const files = fs.readdirSync(wfDir).filter(f => /\.(ya?ml)$/i.test(f));

const FALLBACK_ENV = `env:
  SITE_ORIGIN: \${{ vars.SITE_ORIGIN }}
  WORKER_URL:  \${{ vars.WORKER_URL }}
  UNSUB_ORIGIN: \${{ vars.UNSUB_ORIGIN }}
  INTAKE_FORM_URL: \${{ vars.INTAKE_FORM_URL }}

  MAIL_FROM: \${{ vars.MAIL_FROM }}
  REPLY_TO:  \${{ vars.REPLY_TO }}
  SENDER_NAME: \${{ vars.SENDER_NAME }}
  MAIL_POSTAL_ADDRESS: \${{ vars.MAIL_POSTAL_ADDRESS }}
  MAIL_RETURN_PATH: \${{ vars.MAIL_RETURN_PATH }}
  BCC_TO: \${{ secrets.BCC_TO }}

  SLACK_WEBHOOK_URL: \${{ secrets.SLACK_WEBHOOK_URL || vars.SLACK_WEBHOOK_URL }}

  SMTP_HOST: \${{ secrets.SMTP_HOST }}
  SMTP_PORT: \${{ secrets.SMTP_PORT }}
  SMTP_USER: \${{ secrets.SMTP_USER }}
  SMTP_PASS: \${{ secrets.SMTP_PASS }}
  IMAP_HOST: \${{ secrets.IMAP_HOST }}
  IMAP_PORT: \${{ secrets.IMAP_PORT }}
  IMAP_USER: \${{ secrets.IMAP_USER }}
  IMAP_PASS: \${{ secrets.IMAP_PASS }}

  CF_ACCOUNT_ID: \${{ vars.CF_ACCOUNT_ID }}
  CF_API_TOKEN:  \${{ secrets.CF_API_TOKEN }}
  KV_NAMESPACE_ID: \${{ vars.KV_NAMESPACE_ID || secrets.KV_NAMESPACE_ID }}
  KV_LEADS_ID:    \${{ vars.KV_LEADS_ID || secrets.KV_LEADS_ID }}

  STRIPE_LINK_PORTFOLIO: \${{ vars.STRIPE_LINK_PORTFOLIO || secrets.STRIPE_LINK_PORTFOLIO }}
  STRIPE_LINK_BUSINESS:  \${{ vars.STRIPE_LINK_BUSINESS  || secrets.STRIPE_LINK_BUSINESS  }}
  STRIPE_WEBHOOK_SECRET: \${{ secrets.STRIPE_WEBHOOK_SECRET }}

  INDEXNOW_KEY: \${{ secrets.INDEXNOW_KEY }}
  OBS_KEY: \${{ secrets.OBS_KEY }}
  ENRICH_API_TOKEN: \${{ secrets.ENRICH_API_TOKEN }}

  TARGET_DISCOVERY_API_URL:   \${{ vars.TARGET_DISCOVERY_API_URL }}
  TARGET_DISCOVERY_API_TOKEN: \${{ secrets.TARGET_DISCOVERY_API_TOKEN }}

  MIN_HASH_RATIO: \${{ vars.MIN_HASH_RATIO }}
  MIN_SENT7_FOR_DLVR: \${{ vars.MIN_SENT7_FOR_DLVR }}
  P95_TTD_MAX_HOURS: \${{ vars.P95_TTD_MAX_HOURS }}
  TARGET_EVID_TODAY: \${{ vars.TARGET_EVID_TODAY }}
  TARGET_SENT: \${{ vars.TARGET_SENT }}
  TTD_LOOKBACK_HOURS: \${{ vars.TTD_LOOKBACK_HOURS }}
  UNSUB_7D_MAX: \${{ vars.UNSUB_7D_MAX }}
  COMPLAINT_7D_MAX: \${{ vars.COMPLAINT_7D_MAX }}
  BOUNCE_7D_MAX: \${{ vars.BOUNCE_7D_MAX }}
  REQUIRE_CHANGED_VENDORS: \${{ vars.REQUIRE_CHANGED_VENDORS }}
`;

function replaceTopLevelEnv(yml) {
  // Normalize line endings
  yml = yml.replace(/\r\n/g, '\n');
  // Skip our patch workflow by marker
  if (/name:\s*Patch Env Fallback/i.test(yml)) return yml;

  // Remove existing top-level env block (env: ... until next top-level key)
  const lines = yml.split('\n');
  let out = [];
  let i = 0;
  let removed = false;

  while (i < lines.length) {
    const line = lines[i];
    if (/^env:\s*$/.test(line)) {
      // capture until a next top-level key (no indent and ends with ':') except comments/blank
      removed = true;
      i++;
      while (i < lines.length) {
        const l = lines[i];
        if (/^[A-Za-z_][\w-]*:\s*$/.test(l) || /^on:\s*$/.test(l) || /^jobs:\s*$/.test(l) || /^permissions:\s*$/.test(l) || /^defaults:\s*$/.test(l) || /^concurrency:\s*$/.test(l)) break;
        i++;
      }
      // insert new block
      out.push(FALLBACK_ENV.trimEnd());
      continue;
    }
    out.push(line);
    i++;
  }

  if (!removed) {
    // insert after 'permissions:' block if found, else after 'on:' block, else at top.
    const idxPerm = out.findIndex(l => /^permissions:\s*$/.test(l));
    const idxOn = out.findIndex(l => /^on:\s*$/.test(l));
    let insertAt = 0;
    if (idxPerm !== -1) insertAt = idxPerm + 1;
    else if (idxOn !== -1) {
      // skip the on: block
      insertAt = idxOn + 1;
      while (insertAt < out.length && (out[insertAt].startsWith(' ') || out[insertAt].trim()==='')) insertAt++;
    }
    out.splice(insertAt, 0, FALLBACK_ENV.trimEnd());
  }

  return out.join('\n');
}

let changed = 0;
for (const f of files) {
  const fp = path.join(wfDir, f);
  let s = fs.readFileSync(fp, 'utf8');
  const s2 = replaceTopLevelEnv(s);
  if (s2 !== s) {
    fs.writeFileSync(fp, s2);
    changed++;
    console.log('patched:', f);
  } else {
    console.log('kept:   ', f);
  }
}

console.log('Total changed:', changed);
