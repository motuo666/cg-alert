
// === injected: events-based digest cursor logic ===
import fs from 'node:fs';
import path from 'node:path';

function readJSON(p, def=null){ try { return JSON.parse(fs.readFileSync(p,'utf8')); } catch { return def; } }
function writeJSON(p, obj){ fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, JSON.stringify(obj,null,2)); }

function loadEvents(){
  const p = path.join(process.cwd(), 'data', 'events.json');
  const data = readJSON(p, null);
  if (data && Array.isArray(data.items)) return data.items;
  return null;
}
function loadState(){
  const p = path.join(process.cwd(), 'data', 'digest_state.json');
  return [p, readJSON(p, {"daily":{"last_observed_at":""},"weekly":{"last_observed_at":""}})];
}
function saveState(p, state){
  try { writeJSON(p, state); } catch {}
}
function iso(a){ return new Date(a || 0).toISOString(); }
function maxIso(a,b){ return (a && a > b) ? a : b; }

export async function selectDigestItems(mode){
  const ev = loadEvents();
  if (!ev) return null; // fall back to legacy RSS flow in existing code
  const [statePath, state] = loadState();
  const last = (state[mode] && state[mode].last_observed_at) ? state[mode].last_observed_at : "";
  const now = new Date();
  // compute window
  const start = new Date(now);
  if (mode === 'daily') { start.setUTCDate(now.getUTCDate()-1); }
  else if (mode === 'weekly') { 
    // last Monday 00:00 UTC
    const day = now.getUTCDay(); // 0..6 (Sun..Sat)
    const diff = (day === 0 ? 6 : day-1); // days since Monday
    start.setUTCDate(now.getUTCDate()-diff-7);
    start.setUTCHours(0,0,0,0);
  }
  const startIso = start.toISOString();
  const items = ev.filter(x => x.observed_at && x.observed_at > (last || startIso))
                  .sort((a,b)=>String(a.observed_at).localeCompare(String(b.observed_at)));
  const newLast = items.reduce((acc,x)=>maxIso(x.observed_at, acc), last);
  return { items, statePath, state, newLast };
}

// scripts/customer_digest.js (brand tone + x个证据 summary)
const fs = require('fs'); const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM || 'CG Alert <ops@cg-alert.com>';
const REPLY_TO = process.env.REPLY_TO || 'Jason <ops@cg-alert.com>';
const LIMIT = parseInt(process.env.DIGEST_LIMIT || '10', 10);
const DIGEST_MODE = (process.env.DIGEST_MODE || 'daily').toLowerCase();

// ---- ENTITLEMENT RULES (auto-injected) ----
const RULE = {
  portfolio:  { vendors: 25, cadence: ["weekly"],          channels: 1 },
  business:   { vendors: 50, cadence: ["daily","weekly"],  channels: 2 },
  enterprise: { vendors: 200, cadence: ["daily","weekly"], channels: 2 },
};
function normalizeEntitlement(c){
  const plan = (c.plan||"portfolio").toLowerCase();
  const R = RULE[plan] || RULE.portfolio;
  let cadence = (c.cadence || (plan==="business"?"daily":"weekly")).toLowerCase();
  if (!R.cadence.includes(cadence)) cadence = R.cadence[0];
  let vendors = (c.vendors||"").split(/[ ,;]+/).filter(Boolean).slice(0, R.vendors);
  return { plan, cadence, vendors, R };
}
// ---- ENTITLEMENT RULES END ----


function readCSV(file){
  const txt = fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').trim();
  if(!txt) return [];
  const [head, ...rows] = txt.split('\n').filter(Boolean);
  const cols = head.split(',').map(s=>s.trim());
  return rows.map(r => { const vals=r.split(','); const o={}; cols.forEach((c,i)=>o[c]=vals[i]||''); return o; });
}
function scoreSeverity(it){
  const text = (String(it.title||'') + ' ' + String(it.description||'')).toLowerCase();
  const high = [
    "data breach","breach","security incident","security update",
    "data processing","data protection","dpa",
    "sub-processor","subprocessor","sub processor",
    "personal data","pii","suspend","termination","terminate",
    "liability","indemn","uptime","sla","service level"
  ];
  const medium = [
    "price","pricing","fee","fees","charge","billing",
    "renew","renewal","term","commitment",
    "cookie","tracking","analytics"
  ];
  const low = [
    "typo","spelling","copy","cosmetic","example","demo"
  ];
  if (high.some(k => text.includes(k))) return "high";
  if (medium.some(k => text.includes(k))) return "medium";
  if (low.some(k => text.includes(k))) return "low";
  return "medium";
}

function rssItems(){
  const rssPath = 'reports/rss/index.xml';
  if (!fs.existsSync(rssPath)) {
    console.log('[digest] no reports/rss/index.xml yet; skipping digest items');
    return [];
  }
  const xml = fs.readFileSync(rssPath,'utf8');
  const p = new XMLParser({ignoreAttributes:false, attributeNamePrefix:'@_'});
  const doc = p.parse(xml); const items = doc?.rss?.channel?.item || [];
  const arr = Array.isArray(items)?items:[items];
  const clean = arr.filter(Boolean);
  for(const it of clean){
    it._severity = scoreSeverity(it);
  }
  return clean;
}
function filterByVendors(items, vendors){
  if(!vendors || vendors.length===0) return items.slice(-LIMIT);
  const doms = vendors.map(v=>String(v).toLowerCase().trim()).filter(Boolean);
  return items.filter(it => {
    const src = String(it['cg:sourceUrl']||'').toLowerCase();
    return doms.some(d => src.includes(d));
  }).slice(-LIMIT);
}
function groupByVendor(items){
  const map = new Map();
  for(const it of items){
    const src = String(it['cg:sourceUrl']||'');
    const host = (()=>{ try { return new URL(src).host; } catch { return 'vendor'; } })();
    if(!map.has(host)) map.set(host, []);
    map.get(host).push(it);
  }
  // sort each vendor bucket: high → medium → low → others, then newest first
  const sevRank = (s)=>{
    if (s === "high") return 0;
    if (s === "medium") return 1;
    if (s === "low") return 2;
    return 3;
  };
  for(const [host, arr] of map.entries()){
    arr.sort((a,b)=>{
      const sa = sevRank(a._severity);
      const sb = sevRank(b._severity);
      if(sa !== sb) return sa - sb;
      const da = new Date(a.pubDate || a['pubDate'] || 0);
      const db = new Date(b.pubDate || b['pubDate'] || 0);
      return db - da;
    });
  }
  return map;
}
function htmlFor(company, list){
  const total = list.length;
  const g = groupByVendor(list);
  let blocks = '';
  for(const [host, arr] of g.entries()){
    const lis = arr.map(it => {
      const sev = it._severity || 'medium';
      const badge = sev === 'high' ? '⚠️ 高风险' : (sev === 'medium' ? '中风险' : '低风险');
      return `<li>${badge} ${it.title||''}<br/><small>${it['cg:sourceUrl']||''} · ${it['cg:sha256']||''}</small></li>`;
    }).join('');
    blocks += `<h4 style="margin:12px 0 6px">${host}</h4><ul>${lis}</ul>`;
  }
  return `<p style="margin:0 0 8px"><b>${company}</b>，这是你最近的证据更新：<b>${total} 个证据</b>（可核验：URL / 时间戳 / SHA256）。</p>${blocks}<p style="margin-top:12px">需要“续约对话可直接粘贴”的措辞包？直接回复邮箱即可。</p>`;
}

(async function main(){
  if(!fs.existsSync('customers.csv')){ console.log('no customers.csv'); return; }
  const cust = readCSV('customers.csv');
  const items = rssItems();
  const transport = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT===465, auth: {user: SMTP_USER, pass: SMTP_PASS} });
  let sent=0;
  const today = new Date();
  const dow = today.getDay(); // 1 = Monday
  for (const c of cust){
    const E = normalizeEntitlement(c);
    const cadence = E.cadence;
    const vendors = E.vendors;
    const listAll = filterByVendors(items, vendors);
    if (listAll.length === 0) continue;
    const hasHigh = listAll.some(it => it._severity === 'high');

    let shouldSend = false;
    let effectiveList = listAll;
    let isPriorityOverride = false;

    if (DIGEST_MODE === 'weekly') {
      // Weekly digest: only weekly cadence, only on Monday
      if (cadence !== 'weekly') continue;
      if (dow !== 1) continue;
      shouldSend = true;
    } else {
      // Daily mode: daily plans always, weekly plans only when there is high-severity change (except Monday)
      if (cadence === 'daily') {
        shouldSend = true;
      } else if (cadence === 'weekly') {
        if (hasHigh && dow !== 1) {
          effectiveList = listAll.filter(it => it._severity === 'high');
          shouldSend = true;
          isPriorityOverride = true;
        } else {
          // no high-severity today; weekly customer waits for weekly digest
          continue;
        }
      } else {
        // Fallback: treat unknown cadence as weekly with priority override
        if (hasHigh && dow !== 1) {
          effectiveList = listAll.filter(it => it._severity === 'high');
          shouldSend = true;
          isPriorityOverride = true;
        } else if (dow === 1) {
          shouldSend = true;
        } else {
          continue;
        }
      }
    }

    if (!shouldSend || effectiveList.length === 0) continue;

    const html = htmlFor(c.company||'Your account', effectiveList);
    const planLabel = E.plan === 'enterprise' ? 'Enterprise' : (E.plan === 'business' ? 'Business' : 'Portfolio');
    const subject = isPriorityOverride
      ? `CG Alert — ${planLabel} · 高优先级变更（${effectiveList.length} 条）`
      : `CG Alert — ${planLabel} · 你有 ${effectiveList.length} 个新证据`;
    await transport.sendMail({ from: FROM, to: c.email, subject, html, replyTo: REPLY_TO });
    sent++;
  }
  const mdir='data/metrics'; fs.mkdirSync(mdir,{recursive:true});
  require('fs').appendFileSync(`${mdir}/events.log`, `${new Date().toISOString()},customer_digest,sent=${sent}\n`);
  console.log('customer digest sent:', sent);
})();
