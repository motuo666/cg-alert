#!/usr/bin/env node
/**
 * send_triggered.js — 覆盖版（稳态 + 可强制放开）
 * 目标：
 * - 支持 dry / limit / pack / TRIGGER_WINDOW_H
 * - 支持 ENV/CLI 覆盖：DOMAIN_CAP / DOMAIN_WINDOW_DAYS / EMAIL_COOLDOWN_DAYS / VENDOR_COMPANY_COOLDOWN_DAYS
 *   以及别名：--domain_cap, --domain_window_d, --email_cooldown_d, --vendor_company_d
 *   兼容误写：COOLDOWN_DAYS（一次性同时下调三个 cooldown）
 * - 过滤：status+mx → persona → region → vendor-match（近窗真实变更）→ cooldown & caps（含 domain window 与当日上限）
 * - 输出 eligibility JSON；dry 模式打印 DRY SENT；非 dry 追加 data/outreach_log.csv
 * - 邮件正文使用三行模板（最简），链接自动加 utm
 * - 提供救火开关：FORCE_MIN_SEND / --force_min_send
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch (_) { /* optional */ }

const argv = require('minimist')(process.argv.slice(2));
const DRY   = truthy(argv.dry, true);
const LIMIT = num(argv.limit, 12);
const PACK  = truthy(argv.pack, false);

const SITE_ORIGIN     = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const TRIGGER_WINDOW_H= num(process.env.TRIGGER_WINDOW_H ?? argv.window_h, 168);

// caps / cooldown（支持 env、CLI、以及历史误写 COOLDOWN_DAYS）
let DOMAIN_CAP                    = num(process.env.DOMAIN_CAP                    ?? argv.domain_cap,        1);
let DOMAIN_WINDOW_DAYS            = num(process.env.DOMAIN_WINDOW_DAYS            ?? argv.domain_window_d,   14);
let EMAIL_COOLDOWN_DAYS           = num(process.env.EMAIL_COOLDOWN_DAYS           ?? argv.email_cooldown_d,  14);
let VENDOR_COMPANY_COOLDOWN_DAYS  = num(process.env.VENDOR_COMPANY_COOLDOWN_DAYS  ?? argv.vendor_company_d,  14);
// 兼容误写：COOLDOWN_DAYS 一把梭（取更小的）
const CD_ALIAS = toNum(process.env.COOLDOWN_DAYS ?? argv.cooldown_days);
if (CD_ALIAS !== null) {
  DOMAIN_WINDOW_DAYS           = Math.min(DOMAIN_WINDOW_DAYS,           CD_ALIAS);
  EMAIL_COOLDOWN_DAYS          = Math.min(EMAIL_COOLDOWN_DAYS,          CD_ALIAS);
  VENDOR_COMPANY_COOLDOWN_DAYS = Math.min(VENDOR_COMPANY_COOLDOWN_DAYS, CD_ALIAS);
}

// 最低发送量（仅救火用；正常留 0）
const FORCE_MIN_SEND = num(process.env.FORCE_MIN_SEND ?? argv.force_min_send, 0);

const MAIL_FROM     = process.env.MAIL_FROM || '';
const BCC_TO        = process.env.BCC_TO || '';
const PERSONA_RULES = process.env.PERSONA_RULES || 'config/persona_rules.json';
const REGION_FILTER = process.env.REGION_FILTER || 'config/region_filter.json';

const ROOT        = path.join(__dirname, '..');
const LEADS_CSV   = path.join(ROOT, 'data', 'leads.csv');
const OUT_CSV     = path.join(ROOT, 'data', 'outreach_log.csv');
const EVIDENCE_NDX= path.join(ROOT, 'data', 'evidence.ndx');
const EVID_DIR    = path.join(ROOT, 'evidence');

// ---------- utils ----------
function truthy(v, def=false){
  if (v === undefined || v === null || v === '') return def;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}
function num(v, d){
  if (v === undefined || v === null || v === '') return d;
  const n = Number(v); return Number.isFinite(n) ? n : d;
}
function toNum(v){
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v); return Number.isFinite(n) ? n : null;
}
function today(){ return new Date().toISOString().slice(0,10); }
function dsub(d, days){ return new Date(d.getTime() - days*86400000); }
function parseISO(s){ const t = Date.parse(s); return Number.isFinite(t)?new Date(t):null; }
function lc(s){ return String(s||'').toLowerCase(); }
function includesAny(hay, allow){
  const s = String(hay||'').toLowerCase();
  return (allow||[]).some(k => s.includes(String(k||'').toLowerCase()));
}
function readJSON(fp){ try { return JSON.parse(fs.readFileSync(fp,'utf8')); }catch(_){ return null; } }
function exists(fp){ try{ fs.accessSync(fp); return true; }catch(_){ return false; } }

function readCSVRows(fp){
  if (!exists(fp)) return [];
  const txt = fs.readFileSync(fp,'utf8').trim();
  if (!txt) return [];
  return txt.split(/\r?\n/).map(l=>l.replace(/\t/g,',').trim()).filter(Boolean).map(l=>l.split(','));
}
function appendCSV(fp, header, rows){
  const has = exists(fp) && fs.statSync(fp).size>0;
  const out = [];
  if (!has && header) out.push(header.join(','));
  for (const r of rows) out.push(r.map(x=>String(x??'').replace(/[\r\n,]+/g,' ')).join(','));
  fs.mkdirSync(path.dirname(fp), {recursive:true});
  fs.appendFileSync(fp, (has?os.EOL:'') + out.join(os.EOL));
}

// ---------- persona / region ----------
function loadPersonaAllow(){
  if (!exists(PERSONA_RULES)) return null;
  const j = readJSON(PERSONA_RULES);
  if (Array.isArray(j)) return new Set(j.map(lc));
  if (j && typeof j==='object') return new Set(Object.keys(j).map(lc));
  return null;
}
function personaAllowed(p, allowSet){
  if (!allowSet) return true;
  return allowSet.has(lc(p));
}
function loadRegionFilter(){
  if (!exists(REGION_FILTER)) return null;
  const j = readJSON(REGION_FILTER);
  if (!j) return null;
  // 支持 {allow:[], deny:[]} 或 简单数组
  return j;
}
function inRegion(email, companyDomain, regionCfg){
  if (!regionCfg) return true;
  const allow = regionCfg.allow || regionCfg.ALLOW || regionCfg;
  const deny  = regionCfg.deny  || regionCfg.DENY || [];
  const target = (companyDomain || (email.split('@')[1]||'')).toLowerCase();
  if (Array.isArray(deny) && includesAny(target, deny)) return false;
  if (Array.isArray(allow) && allow.length>0) return includesAny(target, allow);
  return true;
}

// ---------- evidence ----------
function loadChangedVendors(windowH){
  const res = new Set();
  if (!exists(EVIDENCE_NDX)) return res;
  const cutoff = Date.now() - windowH*3600*1000;
  const lines = fs.readFileSync(EVIDENCE_NDX,'utf8').split(/\r?\n/);
  for (const ln of lines){
    if (!ln.trim()) continue;
    // 预期：ts \t domain \t type \t hash \t url ...
    const cols = ln.split('\t');
    if (cols.length < 4) continue;
    const ts = Date.parse(cols[0]); if (!Number.isFinite(ts) || ts<cutoff) continue;
    const domain = (cols[1]||'').toLowerCase();
    const hash = cols[3]||'';
    if (!hash || /^0+$/.test(hash)) continue; // 仅非零 hash 算真实变更
    if (domain) res.add(domain);
  }
  return res;
}
function latestEvidenceForVendor(vendor){
  const dir = path.join(EVID_DIR, vendor);
  if (!exists(dir)) return null;
  const files = fs.readdirSync(dir).filter(f=>/^\d{4}-\d{2}-\d{2}-/.test(f) && f.endsWith('.json')).sort().reverse();
  for (const f of files){
    if (f.includes('00000000')) continue; // 跳过基线
    const m = f.match(/^(\d{4}-\d{2}-\d{2})-([A-Za-z]+)-([0-9a-fA-F]+)\.json$/);
    const when = m? m[1] : f.slice(0,10);
    const typ  = m? m[2] : 'Change';
    const hash = m? m[3] : '';
    let url = `${SITE_ORIGIN}/updates/?q=${encodeURIComponent(vendor)}`;
    const j = readJSON(path.join(EVID_DIR, vendor, f));
    if (j && (j.url || j.link || j.URL)) url = j.url || j.link || j.URL;
    return {when, type:typ, hash, url, file:f};
  }
  return null;
}
function buildPackLink(vendor){
  const ym = new Date().toISOString().slice(0,7);
  return `${SITE_ORIGIN}/reports/${ym}/${vendor}/`;
}
function addUtm(u, campaign=`cp_${new Date().toISOString().slice(0,7).replace('-','')}`){
  const url = new URL(u, SITE_ORIGIN);
  url.searchParams.set('utm_source','email');
  url.searchParams.set('utm_medium','triggered');
  url.searchParams.set('utm_campaign', campaign);
  return url.toString();
}

// ---------- outreach history ----------
function loadOutreachHistory(){
  const mapEmail = new Map();
  const mapCompany = new Map();       // companyDomain -> last ts
  const mapVendorCompany = new Map(); // vendor|company -> last ts
  if (!exists(OUT_CSV)) return {mapEmail,mapCompany,mapVendorCompany};
  const lines = fs.readFileSync(OUT_CSV,'utf8').split(/\r?\n/).filter(Boolean);
  let i = 0;
  if (lines[0] && /when,?email,?company/i.test(lines[0])) i = 1; // 跳过表头
  for (; i<lines.length; i++){
    const cols = lines[i].split(',');
    const when = parseISO(cols[0]); if (!when) continue;
    const email  = lc(cols[1]||'');
    const domain = lc(cols[3]||'');
    const vendor = lc(cols[4]||'');
    const keyVC = `${vendor}|${domain}`;
    const t = when.getTime();
    if (email)  mapEmail.set(email,  Math.max(mapEmail.get(email)||0, t));
    if (domain) mapCompany.set(domain,Math.max(mapCompany.get(domain)||0, t));
    if (vendor && domain) mapVendorCompany.set(keyVC, Math.max(mapVendorCompany.get(keyVC)||0, t));
  }
  return {mapEmail,mapCompany,mapVendorCompany};
}
function daysSince(ts){ return (Date.now() - ts) / 86400000; }

// ---------- mail ----------
function makeTransport(){
  if (!nodemailer) return null;
  const host=process.env.SMTP_HOST, port=num(process.env.SMTP_PORT,587);
  const user=process.env.SMTP_USER, pass=process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({host, port, secure:port===465, auth:{user, pass}});
}
async function sendMail(transport, to, subject, text){
  if (!transport) return false;
  try{
    const opt = {from: MAIL_FROM, to, subject, text};
    if (BCC_TO) opt.bcc = BCC_TO;
    await transport.sendMail(opt);
    return true;
  }catch(_){ return false; }
}

// ---------- main ----------
async function main(){
  // 0) 读 leads
  const leads = readCSVRows(LEADS_CSV).map(cols => ({
    // email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok
    email: cols[0]||'',
    company: cols[1]||'',
    domain: lc(cols[2]||''),
    vendor1: lc(cols[3]||''),
    vendor2: lc(cols[4]||''),
    vendor3: lc(cols[5]||''),
    persona: lc(cols[6]||''),
    status:  lc(cols[7]||''),
    mx_ok: Number(cols[8]||'0')===1
  }));

  const personaAllow = loadPersonaAllow();
  const regionCfg    = loadRegionFilter();
  const changedVendors = loadChangedVendors(TRIGGER_WINDOW_H);

  // 1) status+mx
  let pool = leads.filter(l => {
    if (!l.email || !l.mx_ok) return false;
    if (['unsub','optout','bounced','invalid','bad-mx'].includes(l.status)) return false;
    return true;
  });
  const c_status_mx = pool.length;

  // 2) persona
  pool = pool.filter(l => personaAllowed(l.persona, personaAllow));
  const c_persona = pool.length;

  // 3) region
  pool = pool.filter(l => inRegion(l.email, l.domain, regionCfg));
  const c_region = pool.length;

  // 4) vendor-match（与“近窗真实变更的供应商域”相等）
  const vendorMatched = (l) => {
    const arr = [l.vendor1,l.vendor2,l.vendor3].filter(Boolean);
    for (const v of arr){ if (changedVendors.has(v)) return v; }
    return null;
  };
  const pool_vm = [];
  for (const l of pool){
    const mv = vendorMatched(l);
    if (mv) pool_vm.push({...l, matchedVendor: mv});
  }
  const c_vendor_match = pool_vm.length;

  // 5) real-change only（已在 ndx 中限定非零 hash）
  const pool_real = pool_vm;
  const c_real = pool_real.length;

  // 6) cooldown & caps（两类：email/vendor-company 的冷却；company 的跨日 window + 当日上限）
  const {mapEmail,mapCompany,mapVendorCompany} = loadOutreachHistory();
  const capCountToday = new Map(); // companyDomain -> count today

  const cooledReasons = {email:0, vendor_company:0, domain_window:0, domain_cap:0};
  const selected = [];
  for (const l of pool_real){
    // 6.1 email cooldown
    const lastE = mapEmail.get(lc(l.email)) || 0;
    if (lastE && daysSince(lastE) < EMAIL_COOLDOWN_DAYS) { cooledReasons.email++; continue; }

    // 6.2 vendor-company cooldown（用“匹配中的 vendor”而不是 vendor1 盲取）
    const keyVC = `${l.matchedVendor}|${l.domain}`;
    const lastVC = mapVendorCompany.get(keyVC) || 0;
    if (lastVC && daysSince(lastVC) < VENDOR_COMPANY_COOLDOWN_DAYS) { cooledReasons.vendor_company++; continue; }

    // 6.3 company domain window（跨日窗口限制）
    const lastC = mapCompany.get(l.domain) || 0;
    if (lastC && daysSince(lastC) < DOMAIN_WINDOW_DAYS) { cooledReasons.domain_window++; continue; }

    // 6.4 company 当日上限
    const sentToday = capCountToday.get(l.domain) || 0;
    if (sentToday >= DOMAIN_CAP) { cooledReasons.domain_cap++; continue; }

    // 通过
    capCountToday.set(l.domain, sentToday + 1);
    selected.push(l);
  }

  // limit & 结果集
  const finalLeads = selected.slice(0, LIMIT);
  let FINAL = finalLeads.length;

  // —— 旁路（仅救火）——
  if (FORCE_MIN_SEND > 0 && FINAL < FORCE_MIN_SEND){
    // 仅跳过抑制层，保留 status/mx/persona/region/vendor-match/real-change 的约束
    const fallbackPool = pool_real.slice(0, Math.max(FORCE_MIN_SEND, LIMIT));
    finalLeads.length = 0;
    for (const x of fallbackPool) finalLeads.push(x);
    FINAL = finalLeads.length = Math.min(fallbackPool.length, LIMIT);
  }

  // 统计
  const eligibility = {
    total: leads.length,
    "status+mx": c_status_mx,
    persona: c_persona,
    region: c_region,
    "vendor-match": c_vendor_match,
    "with-real-change": c_real,
    cooled: cooledReasons,
    "after-caps": selected.length,
    final: FINAL,
    window_h: TRIGGER_WINDOW_H,
    changed_vendors: changedVendors.size
  };
  console.log(`eligibility: ${JSON.stringify(eligibility)}`);

  // DRY：打印将要发送的三行预览
  const ym = new Date().toISOString().slice(0,7);
  const todayStr = today();
  if (DRY){
    for (const l of finalLeads){
      const v  = l.matchedVendor || l.vendor1 || '';
      const ev = latestEvidenceForVendor(v) || {};
      const link = PACK ? buildPackLink(v) : (ev.url || `${SITE_ORIGIN}/updates/?q=${encodeURIComponent(v)}`);
      const linkU = addUtm(link, `cp_${ym.replace('-','')}`);
      const subj = `[Evidence] ${v} changed ${ev.type||'Change'}-${(ev.hash||'').slice(0,8)} on ${ev.when||todayStr}`;
      console.log(`DRY SENT to ${l.email} subj="${subj}" link="${linkU}"`);
    }
    return;
  }

  // 真发
  const transport = makeTransport();
  const rows = [];
  for (const l of finalLeads){
    const v  = l.matchedVendor || l.vendor1 || '';
    const ev = latestEvidenceForVendor(v) || {};
    const link = PACK ? buildPackLink(v) : (ev.url || `${SITE_ORIGIN}/updates/?q=${encodeURIComponent(v)}`);
    const linkU = addUtm(link, `cp_${ym.replace('-','')}`);
    const subj = `[Evidence] ${v} changed ${ev.type||'Change'}-${(ev.hash||'').slice(0,8)} on ${ev.when||todayStr}`;
    const hi = pickNameFromEmail(l.email);
    const text =
`Hi ${hi},

We detected a verified change in your supplier ${v} (type: ${ev.type||'Change'}).
Evidence: ${linkU}

If helpful, enable alerts or buy Portfolio to receive monthly change packs.

— CG Alert`;

    const ok = await sendMail(transport, l.email, subj, text);
    rows.push([new Date().toISOString(), l.email, l.company, l.domain, v, 'TRIG', linkU, ok?'sent':'queued']);
  }
  appendCSV(OUT_CSV, ['when','email','company','domain','vendor','source','link','status'], rows);
}

function pickNameFromEmail(em){
  const a = (em.split('@')[0]||'').replace(/[._-]+/g,' ').trim();
  return a ? a[0].toUpperCase()+a.slice(1) : 'there';
}

(async () => {
  try { await main(); }
  catch (e) {
    console.error('send_triggered failed:', e && (e.stack || e.message || e));
    process.exit(1);
  }
})();
