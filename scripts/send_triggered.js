#!/usr/bin/env node
/**
 * send_triggered.js
 * - 读取 data/leads.csv（9列，无表头）
 * - 48h 内 evidence/*/*.json 有变更才发（可用 --window-h）
 * - 动态主题/正文：按类型聚合（pricing/tos/dpa/subprocessors/status）
 * - 支持 --limit、--dry；支持 BCC、List-Unsubscribe
 */
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const {
  SMTP_HOST, SMTP_PORT = 587, SMTP_USER, SMTP_PASS, MAIL_FROM,
  SLACK_WEBHOOK, BCC_TO
} = process.env;

const argv = require('minimist')(process.argv.slice(2), {
  boolean: ['dry'],
  string: ['window-h','limit'],
  default: { 'window-h': '48', 'limit': '20', dry: true }
});

function lines(p){ return fs.readFileSync(p,'utf8').split(/\r?\n/).filter(Boolean); }
function parseLeadsRow(row){
  const arr = row.split(','); // 9列：email,company,domain,v1,v2,v3,persona,status,mx_ok
  if (arr.length < 9) return null;
  return {
    email: arr[0].trim(), company: arr[1].trim(), domain: arr[2].trim(),
    vendors: [arr[3].trim(), arr[4].trim(), arr[5].trim()].filter(Boolean),
    persona: arr[6].trim(), status: arr[7].trim(), mx_ok: arr[8].trim() === '1'
  };
}
function readLeads(){
  const p = path.join('data','leads.csv');
  if (!fs.existsSync(p)) return [];
  return lines(p).map(parseLeadsRow).filter(Boolean).filter(x=>x.status!=='unsub' && x.status!=='optout' && x.status!=='bounced' && x.status!=='invalid');
}

function listFreshEvidence(windowH){
  const base = 'evidence';
  const minMs = Date.now() - windowH*3600*1000;
  const items = [];
  if (!fs.existsSync(base)) return [];
  for (const vd of fs.readdirSync(base, { withFileTypes: true })) {
    if (!vd.isDirectory()) continue;
    const slug = vd.name;
    const dir = path.join(base, slug);
    for (const f of fs.readdirSync(dir)) {
      if (!/\.json$/i.test(f)) continue;
      const p = path.join(dir, f);
      const st = fs.statSync(p);
      if (st.mtimeMs >= minMs) {
        const obj = JSON.parse(fs.readFileSync(p,'utf8'));
        const type = detectType(obj, f);
        items.push({ slug, type, when: new Date(st.mtimeMs) });
      }
    }
  }
  return items;
}
function detectType(obj, fname=''){
  const text = JSON.stringify(obj || {}).toLowerCase() + ' ' + fname.toLowerCase();
  if (/pricing|price|plan/.test(text)) return 'Pricing';
  if (/\btos\b|terms of service|terms/.test(text)) return 'ToS';
  if (/\bdpa\b|data processing/.test(text)) return 'DPA';
  if (/subprocessor|sub-?processor/.test(text)) return 'Subprocessors';
  if (/status|incident|uptime/.test(text)) return 'Status';
  return 'Public change';
}
function unique(arr){ return [...new Set(arr)]; }
function sampleURLForVendor(slug){
  const p = path.join('vendors', slug, 'index.html');
  return fs.existsSync(p) ? `https://www.cg-alert.com/vendors/${encodeURIComponent(slug)}/`
                          : `https://www.cg-alert.com/updates/?utm=outreach_triggered`;
}
function makeSubject(changes){
  // 取 Top1 类型+Vendor，或合并
  if (changes.length===1) return `[${changes[0].type}] ${changes[0].slug} updated — evidence inside`;
  const byType = {};
  changes.forEach(c => { byType[c.type] ||= []; byType[c.type].push(c.slug); });
  const parts = Object.entries(byType).map(([t, slugs]) => `${t}(${unique(slugs).slice(0,3).join('+')}${slugs.length>3?'+…':''})`);
  return `Recent changes: ${parts.slice(0,3).join(' · ')}`;
}
function makeHTML(changes){
  const items = changes.slice(0,6).map(c => {
    const url = sampleURLForVendor(c.slug);
    return `<li><b>[${c.type}]</b> ${c.slug} — <a href="${url}">evidence</a> <span style="color:#666">(${c.when.toISOString().slice(0,10)})</span></li>`;
  }).join('\n');
  return `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;color:#111">
  <p>Hi, we detected verifiable public changes in the past ${argv['window-h']} hours:</p>
  <ul>${items || '<li>No recent changes.</li>'}</ul>
  <p style="margin-top:16px">We monitor Pricing / ToS / DPA / Subprocessors / Status and deliver evidence-backed alerts.</p>
  <p><a href="https://www.cg-alert.com/updates/?utm=outreach_triggered">View more updates</a></p>
  <hr style="border:none;border-top:1px solid #eee;margin:16px 0">
  <p style="color:#666;font-size:12px">
    Unsubscribe: reply "STOP" or click <a href="mailto:outreach@cg-alert.com?subject=Unsubscribe">here</a>.
  </p>
</body></html>`;
}

async function main(){
  const windowH = Number(argv['window-h']);
  const limit = Number(argv['limit']);
  const dry = !!argv.dry;

  const changes = listFreshEvidence(windowH);
  if (changes.length === 0) {
    console.log(`[triggered] no fresh evidence in ${windowH}h → exit`);
    return;
  }
  const leads = readLeads().filter(x => x.mx_ok !== false).slice(0, limit);
  if (leads.length === 0) {
    console.log('[triggered] no eligible leads');
    return;
  }

  const transport = nodemailer.createTransport({
    host: SMTP_HOST, port: Number(SMTP_PORT), secure: Number(SMTP_PORT) === 465,
    pool: true, maxConnections: 2, maxMessages: 50, rateDelta: 60000, rateLimit: 120,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  const subject = makeSubject(changes);
  const html = makeHTML(changes);
  const headers = {
    'List-Unsubscribe': `<mailto:${MAIL_FROM}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
  };

  let sent = 0;
  for (const lead of leads) {
    const to = lead.email;
    if (dry) {
      console.log(`[dry] ${to} ← ${subject}`);
      continue;
    }
    try {
      await transport.sendMail({
        from: MAIL_FROM, to, bcc: BCC_TO || undefined, subject, html, headers
      });
      sent++;
    } catch (e) {
      console.error('[send][err]', to, e.message);
    }
  }
  if (!dry) await transport.close();

  // 写入心跳与 sent_log
  const dt = new Date().toISOString();
  fs.appendFileSync(path.join('data','sent_log.csv'), `${dt},triggered,${sent},${subject.replace(/,/g,';')}\n`);
  fs.writeFileSync(path.join('data','last_outreach.txt'), `${dt} triggered sent=${sent}\n`);
  console.log(`[triggered] done: sent=${sent}/${leads.length}`);
}

main().catch(err => { console.error(err); process.exit(1); });
