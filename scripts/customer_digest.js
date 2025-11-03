// scripts/customer_digest.js
/**
 * Send email digest to customers based on cadence (daily/weekly).
 * customers.csv: email,company,tier,cadence,vendors   (vendors: comma separated domains)
 */
const fs = require('fs'); const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const nodemailer = require('nodemailer');

const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const FROM = process.env.MAIL_FROM || 'CG Alert <ops@cg-alert.com>';
const REPLY_TO = process.env.REPLY_TO || 'Jason <ops@cg-alert.com>';

function readCSV(file){
  const txt = fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n').trim();
  if(!txt) return [];
  const [head, ...rows] = txt.split('\n').filter(Boolean);
  const cols = head.split(',').map(s=>s.trim());
  return rows.map(r => { const vals=r.split(','); const o={}; cols.forEach((c,i)=>o[c]=vals[i]||''); return o; });
}
function rssItems(){
  const xml = fs.readFileSync('reports/rss.xml','utf8');
  const p = new XMLParser({ignoreAttributes:false, attributeNamePrefix:'@_'});
  const doc = p.parse(xml); const items = doc?.rss?.channel?.item || [];
  return Array.isArray(items) ? items : [items];
}
function filterByVendors(items, vendors){
  if(!vendors || vendors.length===0) return items.slice(-10);
  const doms = vendors.map(v=>String(v).toLowerCase().trim()).filter(Boolean);
  return items.filter(it => {
    const src = String(it['cg:sourceUrl']||'').toLowerCase();
    return doms.some(d => src.includes(d));
  }).slice(-10);
}
function weekday(){
  return new Date().getDay(); // 0 Sun, 1 Mon ...
}
function due(cadence){
  if(cadence==='daily') return true;
  if(cadence==='weekly') return weekday()===1; // Monday
  return false;
}
function htmlFor(company, list){
  const rows = list.map(it => `<li><b>${it.title||''}</b><br/><small>${it['cg:sourceUrl']||''} · ${it['cg:sha256']||''}</small></li>`).join('');
  return `<p>${company} — your latest evidence:</p><ul>${rows}</ul><p>Use the copyable language in each card to push back at renewal.</p>`;
}

(async function main(){
  if(!fs.existsSync('customers.csv')){ console.log('no customers.csv'); return; }
  const cust = readCSV('customers.csv');
  const items = rssItems();
  const transport = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: SMTP_PORT===465, auth: {user: SMTP_USER, pass: SMTP_PASS} });
  let sent=0;
  for(const c of cust){
    if(!due((c.cadence||'').toLowerCase())) continue;
    const vendors = (c.vendors||'').split(/[ ,;]+/).filter(Boolean);
    const list = filterByVendors(items, vendors);
    if(list.length===0) continue;
    const html = htmlFor(c.company||'Your account', list);
    await transport.sendMail({ from: FROM, to: c.email, subject: 'Your CG Alert evidence digest', html, replyTo: REPLY_TO });
    sent++;
  }
  const mdir='data/metrics'; fs.mkdirSync(mdir,{recursive:true});
  require('fs').appendFileSync(`${mdir}/events.log`, `${new Date().toISOString()},customer_digest,sent=${sent}\n`);
  console.log('customer digest sent:', sent);
})();