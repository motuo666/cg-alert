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
  const xml = fs.readFileSync('reports/rss/index.xml','utf8');
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
  for(const c of cust){
    const E = normalizeEntitlement(c); const cadence = E.cadence;
    if(cadence==='weekly' && new Date().getDay()!==1) continue; // Monday
    // daily: always due
    const vendors = E.vendors;
    const list = filterByVendors(items, vendors);
    if(list.length===0) continue;
    const html = htmlFor(c.company||'Your account', list);
    const planLabel = E.plan === 'enterprise' ? 'Enterprise' : (E.plan === 'business' ? 'Business' : 'Portfolio');
    const subject = `CG Alert — ${planLabel} · 你有 ${list.length} 个新证据`;
    await transport.sendMail({ from: FROM, to: c.email, subject, html, replyTo: REPLY_TO });
    sent++;
  }
  const mdir='data/metrics'; fs.mkdirSync(mdir,{recursive:true});
  require('fs').appendFileSync(`${mdir}/events.log`, `${new Date().toISOString()},customer_digest,sent=${sent}\n`);
  console.log('customer digest sent:', sent);
})();