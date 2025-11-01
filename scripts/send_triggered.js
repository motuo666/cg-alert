// Patched to support headers: email,name,title,company,domain,region,status
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const fs = require('fs'); const path = require('path');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM || 'CG Alert Ops <ops@cg-alert.com>';
const POSTAL = process.env.MAIL_POSTAL_ADDRESS || '—';
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const HMAC_SECRET = process.env.UNSUB_HMAC_SECRET || '';
const LIMIT = parseInt(process.argv.find(a=>a.startsWith('--limit='))?.split('=')[1] || '12', 10);
const DRY = !process.argv.some(a=>a==='--dry=false');

function hmac(e){ return crypto.createHmac('sha256', HMAC_SECRET).update(String(e)).digest('hex').slice(0,24); }
function loadCSV(p){
  if(!fs.existsSync(p)) return {head:[], rows:[]};
  const L=fs.readFileSync(p,'utf8').trim().split(/\r?\n/); if(L.length<2) return {head:[], rows:[]};
  const H=L.shift().split(',').map(s=>s.trim()); const rows=L.map(l=>{const a=l.split(','); const o={}; H.forEach((k,i)=>o[k]=a[i]||''); return o;});
  return {head:H, rows};
}
const base = loadCSV(path.join('data','leads.csv'));
const enriched = loadCSV(path.join('data','leads_enriched.csv'));
const leads = [...enriched.rows, ...base.rows];
const supPath = path.join('data','suppressions.csv'); if(!fs.existsSync(supPath)) fs.writeFileSync(supPath,'email,reason,at\n');
const suppressed = new Set(fs.readFileSync(supPath,'utf8').split(/\r?\n/).slice(1).map(l=>l.split(',')[0].toLowerCase()).filter(Boolean));

const transport = (SMTP_HOST&&SMTP_USER&&SMTP_PASS) ? nodemailer.createTransport({host:SMTP_HOST, port:SMTP_PORT, secure:SMTP_PORT===465, auth:{user:SMTP_USER, pass:SMTP_PASS}}) : null;
const outDir = 'out'; fs.mkdirSync(outDir, {recursive:true});
const outLog = path.join(outDir,'outreach_log.csv'); if(!fs.existsSync(outLog)) fs.writeFileSync(outLog,'email,status,at\n');

function persona(title=''){
  const t = String(title||'').toLowerCase();
  if (/procurement|sourcing|buyer/.test(t)) return 'procurement';
  if (/legal|counsel|privacy|compliance|dpo/.test(t)) return 'legal';
  if (/revops|revenue|sales ops/.test(t)) return 'revops';
  return 'general';
}
function body(row){
  const name = (row.name||'').trim(); const title = (row.title||'').trim();
  const company = (row.company||'').trim(); const domain = (row.domain||'').trim(); const region = (row.region||'').trim();
  const per = persona(title);
  const intro = {
    procurement: 'We track pricing/ToS/DPA/sub‑processors with timestamped evidence you can paste into renewal emails.',
    legal: 'We diff ToS/DPA/sub‑processors and ship verifiable change evidence for compliance and negotiation.',
    revops: 'We surface vendor pricing & terms changes that create leverage at renewal, with ready‑to‑paste language.',
    general: 'We monitor SaaS vendors for pricing and terms changes and deliver verifiable evidence you can act on.'
  }[per];
  const hi = name ? `Hi ${name},` : 'Hi there,';
  const reports = `${SITE}/reports/`;
  const unsub = `${SITE}/unsub?m=${encodeURIComponent(row.email)}&t=${hmac(row.email)}`;
  return `${hi}
<p>${intro}</p>
<p>${company ? `For ${company}` : 'For your top vendors'}${domain ? ` (e.g., ${domain})` : ''}${region ? ` in ${region}` : ''}, you can review recent captures here: <a href="${reports}">Reports</a>.</p>
<p>— CG Alert</p>
<hr><p style="font-size:12px;color:#666">${POSTAL}<br>Unsubscribe: <a href="${unsub}">${unsub}</a></p>`;
}

(async()=>{
  let sent=0;
  for (const r of leads){
    const email = String(r.email||'').toLowerCase(); if(!email || suppressed.has(email)) continue;
    const html = body(r);
    if (DRY){ fs.appendFileSync(outLog, `${email},DRY,${new Date().toISOString()}\n`); continue; }
    if (!transport){ fs.appendFileSync(outLog, `${email},ERROR_NO_SMTP,${new Date().toISOString()}\n`); continue; }
    try {
      await transport.sendMail({ from: FROM, to: email, subject: 'Evidence-backed vendor change alerts — CG Alert', html, text: html.replace(/<[^>]+>/g,' ') });
      fs.appendFileSync(outLog, `${email},SENT,${new Date().toISOString()}\n`); sent++; if (sent>=LIMIT) break;
    } catch(e){
      fs.appendFileSync(outLog, `${email},ERROR,${new Date().toISOString()}\n`);
    }
  }
  console.log('outreach sent', sent);
})();