#!/usr/bin/env node
/**
 * send_triggered.js — 覆盖版（稳态）
 * 目标：
 * - 支持 dry / limit / pack / TRIGGER_WINDOW_H
 * - 支持 env/CLI 覆盖：DOMAIN_CAP / DOMAIN_WINDOW_DAYS / EMAIL_COOLDOWN_DAYS / VENDOR_COMPANY_COOLDOWN_DAYS
 *   以及别名：--domain_cap, --domain_window_d, --email_cooldown_d, --vendor_company_d
 *   且兼容误写：COOLDOWN_DAYS（一次性同时下调三个 cooldown）
 * - 过滤：status+mx → persona → region → vendor-match（近窗真实变更）→ cooldown & caps
 * - 输出 eligibility JSON；dry 模式打印 DRY SENT；非 dry 追加 data/outreach_log.csv
 * - 邮件正文使用三行模板（最简），链接自动加 utm
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

let nodemailer = null;
try { nodemailer = require('nodemailer'); } catch(e){ /* optional */ }

const argv = require('minimist')(process.argv.slice(2));
const DRY = !!(argv.dry === true || String(argv.dry||'').toLowerCase()==='true');
const LIMIT = Number(argv.limit ?? 12);
const PACK = !!(argv.pack === true || String(argv.pack||'').toLowerCase()==='true');

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const TRIGGER_WINDOW_H = Number(process.env.TRIGGER_WINDOW_H || argv.window_h || 168);

// caps / cooldown（支持 env、CLI、以及历史误写 COOLDOWN_DAYS）
let DOMAIN_CAP = num(process.env.DOMAIN_CAP ?? argv.domain_cap, 1);
let DOMAIN_WINDOW_DAYS = num(process.env.DOMAIN_WINDOW_DAYS ?? argv.domain_window_d, 14);
let EMAIL_COOLDOWN_DAYS = num(process.env.EMAIL_COOLDOWN_DAYS ?? argv.email_cooldown_d, 14);
let VENDOR_COMPANY_COOLDOWN_DAYS = num(process.env.VENDOR_COMPANY_COOLDOWN_DAYS ?? argv.vendor_company_d, 14);
const CD_ALIAS = toNum(process.env.COOLDOWN_DAYS ?? argv.cooldown_days);
if (CD_ALIAS !== null) {
  DOMAIN_WINDOW_DAYS = Math.min(DOMAIN_WINDOW_DAYS, CD_ALIAS);
  EMAIL_COOLDOWN_DAYS = Math.min(EMAIL_COOLDOWN_DAYS, CD_ALIAS);
  VENDOR_COMPANY_COOLDOWN_DAYS = Math.min(VENDOR_COMPANY_COOLDOWN_DAYS, CD_ALIAS);
}

const MAIL_FROM = process.env.MAIL_FROM || '';
const BCC_TO = process.env.BCC_TO || '';

const PERSONA_RULES = process.env.PERSONA_RULES || 'config/persona_rules.json';
const REGION_FILTER = process.env.REGION_FILTER || 'config/region_filter.json';

const ROOT = path.join(__dirname, '..');
const LEADS_CSV = path.join(ROOT, 'data', 'leads.csv');
const OUT_CSV = path.join(ROOT, 'data', 'outreach_log.csv');
const EVIDENCE_NDX = path.join(ROOT, 'data', 'evidence.ndx');
const EVID_DIR = path.join(ROOT, 'evidence');

function num(v, d){ const n = Number(v); return isFinite(n) ? n : d; }
function toNum(v){ if(v===undefined || v===null || v==='') return null; const n=Number(v); return isFinite(n)?n:null; }
function today(){ return new Date().toISOString().slice(0,10); }
function dsub(d, days){ return new Date(d.getTime() - days*24*3600*1000); }
function parseISO(s){ const t = Date.parse(s); return isNaN(t)?null:new Date(t); }
function lc(s){ return String(s||'').toLowerCase(); }
function includesAny(hay, allow){
  const s = String(hay||'').toLowerCase();
  return (allow||[]).some(k => s.includes(String(k||'').toLowerCase()));
}
function readJSON(fp){ try { return JSON.parse(fs.readFileSync(fp,'utf8')); }catch(e){ return null; } }
function exists(fp){ try{ fs.accessSync(fp); return true; }catch(e){ return false; } }

function readCSVRows(fp){
  if(!exists(fp)) return [];
  // 简单 CSV（无引号），仓库格式约定 9 列，无表头
  const txt = fs.readFileSync(fp,'utf8').trim();
  if (!txt) return [];
  return txt.split(/\r?\n/).map(l=>l.replace(/\t/g,',').trim()).filter(Boolean).map(l=>l.split(','));
}

function appendCSV(fp, header, rows){
  const has = exists(fp) && fs.statSync(fp).size>0;
  const out = [];
  if (!has && header) out.push(header.join(','));
  for(const r of rows) out.push(r.map(x=>String(x??'').replace(/[\r\n,]+/g,' ')).join(','));
  fs.mkdirSync(path.dirname(fp), {recursive:true});
  fs.appendFileSync(fp, (has?os.EOL:'') + out.join(os.EOL));
}

function loadPersonaAllow(){
  if(!exists(PERSONA_RULES)) return null;
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
  if(!exists(REGION_FILTER)) return null;
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

function loadChangedVendors(windowH){
  const res = new Set();
  if (!exists(EVIDENCE_NDX)) return res;
  const cutoff = Date.now() - windowH*3600*1000;
  const lines = fs.readFileSync(EVIDENCE_NDX,'utf8').split(/\r?\n/);
  for(const ln of lines){
    if(!ln.trim()) continue;
    // 预期：ts \t domain \t type \t hash \t url ...
    const cols = ln.split('\t');
    if (cols.length<4) continue;
    const ts = Date.parse(cols[0]); if (isNaN(ts) || ts<cutoff) continue;
    const domain = (cols[1]||'').toLowerCase();
    const hash = cols[3]||'';
    if (!hash || /^0+$/.test(hash)) continue; // 非零hash才算真实变更
    if (domain) res.add(domain);
  }
  return res;
}

function latestEvidenceForVendor(vendor){
  // 找 evidence/<vendor> 下最新一条（按文件名日期）
  const dir = path.join(EVID_DIR, vendor);
  if (!exists(dir)) return null;
  const files = fs.readdirSync(dir).filter(f=>/^\d{4}-\d{2}-\d{2}-/.test(f) && f.endsWith('.json')).sort().reverse();
  for(const f of files){
    if (f.includes('00000000')) continue; // 跳过基线
    const m = f.match(/^(\d{4}-\d{2}-\d{2})-([A-Za-z]+)-([0-9a-fA-F]+)\.json$/);
    const when = m? m[1] : f.slice(0,10);
    const typ  = m? m[2] : 'Change';
    const hash = m? m[3] : '';
    let url = `${SITE_ORIGIN}/updates/?q=${encodeURIComponent(vendor)}`;
    try{
      const j = readJSON(path.join(EVID_DIR, vendor, f));
      if (j && (j.url || j.link || j.URL)) url = j.url || j.link || j.URL;
    }catch{}
    return {when, type:typ, hash, url, file:f};
  }
  return null;
}

function buildPackLink(vendor){
  const ym = new Date().toISOString().slice(0,7);
  return `${SITE_ORIGIN}/reports/${ym}/${vendor}/`;
}

function addUtm(u, campaign='cp_'+new Date().toISOString().slice(0,7).replace('-','')){
  const url = new URL(u, SITE_ORIGIN);
  url.searchParams.set('utm_source','email');
  url.searchParams.set('utm_medium','triggered');
  url.searchParams.set('utm_campaign', campaign);
  return url.toString();
}

function loadOutreachHistory(){
  const mapEmail = new Map();
  const mapCompany = new Map(); // domain -> [ts...]
  const mapVendorCompany = new Map(); // vendor|company -> ts
  if(!exists(OUT_CSV)) return {mapEmail,mapCompany,mapVendorCompany};
  const txt = fs.readFileSync(OUT_CSV,'utf8').split(/\r?\n/).filter(Boolean);
  let start = 0;
  if (txt[0] && /when|status/i.test(txt[0])) start = 1;
  for(let i=start;i<txt.length;i++){
    const cols = txt[i].split(',');
    const when = parseISO(cols[0]); if(!when) continue;
    const email = lc(cols[1]);
    const domain = lc(cols[3]||'');
    const vendor = lc(cols[4]||'');
    const keyVC = vendor+'|'+domain;
    const t = when.getTime();
    mapEmail.set(email, Math.max(mapEmail.get(email)||0, t));
    mapCompany.set(domain, Math.max(mapCompany.get(domain)||0, t));
    mapVendorCompany.set(keyVC, Math.max(mapVendorCompany.get(keyVC)||0, t));
  }
  return {mapEmail,mapCompany,mapVendorCompany};
}

function daysBetween(ts){ return (Date.now()-ts)/86400000; }

function pickNameFromEmail(em){
  const a = (em.split('@')[0]||'').replace(/[._-]+/g,' ').trim();
  return a ? a[0].toUpperCase()+a.slice(1) : 'there';
}

function makeTransport(){
  if (!nodemailer) return null;
  const host=process.env.SMTP_HOST, port=Number(process.env.SMTP_PORT||587);
  const user=process.env.SMTP_USER, pass=process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({host, port, secure:port===465, auth:{user, pass}});
}

function sendMail(transport, to, subj, text){
  if (!transport) return Promise.resolve(false);
  const opt = {from: MAIL_FROM, to, subject: subj, text};
  if (BCC_TO) opt.bcc = BCC_TO;
  return transport.sendMail(opt).then(()=>true).catch(()=>false);
}

// ------------------- MAIN -------------------
(function main(){
  // 0) 装载基础数据
  const leads = readCSVRows(LEADS_CSV).map(cols=>{
    // email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok
    return {
      email: cols[0]||'',
      company: cols[1]||'',
      domain: lc(cols[2]||''),
      vendor1: lc(cols[3]||''),
      vendor2: lc(cols[4]||''),
      vendor3: lc(cols[5]||''),
      persona: lc(cols[6]||''),
      status: lc(cols[7]||''),
      mx_ok: Number(cols[8]||'0')===1
    };
  });

  const personaAllow = loadPersonaAllow();
  const regionCfg = loadRegionFilter();
  const changedVendors = loadChangedVendors(TRIGGER_WINDOW_H);

  // 1) 过滤：status+mx
  let pool = leads.filter(l=>{
    if (!l.email || !l.mx_ok) return false;
    if (['unsub','optout','bounced','invalid','bad-mx'].includes(l.status)) return false;
    return true;
  });
  const c_status_mx = pool.length;

  // 2) persona
  pool = pool.filter(l=> personaAllowed(l.persona, personaAllow));
  const c_persona = pool.length;

  // 3) region
  pool = pool.filter(l=> inRegion(l.email, l.domain, regionCfg));
  const c_region = pool.length;

  // 4) vendor-match（与“近窗真实变更的供应商域”相等）
  const matchVendor = (l)=>{
    return [l.vendor1,l.vendor2,l.vendor3].some(v => v && changedVendors.has(v));
  };
  const pool_vm = pool.filter(matchVendor);
  const c_vendor_match = pool_vm.length;

  // 5) real-change only（vendor-match 已经基于非零hash，等价）
  const pool_real = pool_vm;
  const c_real = pool_real.length;

  // 6) cooldown & caps
  const {mapEmail,mapCompany,mapVendorCompany} = loadOutreachHistory();
  const todayStr = today();
  const capCountByCompanyToday = new Map(); // company -> count today

  const windowCompanyTs = Date.parse(todayStr+'T00:00:00Z'); // 当日窗口

  const cooled = [];
  const selected = [];
  for(const l of pool_real){
    // email cooldown
    const lastE = mapEmail.get(lc(l.email))||0;
    if (lastE && daysBetween(lastE) < EMAIL_COOLDOWN_DAYS) { cooled.push(l); continue; }
    // vendor-company cooldown
    const keyVC = (l.vendor1||l.vendor2||l.vendor3)+'|'+l.domain;
    const lastVC = mapVendorCompany.get(keyVC)||0;
    if (lastVC && daysBetween(lastVC) < VENDOR_COMPANY_COOLDOWN_DAYS) { cooled.push(l); continue; }
    // domain window cap
    const lastC = mapCompany.get(l.domain)||0;
    const daysSinceCompany = lastC ? daysBetween(lastC) : 999;
    // 公司当日上限：看今天已挑选多少
    const sentTodayCompany = capCountByCompanyToday.get(l.domain)||0;
    if (sentTodayCompany >= DOMAIN_CAP) { cooled.push(l); continue; }

    // 通过
    capCountByCompanyToday.set(l.domain, sentTodayCompany+1);
    selected.push(l);
  }
  const c_after_caps = selected.length;

  // limit
  const finalLeads = selected.slice(0, LIMIT);
  const FINAL = finalLeads.length;

  // 统计
  const eligibility = {
    total: leads.length,
    "status+mx": c_status_mx,
    persona: c_persona,
    region: c_region,
    "vendor-match": c_vendor_match,
    "with-real-change": c_real,
    "after-caps": c_after_caps,
    final: FINAL,
    window_h: TRIGGER_WINDOW_H,
    changed_vendors: changedVendors.size
  };
  console.log(`eligibility: ${JSON.stringify(eligibility)}`);

  // DRY 模式展示
  const ym = new Date().toISOString().slice(0,7);
  if (DRY){
    for(const l of finalLeads){
      const vendor = [l.vendor1,l.vendor2,l.vendor3].find(v=> changedVendors.has(v)) || l.vendor1 || '';
      const ev = latestEvidenceForVendor(vendor) || {};
      const link = PACK ? buildPackLink(vendor) : (ev.url || `${SITE_ORIGIN}/updates/?q=${encodeURIComponent(vendor)}`);
      const linkU = addUtm(link, `cp_${ym.replace('-','')}`);
      const subj = `[Evidence] ${vendor} changed ${ev.type||'Change'}-${(ev.hash||'').slice(0,8)} on ${ev.when||todayStr}`;
      console.log(`DRY SENT to ${l.email} subj="${subj}" link="${linkU}"`);
    }
    return;
  }

  // 真发（可选 SMTP；失败也记日志）
  const transport = makeTransport();
  const rows = [];
  for(const l of finalLeads){
    const vendor = [l.vendor1,l.vendor2,l.vendor3].find(v=> changedVendors.has(v)) || l.vendor1 || '';
    const ev = latestEvidenceForVendor(vendor) || {};
    const link = PACK ? buildPackLink(vendor) : (ev.url || `${SITE_ORIGIN}/updates/?q=${encodeURIComponent(vendor)}`);
    const linkU = addUtm(link, `cp_${ym.replace('-','')}`);
    const subj = `[Evidence] ${vendor} changed ${ev.type||'Change'}-${(ev.hash||'').slice(0,8)} on ${ev.when||todayStr}`;
    const hi = pickNameFromEmail(l.email);
    const text =
`Hi ${hi},

We detected a verified change in your supplier **${vendor}** (type: ${ev.type||'Change'}).
Evidence: ${linkU}

If you want, enable alerts or buy Portfolio to receive monthly change packs.

— CG Alert`;

    let ok = false;
    try { ok = awaitMaybe(sendMail(transport, l.email, subj, text)); } catch(e){ ok=false; }
    rows.push([new Date().toISOString(), l.email, l.company, l.domain, vendor, 'TRIG', linkU, ok?'sent':'queued']);
  }
  appendCSV(OUT_CSV,
    ['when','email','company','domain','vendor','source','link','status'],
    rows
  );

})();

function awaitMaybe(p){
  if (!p || typeof p.then!=='function') return Promise.resolve(false);
  return p;
}
