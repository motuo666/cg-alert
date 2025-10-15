#!/usr/bin/env node
/**
 * Triggered outreach (robust, diagnosable)
 * - Filters: status=new, mx_ok=1, persona, region, evidence-in-window vendor match
 * - Args: --dry=true|false, --limit=N, --pack (embed pack link), --window_h=72 (optional)
 * - Env: TRIGGER_WINDOW_H, SMTP_*, MAIL_FROM, BCC_TO, PERSONA_RULES, REGION_FILTER, SITE_ORIGIN
 * - Outputs: append to data/outreach_log.csv; update leads.csv status -> sent
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const ROOT = path.join(__dirname, '..');
const DATA = p => path.join(ROOT, 'data', p);
const CFG  = p => path.join(ROOT, 'config', p);

const now = new Date();
const Y = now.getUTCFullYear();
const M = String(now.getUTCMonth()+1).padStart(2,'0');
const CUR = `${Y}-${M}`;

const argv = require('node:process').argv.join(' ');
const DRY = /--dry(?:=| )?false/i.test(argv) ? false : true; // 默认 dry=true，只有明确 --dry=false 才发
const LIM = (() => { const m = argv.match(/--limit(?:=| )(\d+)/); return m ? Math.max(1, +m[1]) : 5; })();
const PACK = /--pack/i.test(argv);
const WINH = (() => {
  const cli = argv.match(/--window_h(?:=| )(\d+)/);
  if (cli) return Math.max(1, +cli[1]);
  const env = process.env.TRIGGER_WINDOW_H ? +process.env.TRIGGER_WINDOW_H : 72;
  return Math.max(1, env);
})();

const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const PERSONA_FILE = process.env.PERSONA_RULES || CFG('persona_rules.json');
const REGION_FILE  = process.env.REGION_FILTER  || CFG('region_filter.json');

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean);
}

function loadPersonaRules() {
  try { return JSON.parse(fs.readFileSync(PERSONA_FILE,'utf8')); }
  catch { return { allow_roles: ['legal','privacy','procurement','security','risk','compliance'], deny_prefix:['info@','support@','sales@','noreply@','no-reply@'], min_score:0.35 }; }
}
function loadRegionFilter() {
  try { return JSON.parse(fs.readFileSync(REGION_FILE,'utf8')); }
  catch { return { exclude_tld: ['.eu','.de','.fr','.it','.es','.nl','.se','.pl'], include_country: ['US','CA','AU','SG','GB','IE'] }; }
}

function parseLeadsCSV() {
  const file = DATA('leads.csv');
  if (!fs.existsSync(file)) return [];
  const raw = fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean);
  // 9列：email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok  （无表头）
  const rows = [];
  for (const line of raw) {
    const parts = line.split(',');
    if (parts.length < 9) continue; // 跳过脏行
    // 若多于9列，合并 company 中的额外逗号（保守做法）
    if (parts.length > 9) {
      const [email,...rest] = parts;
      const tail = rest.slice(-8);
      const company = rest.slice(0, rest.length-8).join(' ');
      rows.push([email, company, ...tail]);
    } else {
      rows.push(parts);
    }
  }
  return rows.map(cols => ({
    email  : cols[0]?.trim(),
    company: cols[1]?.trim(),
    domain : cols[2]?.trim(),
    v1     : cols[3]?.trim(),
    v2     : cols[4]?.trim(),
    v3     : cols[5]?.trim(),
    persona: cols[6]?.trim(),
    status : cols[7]?.trim(),
    mx_ok  : cols[8]?.trim(),
    _raw   : cols
  }));
}

function baseDomain(d) {
  if (!d) return '';
  const s = d.toLowerCase().replace(/^https?:\/\//,'').replace(/^www\./,'');
  // 取最后两段（简化，已足够）
  const parts = s.split('/');
  const host = parts[0] || s;
  const segs = host.split('.');
  if (segs.length >= 2) return segs.slice(-2).join('.');
  return host;
}

function tld(domain) {
  const b = baseDomain(domain);
  const i = b.lastIndexOf('.');
  return i>0 ? b.slice(i) : '';
}

function normVendorName(x) {
  if (!x) return '';
  // 名称 → 比对 token；域名 → 比对 baseDomain
  const s = x.toLowerCase().trim();
  if (s.includes('.')) return baseDomain(s);
  return s.replace(/[^a-z0-9]/g,''); // “sales force”→“salesforce”
}

function loadEvidenceWindowHours(hours) {
  const ndxFile = DATA('evidence.ndx');
  if (!fs.existsSync(ndxFile)) return [];
  const lines = fs.readFileSync(ndxFile,'utf8').split(/\r?\n/).filter(Boolean);
  const cutoff = Date.now() - hours*3600*1000;
  const changed = [];
  for (const l of lines) {
    const [date, slug, type, hash, rel] = l.split('\t');
    if (!date || !slug) continue;
    const ts = Date.parse(date+'T00:00:00Z');
    if (isNaN(ts) || ts < cutoff) continue;
    changed.push({ date, slug: baseDomain(slug), type, hash, rel });
  }
  return changed;
}

function existsPackFor(vendorSlug) {
  const p = path.join(ROOT, 'reports', CUR, vendorSlug, 'index.html');
  return fs.existsSync(p);
}

function packLinkFor(vendorSlug) {
  if (existsPackFor(vendorSlug)) return `${SITE}/reports/${CUR}/${vendorSlug}/`;
  // 退回 updates 搜索
  return `${SITE}/updates/?q=${encodeURIComponent(vendorSlug)}`;
}

function composeMail(vendorSlug, topic, when) {
  const subj = `[Evidence] ${vendorSlug} changed ${topic} on ${when}`;
  const body =
`We detected a public change on ${vendorSlug}: ${topic} (${when}).
Impact: ${topic==='Pricing' ? 'Budget/renewal risk' : (topic==='ToS' ? 'Contract/Legal' : 'Contract/Compliance')}. Opt-out anytime.
See verifiable details → ${packLinkFor(vendorSlug)}`;
  return { subj, body };
}

async function makeTransport() {
  const host = process.env.SMTP_HOST, port = +(process.env.SMTP_PORT||587);
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) throw new Error('SMTP secrets missing');
  return nodemailer.createTransport({
    host, port, secure: port===465,
    auth: { user, pass }
  });
}

function ensureOutreachLogHeader() {
  const f = DATA('outreach_log.csv');
  if (!fs.existsSync(f)) {
    fs.writeFileSync(f, 'when,email,company,domain,vendor,lawful_basis,evidence_link,optout_at,status\n', 'utf8');
  }
}

function appendLog(rec) {
  ensureOutreachLogHeader();
  const f = DATA('outreach_log.csv');
  const line = [
    rec.when,
    rec.email,
    rec.company,
    rec.domain,
    rec.vendor,
    'LI',
    rec.link,
    '',
    rec.status || 'sent'
  ].join(',') + '\n';
  fs.appendFileSync(f, line, 'utf8');
}

function updateLeadsStatus(sentEmails) {
  if (!sentEmails.size) return;
  const file = DATA('leads.csv');
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = line.split(',');
    if (cols.length < 9) { out.push(line); continue; }
    const email = cols[0].trim();
    if (sentEmails.has(email)) {
      cols[7] = 'sent'; // status 列
      out.push(cols.join(','));
    } else {
      out.push(line);
    }
  }
  fs.writeFileSync(file, out.join('\n')+'\n', 'utf8');
}

function includesAny(hay, allow) {
  const s = (hay||'').toLowerCase();
  return allow.some(k => s.includes(k.toLowerCase()));
}

(async function main(){
  const persona = loadPersonaRules();
  const region  = loadRegionFilter();
  const leads = parseLeadsCSV();
  const evid = loadEvidenceWindowHours(WINH);

  // 构建 “近期变更 vendor 集合” 与 “按 vendor 分桶的 first topic + date”
  const changedSet = new Set(evid.map(e => baseDomain(e.slug)));
  const byVendor = new Map();
  for (const e of evid) {
    const v = baseDomain(e.slug);
    const arr = byVendor.get(v) || [];
    arr.push(e);
    byVendor.set(v, arr);
  }

  // 逐层计数
  const total = leads.length;
  const passStatus = leads.filter(l => l.status === 'new' && l.mx_ok === '1');
  const passPersona = passStatus.filter(l => {
    const deny = (persona.deny_prefix||[]).some(p => l.email?.toLowerCase().startsWith(p));
    if (deny) return false;
    const src = (l.persona || l.email || '').toLowerCase();
    const ok = includesAny(src, persona.allow_roles||[]);
    return ok || (persona.min_score||0) <= 0.35; // 放宽阈值
  });
  const passRegion = passPersona.filter(l => {
    const tl = tld(l.domain);
    if ((region.exclude_tld||[]).includes(tl)) return false;
    return true;
  });

  // Vendor 匹配（v1,v2,v3 -> slug/name 归一，对上 evid changedSet 即通过）
  function matchVendorForLead(l) {
    const cand = [l.v1, l.v2, l.v3].map(normVendorName).filter(Boolean);
    for (const c of cand) {
      // 名称匹配：salesforce <-> salesforce.com
      for (const v of changedSet) {
        const vn = v.replace(/\./g,''); // salesforcecom
        if (c === v || c === vn || v.includes(c) || c.includes(vn)) {
          return v;
        }
      }
    }
    return null;
  }

  const withVendor = [];
  for (const l of passRegion) {
    const mv = matchVendorForLead(l);
    if (mv) withVendor.push({ lead:l, vendor:mv });
  }

  // 选取要发送的（限制数量）
  const toSend = withVendor.slice(0, LIM);

  // 诊断日志
  const diag = {
    total,
    'status+mx': passStatus.length,
    persona: passPersona.length,
    region: passRegion.length,
    'vendor-match': withVendor.length,
    final: toSend.length,
    window_h: WINH,
    changed_vendors: changedSet.size
  };
  console.log('eligibility:', JSON.stringify(diag));

  // 写到 Step Summary（GitHub Actions）
  try {
    if (process.env.GITHUB_STEP_SUMMARY) {
      const sum = `### Outreach Triggered Summary
- Leads total: ${total}
- After status+mx: ${passStatus.length}
- After persona: ${passPersona.length}
- After region: ${passRegion.length}
- Vendors changed in last ${WINH}h: ${changedSet.size}
- Vendor-matched leads: ${withVendor.length}
- Will send (limit=${LIM}): ${toSend.length}
`;
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, sum, 'utf8');
    }
  } catch {}

  if (!toSend.length) {
    console.log('no eligible leads');
    process.exit(0);
  }

  // 发送（或 dry run）
  const sentEmails = new Set();
  let transporter = null;
  if (!DRY) {
    transporter = await makeTransport();
  }

  for (const item of toSend) {
    const { lead, vendor } = item;
    // 选 topic & when：取该 vendor 最近一条证据
    const arr = (byVendor.get(vendor)||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));
    const top = arr[0] || { type:'Change', date:new Date().toISOString().slice(0,10) };
    const topic = (top.type || 'Change');
    const when  = top.date || new Date().toISOString().slice(0,10);

    const { subj, body } = composeMail(vendor, topic, when);

    if (DRY) {
      console.log(`DRY SENT to ${lead.email} subj="${subj}" link="${packLinkFor(vendor)}"`);
      appendLog({ when: new Date().toISOString(), email: lead.email, company: lead.company, domain: lead.domain, vendor, link: packLinkFor(vendor), status:'dry' });
      sentEmails.add(lead.email);
      continue;
    }

    try {
      const mail = {
        from: process.env.MAIL_FROM,
        to: lead.email,
        bcc: process.env.BCC_TO || undefined,
        subject: subj,
        text: body
      };
      await transporter.sendMail(mail);
      console.log(`SENT to ${lead.email} vendor=${vendor}`);
      appendLog({ when: new Date().toISOString(), email: lead.email, company: lead.company, domain: lead.domain, vendor, link: packLinkFor(vendor), status:'sent' });
      sentEmails.add(lead.email);
    } catch (e) {
      console.error(`FAIL to ${lead.email}: ${e.message}`);
      appendLog({ when: new Date().toISOString(), email: lead.email, company: lead.company, domain: lead.domain, vendor, link: packLinkFor(vendor), status:'fail' });
    }
  }

  // 标记已发送
  if (sentEmails.size) updateLeadsStatus(sentEmails);

  console.log(`Send Triggered ${sentEmails.size} emails`);
  process.exit(0);
})().catch(e => {
  console.error(e);
  process.exit(1);
});
