#!/usr/bin/env node
/**
 * Triggered outreach (robust, diagnosable, final)
 * - Filters: status=new, mx_ok=1, persona, region, evidence-in-window vendor match
 * - Cooldowns: per email (30d), per domain cap (<=4 in 7d), per vendor×company (14d)
 * - Args: --dry=true|false, --limit=N, --pack, --window_h=72
 * - Env: TRIGGER_WINDOW_H, SMTP_*, MAIL_FROM, BCC_TO, PERSONA_RULES, REGION_FILTER, SITE_ORIGIN
 * - Outputs: append to data/outreach_log.csv; update leads.csv status -> sent
 * - Diagnostics: prints eligibility counts; writes GitHub Step Summary if available
 */

const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');

const ROOT = path.join(__dirname, '..');
const DATA = p => path.join(ROOT, 'data', p);
const CFG  = p => path.join(ROOT, 'config', p);

const now = new Date();
const Y = now.getUTCFullYear();
const M = String(now.getUTCMonth() + 1).padStart(2, '0');
const CUR = `${Y}-${M}`;

const argvStr = require('node:process').argv.join(' ');
const DRY = /--dry(?:=| )?false/i.test(argvStr) ? false : true; // 默认 dry=true
const LIM = (() => { const m = argvStr.match(/--limit(?:=| )(\d+)/); return m ? Math.max(1, +m[1]) : 5; })();
const PACK = /--pack/i.test(argvStr);
let WINH = (() => {
  const cli = argvStr.match(/--window_h(?:=| )(\d+)/);
  if (cli) return Math.max(1, +cli[1]);
  const env = process.env.TRIGGER_WINDOW_H ? +process.env.TRIGGER_WINDOW_H : 72;
  return Math.max(1, env);
})();

const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const PERSONA_FILE = process.env.PERSONA_RULES || CFG('persona_rules.json');
const REGION_FILE  = process.env.REGION_FILTER  || CFG('region_filter.json');

const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com','yahoo.com','outlook.com','hotmail.com','aol.com','icloud.com',
  'proton.me','protonmail.com','zoho.com','hey.com'
]);

function isFreeMailbox(email){
  const m = String(email || '').toLowerCase().match(/@([^>]+)$/);
  return m ? FREE_EMAIL_DOMAINS.has(m[1]) : false;
}
function wait(ms){ return new Promise(r => setTimeout(r, ms)); }
function readLines(file) { if (!fs.existsSync(file)) return []; return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean); }

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
  // 9列：email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok（无表头）
  const rows = [];
  for (const line of raw) {
    const parts = line.split(',');
    if (parts.length < 9) continue;
    if (parts.length > 9) { // company 里含逗号
      const [email, ...rest] = parts;
      const tail = rest.slice(-8);
      const company = rest.slice(0, rest.length - 8).join(' ');
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
  const host = (s.split('/')[0] || s);
  const segs = host.split('.');
  if (segs.length >= 2) return segs.slice(-2).join('.');
  return host;
}
function tld(domain) {
  const b = baseDomain(domain);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i) : '';
}
function normVendorName(x) {
  if (!x) return '';
  const s = x.toLowerCase().trim();
  if (s.includes('.')) return baseDomain(s);
  return s.replace(/[^a-z0-9]/g,'');
}

// —— URL 相关 ——
// 返回 Change Pack 或 Updates 搜索页（不带 UTM）
function existsPackFor(vendorSlug) {
  const p = path.join(ROOT, 'reports', CUR, vendorSlug, 'index.html');
  return fs.existsSync(p);
}
function packLinkFor(vendorSlug) {
  return existsPackFor(vendorSlug)
    ? `${SITE}/reports/${CUR}/${vendorSlug}/`
    : `${SITE}/updates/?q=${encodeURIComponent(vendorSlug)}`;
}
// 按需拼接 UTM（自动决定 ? 或 &）
function addUTM(baseUrl, when) {
  const sep = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${sep}utm_source=email&utm_medium=triggered&utm_campaign=cp_${when.slice(0,7)}`;
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

function composeMail(vendorSlug, topic, when, hash8) {
  const t = String(topic||'').toLowerCase();
  const pretty =
    t.includes('pricing') ? 'Pricing' :
    t === 'tos' || t.includes('term') ? 'Terms of Service' :
    t === 'dpa' || t.includes('privacy') ? 'DPA' :
    t.includes('subprocessor') ? 'Subprocessors' :
    t.includes('status') || t.includes('sla') ? 'SLA/Status' :
    'Policy/Contract';

  const impact =
    pretty === 'Pricing' ? 'Budget / renewal risk' :
    pretty === 'Terms of Service' ? 'Contract / Legal' :
    pretty === 'DPA' ? 'Privacy / data processing' :
    pretty === 'Subprocessors' ? 'Vendor risk / DP addendum' :
    'Contract / Compliance';

  const base = packLinkFor(vendorSlug);
  const url  = addUTM(base, when);
  const subj = `[Evidence] ${vendorSlug} changed ${pretty} on ${when}`;
  const body =
`We verified a public change on ${vendorSlug}: ${pretty} (${when}).
Impact: ${impact}. Evidence: ${hash8 ? '#'+hash8 : 'n/a'}.
See verifiable details → ${url}`;
  return { subj, body, url };
}

async function makeTransport() {
  const host = process.env.SMTP_HOST, port = +(process.env.SMTP_PORT||587);
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) throw new Error('SMTP secrets missing');
  return nodemailer.createTransport({ host, port, secure: port===465, auth: { user, pass } });
}

function ensureOutreachLogHeader() {
  const f = DATA('outreach_log.csv');
  if (!fs.existsSync(f)) fs.writeFileSync(f, 'when,email,company,domain,vendor,lawful_basis,evidence_link,optout_at,status\n', 'utf8');
}
function appendLog(rec) {
  ensureOutreachLogHeader();
  const f = DATA('outreach_log.csv');
  const line = [
    rec.when, rec.email, rec.company, rec.domain, rec.vendor,
    'LI', rec.link, rec.optout_at || '', rec.status || 'sent'
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
    if (sentEmails.has(email)) { cols[7] = 'sent'; out.push(cols.join(',')); }
    else out.push(line);
  }
  fs.writeFileSync(file, out.join('\n')+'\n', 'utf8');
}
function includesAny(hay, allow) { const s = (hay||'').toLowerCase(); return (allow||[]).some(k => s.includes(String(k).toLowerCase())); }

// outreach 历史：冷却 & 限流
function loadOutreachHistory(daysBack=30){
  const f = DATA('outreach_log.csv'); if(!fs.existsSync(f)) return [];
  const since = Date.now()-daysBack*86400*1000;
  return fs.readFileSync(f,'utf8').split(/\r?\n/).slice(1).filter(Boolean).map(l=>{
    const [when,email,company,domain,vendor,,link,optout_at,status]=l.split(',');
    return { when:Date.parse(when), email, company, domain, vendor, optout_at, status };
  }).filter(r=>!isNaN(r.when) && r.when>=since);
}
function sentToEmailWithin(history,email,days){ const since=Date.now()-days*86400*1000; return history.some(r=>r.email===email && r.when>=since && r.status!=='fail'); }
function sentCountToDomainWithin(history,domain,days){ const since=Date.now()-days*86400*1000; return history.filter(r=>r.domain===domain && r.when>=since && r.status!=='fail').length; }
function sentVendorToCompanyWithin(history,vendor,company,days){ const since=Date.now()-days*86400*1000; return history.some(r=>r.vendor===vendor && r.company===company && r.when>=since && r.status!=='fail'); }

(async function main(){
  const persona = loadPersonaRules();
  const region  = loadRegionFilter();
  const leads = parseLeadsCSV();

  // 证据窗口：若当前窗口无证据，自动兜底到 168h
  let evid = loadEvidenceWindowHours(WINH);
  if (evid.length===0 && WINH<168){ console.log(`no evidence in ${WINH}h; fallback to 168h`); WINH=168; evid = loadEvidenceWindowHours(WINH); }

  const hist = loadOutreachHistory(30);

  // 构建 changed vendor 集合 & 分桶
  const changedSet = new Set(evid.map(e => baseDomain(e.slug)));
  const byVendor = new Map();
  for (const e of evid) {
    const v = baseDomain(e.slug);
    const arr = byVendor.get(v) || [];
    arr.push(e);
    byVendor.set(v, arr);
  }

  // 逐层过滤
  const total = leads.length;
  const passStatus = leads.filter(l => l.status === 'new' && l.mx_ok === '1');
  const passPersona = passStatus.filter(l => {
    if (isFreeMailbox(l.email)) return false;
    const deny = (persona.deny_prefix||[]).some(p => l.email?.toLowerCase().startsWith(p));
    if (deny) return false;
    const src = (l.persona || l.email || '').toLowerCase();
    const ok = includesAny(src, persona.allow_roles||[]);
    return ok || (persona.min_score||0) <= 0.35;
  });
  const passRegion = passPersona.filter(l => {
    const tl = tld(l.domain);
    if ((region.exclude_tld||[]).includes(tl)) return false;
    return true;
  });

  // Vendor 匹配
  function matchVendorForLead(l) {
    const cand = [l.v1, l.v2, l.v3].map(normVendorName).filter(Boolean);
    for (const c of cand) {
      for (const v of changedSet) {
        const vn = v.replace(/\./g,'');
        if (c === v || c === vn || v.includes(c) || c.includes(vn)) return v;
      }
    }
    return null;
  }
  const withVendor = [];
  for (const l of passRegion) {
    const mv = matchVendorForLead(l);
    if (mv) withVendor.push({ lead:l, vendor:mv });
  }

  // 冷却与域限流
  const cooled = [];
  const DOMAIN_CAP = 4, DOMAIN_WINDOW_D=7, EMAIL_COOLDOWN_D=30, VENDOR_COMPANY_D=14;
  const domainCnt = {};
  for (const item of withVendor){
    const {lead, vendor} = item;
    if (sentToEmailWithin(hist, lead.email, EMAIL_COOLDOWN_D)) continue;
    if (sentVendorToCompanyWithin(hist, vendor, lead.company, VENDOR_COMPANY_D)) continue;
    const d = lead.domain;
    domainCnt[d] = domainCnt[d] || sentCountToDomainWithin(hist, d, DOMAIN_WINDOW_D);
    if (domainCnt[d] >= DOMAIN_CAP) continue;
    domainCnt[d]++; cooled.push(item);
  }

  // 选取
  const toSend = cooled.slice(0, LIM);

  // 诊断 + Summary
  const diag = {
    total,
    'status+mx': passStatus.length,
    persona: passPersona.length,
    region: passRegion.length,
    'vendor-match': withVendor.length,
    cooled: cooled.length,
    final: toSend.length,
    window_h: WINH,
    changed_vendors: changedSet.size
  };
  console.log('eligibility:', JSON.stringify(diag));
  try {
    if (process.env.GITHUB_STEP_SUMMARY) {
      const sum =
`### Outreach Triggered Summary
- Leads total: ${total}
- After status+mx: ${passStatus.length}
- After persona: ${passPersona.length}
- After region: ${passRegion.length}
- Vendors changed in last ${WINH}h: ${changedSet.size}
- Vendor-matched: ${withVendor.length}
- After cooldown/domain-cap: ${cooled.length}
- Will send (limit=${LIM}): ${toSend.length}
`;
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, sum, 'utf8');
    }
  } catch {}

  if (!toSend.length) { console.log('no eligible leads'); process.exit(0); }

  // 发送
  const sentEmails = new Set();
  let transporter = null;
  if (!DRY) transporter = await makeTransport();

  for (let i=0; i<toSend.length; i++) {
    const { lead, vendor } = toSend[i];

    // 取该 vendor 最近一条证据
    const arr = (byVendor.get(vendor)||[]).slice().sort((a,b)=>b.date.localeCompare(a.date));
    const top = arr[0] || { type:'Change', date:new Date().toISOString().slice(0,10), hash:'' };
    const topic = top.type || 'Change';
    const when  = top.date || new Date().toISOString().slice(0,10);
    const rawH  = String(top.hash || '').toLowerCase();
    const hash8 = (!rawH || /^0+$/i.test(rawH)) ? '' : rawH.slice(0,8);

    const { subj, body, url } = composeMail(vendor, topic, when, hash8);

    if (DRY) {
      console.log(`DRY SENT to ${lead.email} subj="${subj}" link="${url}"`);
      appendLog({ when: new Date().toISOString(), email: lead.email, company: lead.company, domain: lead.domain, vendor, link: url, status:'dry' });
      sentEmails.add(lead.email);
      continue;
    }

    try {
      const mail = {
        from: process.env.MAIL_FROM,
        to: lead.email,
        bcc: process.env.BCC_TO || undefined,
        subject: subj,
        text: body,
        headers: { 'X-Mailin-Tag': 'triggered' } // Brevo 标签
      };
      await transporter.sendMail(mail);
      console.log(`SENT to ${lead.email} vendor=${vendor}`);
      appendLog({ when: new Date().toISOString(), email: lead.email, company: lead.company, domain: lead.domain, vendor, link: url, status:'sent' });
      sentEmails.add(lead.email);
      // 轻节流：3–8 秒
      await wait(3000 + Math.floor(Math.random()*5000));
    } catch (e) {
      console.error(`FAIL to ${lead.email}: ${e.message}`);
      appendLog({ when: new Date().toISOString(), email: lead.email, company: lead.company, domain: lead.domain, vendor, link: url, status:'fail' });
    }
  }

  if (sentEmails.size) updateLeadsStatus(sentEmails);
  console.log(`Send Triggered ${sentEmails.size} emails`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
