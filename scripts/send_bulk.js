#!/usr/bin/env node
// send_bulk.js — 稳定 S1：池化/限速 + 外置模板（三行纯文本）+ Change Pack 链接优先 + 链接回退 + 历史抑制（3天）+ 当日总量上限 20
// 说明：S1 是否发送由 s1_gate.js 决定；本脚本仅负责发送队列的构造与发信。
// 依赖（可选）：scripts/outreach_templates.js；若不存在则使用内置默认模板逻辑。

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const minimist = require('minimist');

// ====== CLI & ENV ======
const argv = minimist(process.argv.slice(2), {
  boolean: ['dry'],
  string: ['limit'],
  default: { dry: true, limit: '20' }
});
const DRY = argv.dry !== false && String(argv.dry) !== 'false';
const LIMIT = Math.min(Math.max(1, Number(argv.limit || '20')), 20); // 当日总量上限 20

const {
  SMTP_HOST, SMTP_PORT = 587, SMTP_USER, SMTP_PASS, MAIL_FROM, BCC_TO,
  SITE_ORIGIN = 'https://www.cg-alert.com'
} = process.env;

// ====== Helpers ======
function read(p, def = '') { try { return fs.readFileSync(p, 'utf8'); } catch { return def; } }
function lines(p) { return read(p).split(/\r?\n/).filter(Boolean); }
function exists(p) { try { return fs.existsSync(p); } catch { return false; } }
function join(...a) { return path.join(...a); }
function isoDate(d = new Date()) { return new Date(d).toISOString().slice(0, 10); }
function ymNow() { return new Date().toISOString().slice(0, 7); }

// ====== Persona / Region Filters（可选，零成本）======
function loadJSON(p, fallback) { try { return JSON.parse(read(p)); } catch { return fallback; } }
const personaRules = loadJSON(join('config', 'persona_rules.json'), {
  allow_roles: ["legal", "privacy", "procurement", "security", "risk", "compliance"],
  deny_prefix: ["info@", "support@", "no-reply@", "noreply@", "sales@"],
  min_score: 0.0
});
const regionFilter = loadJSON(join('config', 'region_filter.json'), {
  exclude_tld: [".eu", ".de", ".fr", ".it", ".es", ".nl", ".se", ".pl"],
  include_country: ["US", "CA", "AU", "SG", "GB", "IE"],
  default: "include"
});
function emailAllowed(email) {
  const e = String(email || '').toLowerCase();
  if (personaRules.deny_prefix.some(p => e.startsWith(p))) return false;
  return true;
}
function personaAllowed(persona) {
  const p = String(persona || '').toLowerCase();
  if (!personaRules.allow_roles || personaRules.allow_roles.length === 0) return true;
  return personaRules.allow_roles.some(r => p.includes(r));
}
function regionAllowed(domain) {
  const d = String(domain || '').toLowerCase();
  if (regionFilter.exclude_tld.some(tld => d.endsWith(tld))) return false;
  return true;
}

// ====== Leads ======
/**
 * leads.csv（9列，无表头）：
 * email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok
 */
function parseLead(row) {
  const a = row.split(',');
  if (a.length < 9) return null;
  return {
    email: a[0].trim().toLowerCase(),
    company: a[1].trim(),
    domain: a[2].trim().toLowerCase(),
    vendors: [a[3], a[4], a[5]].map(s => String(s || '').trim()).filter(Boolean),
    persona: a[6].trim(),
    status: a[7].trim(),
    mx_ok: a[8].trim() === '1'
  };
}
function loadLeads() {
  const csv = join('data', 'leads.csv');
  if (!exists(csv)) return [];
  return lines(csv).map(parseLead).filter(Boolean)
    .filter(x =>
      x.mx_ok &&
      !['unsub', 'optout', 'bounced', 'invalid', 'bad-mx'].includes(x.status) &&
      emailAllowed(x.email) &&
      personaAllowed(x.persona) &&
      regionAllowed(x.domain)
    );
}

// ====== Change Pack / 链接构造 ======
let TPL = null;
try { TPL = require('./outreach_templates'); } catch { TPL = null; }

function pickTopic(type) {
  if (TPL && TPL.pickTopic) return TPL.pickTopic(type);
  const map = { Pricing: 'Pricing', ToS: 'Terms of Service', DPA: 'DPA', Subprocessors: 'Subprocessors', Status: 'Status' };
  return map[type] || type || 'Public change';
}
function toImpact(type) {
  if (TPL && TPL.toImpact) return TPL.toImpact(type);
  if (type === 'Pricing') return 'Budget/renewal risk';
  if (type === 'ToS') return 'Legal/arbitration/termination';
  if (type === 'DPA') return 'Privacy/processing terms';
  if (type === 'Subprocessors') return 'Vendor risk/DP addendum';
  if (type === 'Status') return 'SLA/incident history';
  return 'Contract/Compliance';
}

/** 解析首选 vendor（按 lead.vendors 顺序尝试）生成 Pack 链接；不存在则回退到 /vendors/<slug>/ 或 /updates/?q= */
function resolvePackUrlForLead(lead, isoYM = ymNow()) {
  for (const slug of (lead.vendors || [])) {
    const packLocal = join('reports', isoYM, slug, 'index.html');
    if (exists(packLocal)) return `${SITE_ORIGIN}/reports/${isoYM}/${slug}/`;
  }
  // 回退到 vendors 页面（若存在）
  for (const slug of (lead.vendors || [])) {
    const vendorLocal = join('vendors', slug, 'index.html');
    if (exists(vendorLocal)) return `${SITE_ORIGIN}/vendors/${encodeURIComponent(slug)}/`;
  }
  // 最终回退到 updates 搜索
  const q = encodeURIComponent(lead.vendors && lead.vendors[0] ? lead.vendors[0] : lead.company || lead.domain || '');
  return `${SITE_ORIGIN}/updates/?q=${q}`;
}

// ====== 外置模板（或回退默认）======
function composeSubject({ vendor, topic, dateISO }) {
  if (TPL && TPL.composeSubject) return TPL.composeSubject({ vendor, topic, dateISO });
  const subjectTplPath = join('templates', 'outreach_subject.txt');
  const tpl = read(subjectTplPath, '[Evidence] {Vendor} changed {Topic} on {Date}');
  return tpl
    .replace(/\{Vendor\}/g, vendor || 'A vendor you track')
    .replace(/\{Topic\}/g, pickTopic(topic || 'Public change'))
    .replace(/\{Date\}/g, (dateISO || isoDate()));
}
function composeBody({ vendor, topic, dateISO, impact, packUrl }) {
  if (TPL && TPL.composeBody) return TPL.composeBody({ vendor, topic, dateISO, impact, packUrl });
  const bodyTplPath = join('templates', 'outreach_body.txt');
  const fallback = [
    'We detected a public change on {Vendor}: {Topic} ({Date}).',
    'Impact: {Impact}. Opt-out anytime.',
    'See verifiable details → {PackUrl}'
  ].join('\n');
  const tpl = read(bodyTplPath, fallback);
  return tpl
    .replace(/\{Vendor\}/g, vendor || 'a vendor you track')
    .replace(/\{Topic\}/g, pickTopic(topic || 'Public change'))
    .replace(/\{Date\}/g, (dateISO || isoDate()))
    .replace(/\{Impact\}/g, impact || toImpact(topic))
    .replace(/\{PackUrl\}/g, packUrl);
}

// ====== 抑制：N 天内不重复收件人 ======
const SUPPRESS_FILE = join('data', 'sent_recipients.csv');
function suppressSet(days = 3) {
  if (!exists(SUPPRESS_FILE)) return new Set();
  const min = Date.now() - days * 24 * 3600e3;
  const S = new Set();
  for (const l of lines(SUPPRESS_FILE)) {
    const [email, ts] = l.split(',');
    if (!email || !ts) continue;
    const t = /^\d+$/.test(ts) ? Number(ts) : (new Date(ts).getTime() || 0); // 兼容毫秒数或 ISO
    if (t >= min) S.add(String(email).toLowerCase());
  }
  return S;
}
function appendRecipients(list) {
  const ts = new Date().toISOString(); // 本脚本写 ISO
  fs.mkdirSync(path.dirname(SUPPRESS_FILE), { recursive: true });
  fs.appendFileSync(SUPPRESS_FILE, list.map(e => `${e},${ts}`).join('\n') + '\n', 'utf8');
}

// ====== 可选：外呼日志 ======
const OUTREACH_LOG = join('data', 'outreach_log.csv');
function logOutreach({ email, company, domain, vendor, packUrl, status }) {
  const when = new Date().toISOString();
  const row = [when, email, company, domain, vendor || '', 'LI', packUrl || '', '', status || (DRY ? 'dry' : 'sent')].join(',');
  fs.mkdirSync(path.dirname(OUTREACH_LOG), { recursive: true });
  fs.appendFileSync(OUTREACH_LOG, row + '\n', 'utf8');
}

// ====== Transport ======
function makeTransport() {
  return nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: (SMTP_USER && SMTP_PASS) ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
    rateDelta: 60_000,
    rateLimit: 120
  });
}

// ====== Main ======
(async function main() {
  const all = loadLeads();
  const sup = suppressSet(3);

  // 过滤并限量
  const list = [];
  for (const l of all) {
    if (sup.has(l.email)) continue;
    list.push(l);
    if (list.length >= LIMIT) break;
  }
  if (!list.length) { console.log('[bulk] no eligible leads'); return; }

  const transporter = makeTransport();
  const headers = {
    'List-Unsubscribe': `<mailto:${MAIL_FROM}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    'Precedence': 'bulk'
  };

  let sent = 0;
  const sentEmails = [];

  for (const lead of list) {
    // 选一个 vendor（优先第一个）
    const vendor = (lead.vendors && lead.vendors[0]) || '';
    const topic = 'Public change'; // S1 常规面层，不针对具体变更类型
    const dateISO = isoDate();
    const impact = toImpact(topic);
    const packUrl = resolvePackUrlForLead(lead, ymNow());

    const subject = composeSubject({ vendor, topic, dateISO });
    const text = composeBody({ vendor, topic, dateISO, impact, packUrl });

    if (DRY) {
      console.log(`[dry] to=${lead.email} subj="${subject}"`);
      console.log(text);
      continue;
    }

    try {
      await transporter.sendMail({
        from: MAIL_FROM,
        to: lead.email,
        bcc: BCC_TO || undefined,
        subject,
        text, // 纯文本三行
        headers
      });
      sent++;
      sentEmails.push(lead.email);
      logOutreach({ email: lead.email, company: lead.company, domain: lead.domain, vendor, packUrl, status: 'sent' });
    } catch (e) {
      console.error('[send][err]', lead.email, e && e.message || e);
      logOutreach({ email: lead.email, company: lead.company, domain: lead.domain, vendor, packUrl, status: 'error' });
    }
  }

  if (!DRY && transporter.close) {
    try { await transporter.close(); } catch {}
  }

  if (sentEmails.length) appendRecipients(sentEmails);

  const dt = new Date().toISOString();
  // 发送日志（简表）
  fs.mkdirSync('data', { recursive: true });
  fs.appendFileSync(join('data', 'sent_log.csv'), `${dt},bulk,${sent},"${(list[0] ? composeSubject({ vendor: (list[0].vendors||[])[0]||'', topic:'Public change', dateISO:dt.slice(0,10) }) : '').replace(/"/g,'\'')}"\n`);
  fs.writeFileSync(join('data', 'last_outreach.txt'), `${dt} bulk sent=${sent}\n`);

  console.log(`[bulk] done: sent=${sent}/${list.length}, dry=${DRY}`);
})().catch(e => {
  console.error(e && e.stack || e);
  process.exit(1);
});
