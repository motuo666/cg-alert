// scripts/send_bulk.js — Brevo 最优版（587/STARTTLS、发件池、BCC 调试、CSV 安全写回）
const fs = require('fs');
const path = require('path');
const dns = require('dns').promises;

const ROOT = path.join(__dirname, '..');
const LEADS_FP = path.join(ROOT, 'data', 'leads.csv');

const DRY = process.env.DRY_RUN === '1';

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

const MAIL_FROM      = (process.env.MAIL_FROM || 'outreach@m1.cg-alert.com').toLowerCase();
const MAIL_FROM_NAME = process.env.MAIL_FROM_NAME || 'CG Alert';
const BCC_TO         = process.env.BCC_TO || ''; // 可填你的测试邮箱

// From 池：与 m1 域一致（不要再用 mail./mail2.）
const FROM_POOL = [
  { name: MAIL_FROM_NAME, address: MAIL_FROM },
  { name: MAIL_FROM_NAME, address: 'ops@m1.cg-alert.com' },
];

// ====== 模板 ======
const SITE = 'https://www.cg-alert.com';
const SAMPLE_FALLBACK = `${SITE}/updates/`;

function pickSampleURL(){
  try {
    const dir = path.join(ROOT, 'evidence');
    const vendors = fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true })
          .filter(d => d.isDirectory() && d.name !== '_seed' && d.name !== 'acme')
          .map(d => d.name)
      : [];
    return vendors.length ? `${SITE}/vendors/${encodeURIComponent(vendors[0])}/` : SAMPLE_FALLBACK;
  } catch { return SAMPLE_FALLBACK; }
}
const SAMPLE_URL = pickSampleURL();

const SUBS = [
  v => `${v.domain}: evidence-backed vendor change alerts`,
  v => `Stop manual checks — proof-based alerts for ${v.domain}`,
  v => `Compliance-ready alerts (ToS/DPA/Subprocessors) — ${v.domain}`,
];
const BODIES = [
  v => `Hi team,

We monitor your vendors’ public pages (Pricing/ToS/DPA/Subprocessors/Status) and send verifiable evidence cards with Slack/Email alerts.

• Proof-backed (hash, snippet, timestamp)
• Refund: 30 days if no material alert

Sample: ${SAMPLE_URL}
If not relevant, reply STOP.`,
  v => `Hello,

We track material changes on vendor legal/pricing pages and ship evidence cards + alerts, so your team can stop manual patrol and stay audit-ready.

Sample: ${SAMPLE_URL}
Refund if no material alert in 30 days. Reply STOP to opt out.`,
  v => `Hi,

Third-party changes create audit risk. We detect them and deliver proof-backed alerts (ToS/DPA/Subprocessors/Status), ready for compliance.

Sample: ${SAMPLE_URL}
If not useful, reply STOP.`,
];

function h(s){ let x=0; for (const c of Buffer.from(String(s))) x=(x*131+c)%0x7fffffff; return x; }
function pick(arr, key){ return arr[h(key)%arr.length]; }
function pickFrom(email){ return pick(FROM_POOL, email); }
function wrap78(s=''){
  return s.split('\n').map(line=>{
    if(line.length<=78) return line;
    const out=[]; let rest=line;
    while(rest.length>78){ out.push(rest.slice(0,78)); rest=rest.slice(78); }
    out.push(rest); return out.join('\n');
  }).join('\n');
}
function linkCount(t=''){ const m=t.match(/\bhttps?:\/\/[^\s)]+/ig); return m?m.length:0; }

function readCSV(fp){
  if(!fs.existsSync(fp)) return {header:[], rows:[]};
  const raw = fs.readFileSync(fp,'utf8').trim();
  if(!raw) return {header:[], rows:[]};
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = lines[0].split(',').map(s=>s.trim());
  const rows = lines.slice(1).map(line=>{
    const v=line.split(',');
    const o={}; header.forEach((k,i)=>o[k]=String(v[i]??'').trim());
    return o;
  });
  return {header, rows};
}
function writeCSV(fp, header, rows){
  const head = header.join(',')+'\n';
  const body = rows.map(r=>header.map(k=>r[k]??'').join(',')).join('\n');
  fs.writeFileSync(fp, head + (rows.length? body+'\n' : ''), 'utf8');
}
async function hasMX(domain){
  try{ const mx=await dns.resolveMx(domain); return Array.isArray(mx)&&mx.length>0; }catch{ return false; }
}

async function makeTransport(){
  if (DRY) return { sendMail: async ()=>{}, verify: async ()=>{} };
  const nodemailer = require('nodemailer');
  const t = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,        // 587
    secure: false,          // 587 = STARTTLS
    requireTLS: true,       // 强制 STARTTLS
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
  });
  await t.verify(); // 若认证错，会直接抛 535
  return t;
}

async function main(){
  const {header, rows} = readCSV(LEADS_FP);
  if(header.length===0){ console.error('leads.csv missing'); return; }

  // 确保表头齐全（不会把表头当一行数据追加）
  const need = ['email','company','domain','status','seq','last_touch'];
  for (const c of need) if (!header.includes(c)) header.push(c);

  const limitArg = Number((process.argv.find(a=>a.startsWith('--limit='))||'').split('=')[1]||'0');
  let remain = limitArg>0 ? limitArg : Infinity;

  const t = await makeTransport();
  console.log(`ready=${t?1:0} DRY=${DRY}`);

  const nowISO = new Date().toISOString();
  const updated = [];

  for (const lead of rows) {
    if (remain<=0) { updated.push(lead); continue; }

    const email   = (lead.email||'').toLowerCase();
    const domain  = (lead.domain||'').toLowerCase();
    const status  = (lead.status||'').toLowerCase();

    if (!email || !domain) { updated.push(lead); continue; }
    if (['optout','invalid','bad-mx','bounced'].includes(status)) { updated.push(lead); continue; }

    // 非 DRY 才做 MX 预检（提升成功率）
    if (!DRY) {
      if (!(await hasMX(domain))) {
        lead.status='bad-mx'; lead.last_touch=nowISO; updated.push(lead); continue;
      }
    }

    const subject = pick(SUBS, email)({domain});
    const bodyRaw = pick(BODIES, email)({domain});
    if (linkCount(bodyRaw)>3) { updated.push(lead); continue; }

    const from = pickFrom(email);

    if (DRY) {
      console.log(`[DRY] to=${email} from=${from.address} sub="${subject}"`);
    } else {
      await t.sendMail({
        from, to: email, bcc: BCC_TO || undefined,
        subject, text: wrap78(bodyRaw),
        replyTo: MAIL_FROM,
        headers: {
          'List-Unsubscribe': `<mailto:optout@m1.cg-alert.com?subject=unsubscribe>`,
          'Auto-Submitted': 'auto-generated'
        }
      });
      await new Promise(r=>setTimeout(r, 1200 + Math.random()*800));
      remain--;
    }

    lead.seq = lead.seq || 's1';
    lead.status = lead.status || 'sent';
    lead.last_touch = nowISO;
    updated.push(lead);
  }

  writeCSV(LEADS_FP, header, updated);
  console.log(DRY ? 'S1 dry-run complete' : 'S1 sent complete');
}

main().catch(e=>{ console.error(e); process.exit(1); });
