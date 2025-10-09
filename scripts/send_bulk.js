// scripts/send_bulk.js  —— 稳定版：只用 mail2 发件 + 域名归一化 + 容错 + MX 预检宽松
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const nodemailer = require('nodemailer');

const ROOT = path.join(__dirname, '..');
const LEADS = path.join(ROOT, 'data', 'leads.csv');

// === SMTP from GitHub Secrets ===
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER; // 建议：outreach@cg-alert.com 或 outreach@mail2.cg-alert.com
const SMTP_PASS = process.env.SMTP_PASS;

// 只用你已授权的发件地址（避免用到未配置的 mail. 子域）
const FROM = { name: 'CG Alert', address: 'outreach@mail2.cg-alert.com' };
const REPLY_TO = 'outreach@cg-alert.com';
const LIST_UNSUB = 'mailto:optout@cg-alert.com?subject=unsubscribe';

const DRY_RUN = String(process.env.DRY_RUN || '').trim() === '1';

function sha1Byte(s) { return crypto.createHash('sha1').update(String(s)).digest()[0]; }
const pickAB = (email, arr, salt='') => arr[(sha1Byte(email + salt)) % arr.length];

// 宽松归一化 domain：去协议/路径，空时从 email 取域名
function normDomain(domain, email) {
  let d = (domain || '').toLowerCase().trim();
  if (!d && email) d = (email.split('@')[1] || '').trim();
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  // 防御性：去掉端口等
  d = d.split(':')[0];
  return d;
}

async function hasMX(domain) {
  if (!domain) return false;
  try {
    const mx = await dns.resolveMx(domain);
    return Array.isArray(mx) && mx.length > 0;
  } catch {
    // 有些域没配 MX 但仍接受 A 记录收件；这里不一刀切，返回 false 但不阻止发送
    return false;
  }
}

function readCSV(fp) {
  if (!fs.existsSync(fp)) return { header: [], rows: [] };
  const raw = fs.readFileSync(fp, 'utf8').trim();
  if (!raw) return { header: [], rows: [] };
  const [hrow, ...rs] = raw.split(/\r?\n/).filter(Boolean);
  const header = hrow.split(',').map(s => s.trim());
  const rows = rs.map(l => {
    const v = l.split(',');
    const o = {};
    header.forEach((k, i) => (o[k] = String(v[i] ?? '').trim()));
    return o;
  });
  return { header, rows };
}

function writeCSV(fp, header, rows) {
  const head = header.join(',') + '\n';
  const body = rows.map(r => header.map(k => r[k] ?? '').join(',')).join('\n');
  fs.writeFileSync(fp, head + (rows.length ? body + '\n' : ''), 'utf8');
}

const wrap78 = (s = '') =>
  s.split('\n').map(l => (l.length <= 78 ? l : (l.match(/.{1,78}/g) || []).join('\n'))).join('\n');
const urlCount = (t = '') => ((t.match(/\bhttps?:\/\/[^\s)]+/ig)) || []).length;

// —— 模板（保持你原口径，只做 A/B 选择）——
const S1_SUBJECTS = [
  v => `Evidence-backed alerts for ${v.company || v.domain}`,
  v => `${v.domain}: pricing/ToS changes with proof`,
  () => `Compliance-ready change alerts (DPA/Subprocessors)`
];
const S1_BODIES = [
  v => `Hi team,

We monitor your vendors’ public pages (Pricing/ToS/DPA/Subprocessors/Status) and deliver verifiable evidence cards with Slack/Email alerts.

• ${v.domain} — sample: https://www.cg-alert.com/updates/
• Refund: 30 days if no material alert.

Interested in a quick check?`,
  v => `Hello,

We track material changes on vendors’ public legal/pricing pages and ship evidence cards (hash, snippet, timestamp) + alerts.

Your team can stop manual page patrol; keep audit-ready.

Open to a short trial on your top vendors?`,
  v => `Hi,

Third-party changes (ToS/DPA/Subprocessors/Status) create audit risk. We send proof-backed alerts so you can act fast.

Refund if no material alert in 30 days.

Worth a look for ${v.company || v.domain}?`
];

async function main() {
  const { header, rows } = readCSV(LEADS);
  if (header.length === 0) { console.error('leads.csv missing'); return; }

  // 确保列存在
  const need = ['email', 'company', 'domain', 'status', 'seq', 'last_touch'];
  need.forEach(c => { if (!header.includes(c)) header.push(c); });

  // SMTP 传输
  const transporter = nodemailer.createTransport({
    host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
    tls: { minVersion: 'TLSv1.2' }
  });

  const nowISO = new Date().toISOString();
  const out = [];

  for (const lead of rows) {
    const email = String(lead.email || '').toLowerCase();
    const company = lead.company || '';
    const domain = normDomain(lead.domain || '', email);
    const status = String(lead.status || '').toLowerCase();

    if (!email || !email.includes('@')) { lead.status = 'invalid'; lead.last_touch = nowISO; out.push(lead); continue; }
    if (['optout', 'invalid'].includes(status)) { out.push(lead); continue; }

    // 宽松 MX：仅做提示，不阻断
    const mxOk = await hasMX(email.split('@')[1]);
    if (!mxOk && !DRY_RUN) {
      // 标记但继续尝试发送（部分域会用 A 记录收件）
      lead.status = 'mx-unknown';
    }

    const v = { email, company, domain };
    const subject = pickAB(email, S1_SUBJECTS)(v);
    const bodyRaw = pickAB(email, S1_BODIES, 'b')(v);

    // 链接控制，防进 Promotions/垃圾箱
    if (urlCount(bodyRaw) > 3) { out.push(lead); continue; }

    try {
      if (!DRY_RUN) {
        await transporter.sendMail({
          from: FROM,
          to: email,
          replyTo: REPLY_TO,
          subject,
          text: wrap78(bodyRaw),
          headers: {
            'List-Unsubscribe': `<${LIST_UNSUB}>`,
            'Auto-Submitted': 'auto-generated',
            'X-Entity-Ref-ID': `${Date.now()}-${Math.random().toString(36).slice(2)}`
          }
        });
        // 轻节流：1.2–2.0s
        await new Promise(r => setTimeout(r, 1200 + Math.random() * 800));
      }
      lead.seq = lead.seq || 's1';
      lead.last_touch = nowISO;
      lead.status = lead.status || 'sent';
    } catch (e) {
      // 常见告警：535=认证失败；553/550=发件人未授权；ENOTFOUND/ETIMEDOUT=网络/DNS
      lead.status = `err:${(e && e.responseCode) || e.code || 'send-failed'}`;
      lead.last_touch = nowISO;
      console.error(`send fail ${email}:`, e && (e.response || e.message || e));
    }
    out.push(lead);
  }

  writeCSV(LEADS, header, out);
}

main().catch(e => { console.error(e); process.exit(1); });
