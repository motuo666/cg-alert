#!/usr/bin/env node
/**
 * send_bulk.js — 9列CSV 兼容版（不会写表头）
 * 每行固定 9 列：[email,company,domain,v1,v2,v3,persona,status,mx_ok]
 * 仅把第 8 列 status 从 new 改 sent；其他一律不动
 * - 示例链接：优先真实 vendors/<slug>/index.html（过滤 _ 前缀与 acme），其次 api/vendors.json，兜底 /updates/；随收件人自动均匀分配并带 utm
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;

const ROOT = path.join(__dirname, '..');
const CSV  = path.join(ROOT, 'data', 'leads.csv');
const DRY  = process.env.DRY_RUN === '1';

// 非 DRY 才加载 nodemailer
let nodemailer = null;
if (!DRY) {
  try { nodemailer = require('nodemailer'); }
  catch { console.error('Missing nodemailer. npm i nodemailer'); process.exit(1); }
}

// SMTP
const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;
const BCC_TO    = process.env.BCC_TO || '';

// 发件分流（若你的发信端未放行这些别名，会由服务端拒投；建议已放行）
const FROMS = [
  { name: 'CG Alert', address: 'outreach@mail.cg-alert.com'  },
  { name: 'CG Alert', address: 'outreach@mail2.cg-alert.com' },
];
// 若未配置，回退 MAIL_FROM（最稳）
function allowedFrom(desired){
  if (!desired || !desired.address) return MAIL_FROM;
  return desired; // 已放行别名时使用；否则 SMTP 会报错并在日志可见
}

const REPLY_TO   = 'outreach@cg-alert.com';
const LIST_UNSUB = 'mailto:optout@cg-alert.com?subject=unsubscribe';

const LIMIT = Number((process.argv.join(' ').match(/--limit=(\d+)/)||[])[1] || 40);

// ---------- CSV I/O（固定 9 列，无表头） ----------
function read9(fp){
  if(!fs.existsSync(fp)) return [];
  const raw = fs.readFileSync(fp,'utf8').trim();
  if(!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean).map(line=>{
    const v = line.split(',').map(x=>String(x||'').trim());
    // 丢弃“疑似表头”的残片
    const joined = v.join(',').toLowerCase();
    if (joined.includes('email,company,domain')) return null;
    const c = v.slice(0,9); while(c.length<9) c.push('');
    return c;
  }).filter(Boolean);
}
function write9(fp, rows){
  const out = rows.map(r => r.slice(0,9).map(x => String(x??'')).join(',')).join('\n');
  fs.writeFileSync(fp, out + (rows.length? '\n' : ''), 'utf8');
}

// ---------- 工具 ----------
const hnum = s => crypto.createHash('sha1').update(String(s)).digest()[0];
const linkCount = t => ((t||'').match(/\bhttps?:\/\/[^\s)]+/ig)||[]).length;
const wrap78 = s => (s||'').split('\n').map(l=>{
  if(l.length<=78) return l; const out=[]; let r=l;
  while(r.length>78){ out.push(r.slice(0,78)); r=r.slice(78); }
  out.push(r); return out.join('\n');
}).join('\n');

async function hasMX(domain){
  try { const mx = await dns.resolveMx(domain); return Array.isArray(mx)&&mx.length>0; }
  catch { return false; }
}

// ---------- 更稳的示例链接（自动切换） ----------
function listVendorSlugs() {
  const vd = path.join(ROOT, 'vendors');
  const out = [];
  try {
    if (fs.existsSync(vd)) {
      for (const d of fs.readdirSync(vd, { withFileTypes: true })) {
        if (!d.isDirectory()) continue;
        const slug = d.name;
        if (!slug) continue;
        if (slug === 'acme') continue;
        if (slug.startsWith('_')) continue; // 过滤 _seed 等隐藏目录
        const idx = path.join(vd, slug, 'index.html');
        if (fs.existsSync(idx) && fs.statSync(idx).size > 100) {
          out.push(slug);
        }
      }
    }
  } catch {}
  return out;
}

function sampleURLForLead(lead) {
  const SITE = 'https://www.cg-alert.com';
  // 1) 优先 vendors/ 真实页面
  const slugs = listVendorSlugs();
  if (slugs.length) {
    const i = crypto.createHash('sha1').update(String(lead.email||'') + ':sample').digest()[0] % slugs.length;
    return `${SITE}/vendors/${encodeURIComponent(slugs[i])}/?utm=outreach_s1`;
  }
  // 2) 次选 api/vendors.json
  try {
    const api = path.join(ROOT, 'api', 'vendors.json');
    if (fs.existsSync(api)) {
      const arr = JSON.parse(fs.readFileSync(api,'utf8')) || [];
      const valid = arr
        .map(v => v && v.slug ? String(v.slug) : '')
        .filter(s => s && !s.startsWith('_') && s !== 'acme');
      if (valid.length) {
        const i = crypto.createHash('sha1').update(String(lead.email||'') + ':sample').digest()[0] % valid.length;
        return `${SITE}/vendors/${encodeURIComponent(valid[i])}/?utm=outreach_s1`;
      }
    }
  } catch {}

  // 3) 兜底：/updates/（永不 404）
  return `${SITE}/updates/?utm=outreach_s1`;
}

// ---------- 模板 ----------
const SUBJS = [
  v=>`${v.domain}: evidence-backed vendor change alerts`,
  v=>`Stop manual checks — proof-based alerts for ${v.domain}`,
  v=>`Compliance-ready alerts (ToS/DPA/Subprocessors) — ${v.domain}`
];
const BODYS = [
  v=>`Hi team,

We monitor your vendors’ public pages (Pricing/ToS/DPA/Subprocessors/Status) and send verifiable evidence cards with Slack/Email alerts.

• Proof-backed (hash, snippet, timestamp)
• Refund: 30 days if no material alert

Sample: ${sampleURLForLead(v)}
If not relevant, reply STOP.`,
  v=>`Hello,

We track material changes on vendor legal/pricing pages and ship evidence cards + alerts, so your team can stop manual patrol and stay audit-ready.

Sample: ${sampleURLForLead(v)}
Refund if no material alert in 30 days. Reply STOP to opt out.`,
  v=>`Hi,

Third-party changes create audit risk. We detect them and deliver proof-backed alerts (ToS/DPA/Subprocessors/Status), ready for compliance.

Sample: ${sampleURLForLead(v)}
If not useful, reply STOP.`
];
const pickSubj = l => SUBJS[hnum(l.email)%SUBJS.length](l);
const pickBody = l => BODYS[hnum(l.email+'b')%BODYS.length](l);

// ---------- 主流程 ----------
(async () => {
  const rows = read9(CSV);
  if (!rows.length) { console.log('leads.csv empty'); process.exit(0); }

  let transporter = null;
  if (!DRY) {
    if (!SMTP_HOST||!SMTP_PORT||!SMTP_USER||!SMTP_PASS||!MAIL_FROM){
      console.error('SMTP secrets missing'); process.exit(1);
    }
    transporter = nodemailer.createTransport({
      host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT===465,
      auth: { user: SMTP_USER, pass: SMTP_PASS }
    });
    await transporter.verify();
  }

  // 选“可发”的 new & mx_ok=1
  const todo = [];
  for (let i=0;i<rows.length;i++){
    const [email,company,domain,,, , ,status,mx_ok] = rows[i];
    if (!email) continue;
    if ((status||'').toLowerCase()!=='new') continue;
    if (String(mx_ok)!=='1') continue;
    todo.push(i);
    if (todo.length>=LIMIT) break;
  }
  console.log(`ready=${todo.length} DRY=${DRY}`);

  let sent=0;
  for (const i of todo){
    const [email,company,domain] = rows[i];
    const emailDomain = (email.split('@')[1]||'').toLowerCase();
    // 如第3列为空或与邮箱域不一致，用邮箱域兜底
    const dom = (domain||'').toLowerCase() === emailDomain ? domain.toLowerCase() : emailDomain;

    if (!DRY){
      const ok = await hasMX(dom);
      if (!ok){ console.log(`skip mx: ${email} (${dom})`); continue; }
    }

    const from = allowedFrom(FROMS[hnum(email)%FROMS.length]) || MAIL_FROM;
    const subj = pickSubj({email,company,domain:dom});
    const text = wrap78(pickBody({email,company,domain:dom}));
    if (linkCount(text)>3){ console.log(`skip links: ${email}`); continue; }

    if (!DRY){
      await transporter.sendMail({
        from, to: email, replyTo: REPLY_TO, subject: subj, text,
        ...(BCC_TO ? { bcc: BCC_TO } : {}),
        headers: {
          'List-Unsubscribe': `<${LIST_UNSUB}>`,
          'Auto-Submitted': 'auto-generated',
          'X-Entity-Ref-ID': `${Date.now()}-${Math.random().toString(36).slice(2)}`
        }
      });
      await new Promise(r=>setTimeout(r,1200+Math.random()*800)); // 1.2–2.0s/封
    }else{
      console.log(`[DRY] ${email} <- ${typeof from==='string'?from:from.address} "${subj}"`);
    }

    // 仅把第 8 列改成 sent
    rows[i][7] = 'sent';
    sent++;
  }

  write9(CSV, rows);
  console.log(DRY ? `S1 dry-run complete, updated=${sent}` : `S1 sent complete, updated=${sent}`);
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
