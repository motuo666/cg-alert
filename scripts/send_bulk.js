// scripts/send_bulk.js — 最优投递版（分流 mail./mail2. + A/B + 退场过滤 + DRY免依赖）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;

const ROOT = path.join(__dirname, '..');
const LEADS_FP = path.join(ROOT, 'data', 'leads.csv');

const DRY = process.env.DRY_RUN === '1';

// 仅在非 DRY 时加载 nodemailer；DRY 自测不需要依赖
let nodemailer = null;
if (!DRY) {
  try { nodemailer = require('nodemailer'); }
  catch (e) {
    console.error('Missing dependency: nodemailer. Install it with "npm i nodemailer" in your workflow before real sending.');
    process.exit(1);
  }
}

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';

const FROMS = [
  { name: 'CG Alert', address: 'outreach@mail.cg-alert.com'  },
  { name: 'CG Alert', address: 'outreach@mail2.cg-alert.com' },
];
const REPLY_TO    = 'outreach@cg-alert.com';
const LIST_UNSUB  = 'mailto:optout@cg-alert.com?subject=unsubscribe';

function hnum(s){ return crypto.createHash('sha1').update(String(s)).digest()[0]; }
function pickFrom(email){ return FROMS[hnum(email) % FROMS.length]; }

function wrap78(s=''){
  return s.split('\n').map(line=>{
    if(line.length<=78) return line;
    const out=[]; let rest=line;
    while(rest.length>78){ out.push(rest.slice(0,78)); rest=rest.slice(78); }
    out.push(rest); return out.join('\n');
  }).join('\n');
}
function linkCount(text=''){ const m = text.match(/\bhttps?:\/\/[^\s)]+/ig); return m?m.length:0; }

function readCSV(fp){
  if(!fs.existsSync(fp)) return {header:[],rows:[]};
  const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) return {header:[],rows:[]};
  const [h,...rs]=raw.split(/\r?\\n/).filter(Boolean);
  const header=h.split(',').map(s=>s.trim());
  const rows=rs.map(line=>{const v=line.split(',');const o={};header.forEach((k,i)=>o[k]=String(v[i]??'').trim());return o;});
  return {header,rows};
}
function writeCSV(fp, header, rows){
  const head = header.join(',')+'\n';
  const body = rows.map(r=>header.map(k=>r[k]??'').join(',')).join('\n');
  fs.writeFileSync(fp, head + (rows.length? body+'\n' : ''), 'utf8');
}

async function hasMX(domain){
  try{
    const mx = await dns.resolveMx(domain);
    return Array.isArray(mx) && mx.length>0;
  }catch{ return false; }
}

// 选一个站内示例链接（优先真实 vendor；否则回退 /updates/）
function pickSampleURL(){
  const SITE = 'https://www.cg-alert.com';
  try {
    const eviDir = path.join(ROOT, 'evidence');
    if (fs.existsSync(eviDir)) {
      const vendors = fs.readdirSync(eviDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(v => v && v !== 'acme');
      if (vendors.length) return `${SITE}/vendors/${encodeURIComponent(vendors[0])}/`;
    }
  } catch {}
  return `${SITE}/updates/`;
}
const SAMPLE_URL = pickSampleURL();

// ====== S1 模板（单链接策略） ======
const S1_SUBJECTS = [
  v=>`${v.domain}: evidence-backed vendor change alerts`,
  v=>`Stop manual checks — proof-based alerts for ${v.domain}`,
  v=>`Compliance-ready alerts (ToS/DPA/Subprocessors) — ${v.domain}`
];
const S1_BODIES = [
  v=>`Hi team,

We monitor your vendors’ public pages (Pricing/ToS/DPA/Subprocessors/Status) and send verifiable evidence cards with Slack/Email alerts.

• Proof-backed (hash, snippet, timestamp)
• Refund: 30 days if no material alert

Sample: ${SAMPLE_URL}
If not relevant, reply STOP.`,
  v=>`Hello,

We track material changes on vendor legal/pricing pages and ship evidence cards + alerts, so your team can stop manual patrol and stay audit-ready.

Sample: ${SAMPLE_URL}
Refund if no material alert in 30 days. Reply STOP to opt out.`,
  v=>`Hi,

Third-party changes create audit risk. We detect them and deliver proof-backed alerts (ToS/DPA/Subprocessors/Status), ready for compliance.

Sample: ${SAMPLE_URL}
If not useful, reply STOP.`
];

function pickSubject(lead){ const i = hnum(lead.email) % S1_SUBJECTS.length; return S1_SUBJECTS[i](lead); }
function pickBody(lead){    const i = hnum(lead.email+'body') % S1_BODIES.length; return S1_BODIES[i](lead); }

async function main(){
  const {header, rows} = readCSV(LEADS_FP);
  if(header.length===0){
    console.error('leads.csv missing'); process.exit(0);
  }
  // 确保列齐
  const needCols = ['email','company','domain','status','seq','last_touch'];
  needCols.forEach(c=>{ if(!header.includes(c)) header.push(c); });

  // 邮件 transporter：DRY 模式用 stub，真实发送创建 SMTP 传输
  const transporter = DRY ? { sendMail: async ()=>{} } :
    nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT===465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });

  const nowISO = new Date().toISOString();
  const updated = [];

  for(const lead of rows){
    const email=(lead.email||'').toLowerCase();
    const domain=(lead.domain||'').toLowerCase();
    const status=(lead.status||'').toLowerCase();

    // 退场过滤：退订/硬退/坏MX
    if(['optout','invalid','bad-mx'].includes(status)) { updated.push(lead); continue; }

    // DRY 模式跳过 DNS 查询以提速；非 DRY 才做 MX 预检
    if(!DRY){
      if(!(await hasMX(domain))){ lead.status='bad-mx'; lead.last_touch=nowISO; updated.push(lead); continue; }
    }

    const subject = pickSubject(lead);
    const bodyRaw = pickBody(lead);
    if(linkCount(bodyRaw)>3){ updated.push(lead); continue; } // 保守：链接≤3

    const from = pickFrom(email);

    if (DRY) {
      console.log(`[DRY] would send to ${email} from ${from.address} subject="${subject}"`);
    } else {
      await transporter.sendMail({
        from, to: email, replyTo: REPLY_TO, subject,
        text: wrap78(bodyRaw),
        headers: {
          'List-Unsubscribe': `<${LIST_UNSUB}>`,
          'Auto-Submitted': 'auto-generated',
          'X-Entity-Ref-ID': `${Date.now()}-${Math.random().toString(36).slice(2)}`
        }
      });
      // 轻节流（1.2–2.0s/封）
      await new Promise(r=>setTimeout(r, 1200 + Math.random()*800));
    }

    // 标记
    lead.seq = lead.seq ? lead.seq : 's1';
    lead.last_touch = nowISO;
    if(!lead.status) lead.status='sent';
    updated.push(lead);
  }

  writeCSV(LEADS_FP, header, updated);
  console.log(DRY ? 'S1 dry-run complete' : 'S1 sent complete');
}

main().catch(e=>{ console.error(e); process.exit(1); });
