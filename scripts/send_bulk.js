// scripts/send_bulk.js — 最优投递版（mail./mail2. 分流 + 主题/首句A/B + MX预检 + 退场过滤）
// 依赖：node18 + nodemailer；纯文本发送（≤2 个链接）

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

const SEQ  = (process.env.SEQ || 's1').toLowerCase(); // s1 | s2
const FROMS = [
  { name: 'CG Alert', address: 'outreach@mail.cg-alert.com'  },
  { name: 'CG Alert', address: 'outreach@mail2.cg-alert.com' },
];
const REPLY_TO    = 'outreach@cg-alert.com';
const LIST_UNSUB  = 'mailto:optout@cg-alert.com?subject=unsubscribe';
const LANDING     = 'https://www.cg-alert.com/updates/'; // 已指向 /updates/

const ROOT = path.join(__dirname, '..');
const LEADS_FP = path.join(ROOT, 'data', 'leads.csv');

function hnum(s){ return crypto.createHash('sha1').update(String(s)).digest()[0]; }
function pickFrom(email){ return FROMS[hnum(email) % FROMS.length]; }
function wrap78(s=''){ return s.split('\n').map(line=>{
  if(line.length<=78) return line;
  const out=[]; let rest=line;
  while(rest.length>78){ out.push(rest.slice(0,78)); rest=rest.slice(78); }
  out.push(rest); return out.join('\n');
}).join('\n');}
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
  try{ const mx = await dns.resolveMx(domain); return Array.isArray(mx) && mx.length>0; }
  catch{ return false; }
}

// —— S1/S2 模板（A/B自动分配；≤2个链接；退款承诺点到为止）——
const S1_SUBJECTS = [
  v=>`${v.domain}: evidence-backed vendor change alerts`,
  v=>`Stop manual checks — proof-based alerts for ${v.domain}`,
  v=>`Compliance-ready alerts (ToS/DPA/Subprocessors) — ${v.domain}`,
];
const S1_BODIES = [
  v=>`Hi team,

We monitor your vendors’ public pages (Pricing/ToS/DPA/Subprocessors/Status) and send verifiable evidence cards with Slack/Email alerts.

• Proof-backed (hash, snippet, timestamp)
• Refund: 30 days if no material alert

Quick look: ${LANDING}
If not relevant, reply STOP.`,
  v=>`Hello,

We track material changes on vendor legal/pricing pages and ship evidence cards + alerts, so your team can stop manual patrol and stay audit-ready.

See how it works: ${LANDING}
Refund if no material alert in 30 days. Reply STOP to opt out.`,
  v=>`Hi,

Third-party changes create audit and cost risk. We detect them and deliver proof-backed alerts (DPA/Subprocessors/ToS/Status), ready for compliance.

Details: ${LANDING}
Not for you? Reply STOP.`,
];

const S2_SUBJECTS = [
  v=>`Quick nudge — vendor change alerts for ${v.domain}`,
  v=>`${v.domain}: still useful to get proof-backed alerts?`,
];
const S2_BODIES = [
  v=>`Quick nudge on vendor change alerts for ${v.domain}.
We send evidence cards (hash + snippet) when vendors update Pricing/ToS/DPA/Subprocessors/Status.

If useful, here’s the overview: ${LANDING}
If not, reply STOP and I won’t follow up.`,
  v=>`Following up briefly.
We deliver proof-backed alerts (ToS/DPA/Subprocessors/Status) so teams stop manual page patrol and stay audit-ready.

Overview: ${LANDING}
Not relevant? Reply STOP.`,
];

function pickTpl(arr, salt=''){ return arr[hnum(salt)%arr.length]; }

// —— 主流程 —— 
(async function main(){
  const {header, rows} = readCSV(LEADS_FP);
  if(header.length===0){ console.error('leads.csv missing'); process.exit(0); }
  // 确保列齐
  const needCols = ['email','company','domain','status','seq','last_touch'];
  needCols.forEach(c=>{ if(!header.includes(c)) header.push(c); });

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT===465,
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });

  const nowISO = new Date().toISOString();
  const updated = [];

  for(const lead of rows){
    const email=(lead.email||'').toLowerCase();
    const domain=(lead.domain||'').toLowerCase();
    const status=(lead.status||'').toLowerCase();

    // 退场过滤
    if(['optout','invalid','bad-mx'].includes(status)) { updated.push(lead); continue; }
    if(!(await hasMX(domain))){ lead.status='bad-mx'; lead.last_touch=nowISO; updated.push(lead); continue; }

    // 选择模板
    const Sbj = (SEQ==='s2'? pickTpl(S2_SUBJECTS,email) : pickTpl(S1_SUBJECTS,email));
    const Body= (SEQ==='s2'? pickTpl(S2_BODIES, email+'b') : pickTpl(S1_BODIES, email+'b'));
    const subject = Sbj(lead);
    const bodyRaw = Body(lead);
    if(linkCount(bodyRaw)>2){ updated.push(lead); continue; } // 保守：≤2链接

    // 发件分流
    const from = pickFrom(email);

    // 发送
    await transporter.sendMail({
      from, to: email, replyTo: REPLY_TO, subject,
      text: wrap78(bodyRaw),
      headers: {
        'List-Unsubscribe': `<${LIST_UNSUB}>`,
        'Auto-Submitted': 'auto-generated',
        'X-Entity-Ref-ID': `${Date.now()}-${Math.random().toString(36).slice(2)}`
      }
    });

    // 轻节流
    await new Promise(r=>setTimeout(r, 1200 + Math.random()*800));

    // 标记
    lead.seq = lead.seq || SEQ;
    lead.last_touch = nowISO;
    if(!lead.status) lead.status='sent';
    updated.push(lead);
  }

  writeCSV(LEADS_FP, header, updated);
})().catch(e=>{ console.error(e); process.exit(1); });
