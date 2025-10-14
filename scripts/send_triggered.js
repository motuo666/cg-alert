#!/usr/bin/env node
// send_triggered.js — 触发式：仅在窗口期内有证据才发；三行外呼模板外置；角色/地域过滤（可选）；历史抑制；日上限
// 依赖（可选）：scripts/outreach_templates.js；若不存在则使用内置默认模板逻辑
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const minimist = require('minimist');

// ====== CLI & ENV ======
const argv = minimist(process.argv.slice(2), {
  boolean: ['dry'],
  string: ['limit', 'window-h', 'window_h'],
  default: { dry: true, limit: '20', 'window-h': '48' }
});
const DRY = argv.dry !== false && String(argv.dry) !== 'false';
const LIMIT = Math.max(1, Number(argv.limit || '20'));
const WINDOW_H = Number(argv['window-h'] || argv['window_h'] || '48');

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
function ymFromISO(iso) { return (iso || new Date().toISOString()).slice(0, 7); }

// ====== Persona / Region Filters (optional, zero-cost) ======
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
function parseLead(row) {
  // 9列：email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok
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
    .filter(x => x.mx_ok && x.status === 'new')
    .filter(x => emailAllowed(x.email) && personaAllowed(x.persona) && regionAllowed(x.domain));
}

// ====== Evidence scanning ======
const EVD_DIR = 'evidence';
const FILE_RE = /^(\d{4}-\d{2}-\d{2})-([A-Za-z]+)-([a-f0-9]{6,})\.json$/;

function recentEvidenceMap(windowH) {
  // 返回 Map<vendorSlug, Array<{dateISO,type,hash,relPath,mtimeMs}>>
  const out = new Map();
  if (!exists(EVD_DIR)) return out;
  const minMs = Date.now() - windowH * 3600e3;
  for (const d of fs.readdirSync(EVD_DIR, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const slug = d.name;
    const dir = join(EVD_DIR, slug);
    for (const f of fs.readdirSync(dir)) {
      if (!FILE_RE.test(f)) continue;
      const m = f.match(FILE_RE);
      const dateISO = m[1];
      const type = m[2];
      const hash = m[3];
      const full = join(dir, f);
      const st = fs.statSync(full);
      if (st.mtimeMs >= minMs) {
        const arr = out.get(slug) || [];
        arr.push({ dateISO, type, hash, relPath: full.replace(/\\/g, '/'), mtimeMs: st.mtimeMs });
        out.set(slug, arr);
      }
    }
  }
  // sort desc by mtime
  for (const [k, arr] of out) {
    arr.sort((a, b) => b.mtimeMs - a.mtimeMs);
    out.set(k, arr);
  }
  return out;
}
function latestFor(slug, m) {
  const arr = m.get(slug) || [];
  return arr[0] || null;
}

// ====== Templates (external module with graceful fallback) ======
let TPL = null;
try { TPL = require('./outreach_templates'); } catch (e) { TPL = null; }

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
function resolvePackUrl(vendor, isoYM) {
  if (TPL && TPL.resolvePackUrl) return TPL.resolvePackUrl(vendor, isoYM);
  const ym = isoYM || new Date().toISOString().slice(0, 7);
  const local = join('reports', ym, vendor, 'index.html');
  if (exists(local)) return `${SITE_ORIGIN}/reports/${ym}/${vendor}/`;
  return `${SITE_ORIGIN}/updates/?q=${encodeURIComponent(vendor)}`;
}
function composeSubject({ vendor, topic, dateISO }) {
  if (TPL && TPL.composeSubject) return TPL.composeSubject({ vendor, topic, dateISO });
  // Fallback: read templates/outreach_subject.txt or use default
  const subjectTplPath = join('templates', 'outreach_subject.txt');
  const tpl = read(subjectTplPath, '[Evidence] {Vendor} changed {Topic} on {Date}');
  return tpl
    .replace(/\{Vendor\}/g, vendor)
    .replace(/\{Topic\}/g, pickTopic(topic))
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
    .replace(/\{Vendor\}/g, vendor)
    .replace(/\{Topic\}/g, pickTopic(topic))
    .replace(/\{Date\}/g, (dateISO || isoDate()))
    .replace(/\{Impact\}/g, (impact || toImpact(topic)))
    .replace(/\{PackUrl\}/g, (packUrl || resolvePackUrl(vendor, ymFromISO(dateISO))));
}

// ====== Suppression (7-day per recipient) ======
const SUPPRESS_FILE = join('data', 'sent_recipients.csv');
function suppressSet(days = 7) {
  if (!exists(SUPPRESS_FILE)) return new Set();
  const min = Date.now() - days * 24 * 3600e3;
  const S = new Set();
  for (const l of lines(SUPPRESS_FILE)) {
    const [email, ts] = l.split(',');
    if (Number(ts) >= min) S.add(String(email || '').toLowerCase());
  }
  return S;
}
function appendRecipients(list) {
  const ts = Date.now();
  fs.mkdirSync(path.dirname(SUPPRESS_FILE), { recursive: true });
  fs.appendFileSync(SUPPRESS_FILE, list.map(e => `${e},${ts}`).join('\n') + '\n', 'utf8');
}

// ====== Optional: Outreach Log ======
const OUTREACH_LOG = join('data', 'outreach_log.csv');
function logOutreach({ email, company, domain, vendor, packUrl, status }) {
  const when = new Date().toISOString();
  const row = [when, email, company, domain, vendor, 'LI', packUrl, '', status || (DRY ? 'dry' : 'sent')].join(',');
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
    pool: true, maxConnections: 2, maxMessages: 50, rateLimit: 120
  });
}

// ====== Main ======
(async function main() {
  // 1) 近窗口期有证据的 vendor
  const recentMap = recentEvidenceMap(WINDOW_H);
  if (recentMap.size === 0) {
    console.log('no fresh evidence → skip');
    process.exit(0);
  }

  // 2) 线索过滤：与 recent vendor 交集 + 抑制 + 角色/地域
  const allLeads = loadLeads();
  const sup = suppressSet(7);
  const eligible = [];
  for (const l of allLeads) {
    if (sup.has(l.email)) continue;
    const hitVendor = l.vendors.find(v => recentMap.has(v));
    if (!hitVendor) continue;
    const latest = latestFor(hitVendor, recentMap);
    if (!latest) continue;
    eligible.push({ lead: l, vendor: hitVendor, evidence: latest });
    if (eligible.length >= LIMIT) break;
  }

  if (eligible.length === 0) {
    console.log('no eligible leads');
    process.exit(0);
  }

  // 3) 发信准备
  const transporter = makeTransport();
  const sent = [];

  for (const item of eligible) {
    const { lead, vendor, evidence } = item;
    const topic = evidence.type || 'Public change';
    const dateISO = evidence.dateISO || isoDate();
    const impact = toImpact(topic);
    const packUrl = resolvePackUrl(vendor, ymFromISO(dateISO));

    const subject = composeSubject({ vendor, topic, dateISO });
    const text = composeBody({ vendor, topic, dateISO, impact, packUrl });

    const msg = {
      from: MAIL_FROM,
      to: lead.email,
      subject,
      text, // 纯文本三行
      headers: {
        'List-Unsubscribe': `<mailto:${MAIL_FROM}?subject=unsubscribe>`,
        'Precedence': 'bulk'
      }
    };
    if (BCC_TO) msg.bcc = BCC_TO;

    if (DRY) {
      console.log(`[dry] to=${lead.email} vendor=${vendor} topic=${topic} date=${dateISO}`);
      console.log(subject);
      console.log(text);
    } else {
      await transporter.sendMail(msg);
    }

    sent.push(lead.email);
    logOutreach({ email: lead.email, company: lead.company, domain: lead.domain, vendor, packUrl, status: DRY ? 'dry' : 'sent' });
  }

  appendRecipients(sent);
  console.log(`triggered sent=${sent.length}/${LIMIT}, dry=${DRY}`);
})().catch(err => {
  console.error('send_triggered error:', err && err.stack || err);
  process.exit(1);
});
