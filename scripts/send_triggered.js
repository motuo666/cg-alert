#!/usr/bin/env node
/**
 * send_triggered.js
 * 只在“最近 TRIGGER_WINDOW_H 小时内”有真实变更的 vendor 才发；
 * 且按变更类型（pricing/tos/dpa/subprocessors/status）动态选择主题与正文。
 * CSV 固定 9 列：[email,company,domain,v1,v2,v3,persona,status,mx_ok]
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;

const ROOT = path.join(__dirname, '..');
const CSV  = path.join(ROOT, 'data', 'leads.csv');
const EVI  = path.join(ROOT, 'evidence');
const DRY  = process.env.DRY_RUN === '1';

const WINDOW_H = Number(process.env.TRIGGER_WINDOW_H || 48);
const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK || process.env.SLACK_WEBHOOK_URL || '';

let nodemailer = null;
if (!DRY) {
  try { nodemailer = require('nodemailer'); }
  catch { console.error('Missing nodemailer'); process.exit(1); }
}

const SMTP_HOST = process.env.SMTP_HOST || '';
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER;
const BCC_TO    = process.env.BCC_TO || '';

function postSlack(text){ if(!SLACK_WEBHOOK) return Promise.resolve();
  return fetch(SLACK_WEBHOOK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}).catch(()=>{});
}

function read9(fp){
  if(!fs.existsSync(fp)) return [];
  const raw = fs.readFileSync(fp,'utf8').trim();
  if(!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean).map(line=>{
    if (/^email,company,domain/i.test(line)) return null;
    const v = line.split(',').map(x=>String(x||'').trim());
    const c = v.slice(0,9); while(c.length<9) c.push('');
    return c;
  }).filter(Boolean);
}
function write9(fp, rows){
  const out = rows.map(r => r.slice(0,9).map(x => String(x??'')).join(',')).join('\n');
  fs.writeFileSync(fp, out + (rows.length? '\n' : ''), 'utf8');
}
async function hasMX(domain){ try{ const mx=await dns.resolveMx(domain); return !!(mx&&mx.length);}catch{ return false; } }

function hnum(s){ return crypto.createHash('sha1').update(String(s)).digest()[0]; }

// —— 取“最近 48h”的 vendor→变更项 —— //
function freshChanges(hours){
  const since = Date.now() - hours*3600*1000;
  const map = new Map(); // slug -> [{type,url,title,snippet,date}]
  if (!fs.existsSync(EVI)) return map;
  for (const d of fs.readdirSync(EVI,{withFileTypes:true})) {
    if (!d.isDirectory()) continue;
    const slug = d.name;
    if (!slug || slug==='acme' || slug.startsWith('_')) continue;
    const dir = path.join(EVI, slug);
    for (const f of fs.readdirSync(dir)) {
      if (!/\.json$/i.test(f)) continue;
      const fp = path.join(dir, f);
      const st = fs.statSync(fp);
      if (st.mtimeMs < since) continue;
      let raw; try{ raw=JSON.parse(fs.readFileSync(fp,'utf8')); }catch{ continue; }
      const dateISO = f.replace('.json','')+'T00:00:00Z';
      const arr = Array.isArray(raw)? raw : [raw];
      for (const x of arr) {
        const type = String((x.type||'other')).toLowerCase();
        const url  = x.url || '';
        const title= x.title || '';
        const snip = x.message || x.summary || x.snippet || '';
        const item = { type, url, title, snippet: snip, date: dateISO.slice(0,10) };
        if (!map.has(slug)) map.set(slug, []);
        map.get(slug).push(item);
      }
    }
  }
  // 每 vendor 只保留最近的前若干条
  for (const [k,v] of map) map.set(k, v.sort((a,b)=>a.date<b.date?1:-1).slice(0,3));
  return map;
}

// —— 示例链接（优先 /vendors/slug/，否则 /updates/） —— //
function listVendorSlugsForPage() {
  const vd = path.join(ROOT, 'vendors');
  const out = [];
  try{
    if (fs.existsSync(vd)) {
      for (const d of fs.readdirSync(vd,{withFileTypes:true})) {
        if (d.isDirectory()) {
          const slug = d.name;
          if (slug && slug!=='acme' && !slug.startsWith('_')) {
            const idx = path.join(vd, slug, 'index.html');
            if (fs.existsSync(idx) && fs.statSync(idx).size>100) out.push(slug);
          }
        }
      }
    }
  }catch{}
  return out;
}
function vendorUrl(slug){
  const SITE = 'https://www.cg-alert.com';
  const slugs = listVendorSlugsForPage();
  if (slugs.includes(slug)) return `${SITE}/vendors/${encodeURIComponent(slug)}/?utm=triggered`;
  return `${SITE}/updates/?utm=triggered`;
}

// —— 类型模板 —— //
function subjectByType(slug, type){
  switch(type){
    case 'pricing':        return `${slug} pricing changed — quick heads-up`;
    case 'tos':            return `${slug} Terms updated — audit-safe evidence`;
    case 'dpa':            return `${slug} DPA updated — compliance alert`;
    case 'subprocessors':  return `${slug} subprocessor list changed`;
    case 'status':         return `${slug} status/incident notice`;
    default:               return `${slug} public change detected`;
  }
}
function bodyByType(slug, type, date, srcUrl){
  const link1 = vendorUrl(slug);
  const link2 = srcUrl || link1;
  const lines = {
    pricing:       `We detected a pricing page change on ${slug} (${date}).\n\nEvidence page: ${link1}\nSource: ${link2}`,
    tos:           `We detected a Terms of Service update on ${slug} (${date}).\n\nEvidence page: ${link1}\nSource: ${link2}`,
    dpa:           `We detected a Data Processing Addendum update on ${slug} (${date}).\n\nEvidence page: ${link1}\nSource: ${link2}`,
    subprocessors: `We detected a subprocessor list change on ${slug} (${date}).\n\nEvidence page: ${link1}\nSource: ${link2}`,
    status:        `We recorded a status/incident notice on ${slug} (${date}).\n\nEvidence page: ${link1}\nSource: ${link2}`,
    other:         `We detected a public page change on ${slug} (${date}).\n\nEvidence page: ${link1}\nSource: ${link2}`
  };
  return `${lines[type] || lines.other}\n\nRefund: 30 days if no material alert.\nIf not relevant, reply STOP.`;
}

function wrap78(s=''){ return s.split('\n').map(line=>{
  if(line.length<=78) return line; const out=[]; let rest=line;
  while(rest.length>78){ out.push(rest.slice(0,78)); rest=rest.slice(78); }
  out.push(rest); return out.join('\n');
}).join('\n'); }

(async function main(){
  const rows = read9(CSV);
  if (!rows.length) { console.log('leads.csv empty'); process.exit(0); }

  const changes = freshChanges(WINDOW_H); // slug -> items[]
  const hotVendors = new Set(Array.from(changes.keys()));
  if (!hotVendors.size) {
    console.log(`no fresh evidence in ${WINDOW_H}h → skip`);
    process.exit(0);
  }

  let transporter = null;
  if (!DRY) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: Number(SMTP_PORT)===465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
      pool: true, maxConnections: 2, maxMessages: 50, rateDelta: 60000, rateLimit: 120
    });
    await transporter.verify();
  }

  const LIMIT = Number((process.argv.join(' ').match(/--limit=(\d+)/)||[])[1] || 40);
  let sent = 0;

  for (let i=0;i<rows.length;i++){
    if (sent >= LIMIT) break;
    const [email,company,domain,v1,v2,v3,,status,mxok] = rows[i];
    if (!email || (status||'').toLowerCase()!=='new' || String(mxok)!=='1') continue;

    const vendors = [v1,v2,v3].map(s=>String(s||'').trim()).filter(Boolean);
    const match = vendors.find(v => hotVendors.has(v));
    if (!match) continue;

    const ev = (changes.get(match)||[])[0] || { type:'other', date:new Date().toISOString().slice(0,10), url:'' };
    const subj = subjectByType(match, ev.type);
    const text = wrap78(bodyByType(match, ev.type, ev.date, ev.url));

    // MX 预检（非 DRY）
    if (!DRY) {
      const dom = (email.split('@')[1]||'').toLowerCase();
      if (!(await hasMX(dom))) continue;
    }

    try{
      if (!DRY){
        await transporter.sendMail({
          from: { name:'CG Alert', address: MAIL_FROM },
          to: email,
          subject: subj,
          text,
          headers:{
            'List-Unsubscribe':'<mailto:optout@cg-alert.com?subject=unsubscribe>',
            'Auto-Submitted':'auto-generated'
          },
          ...(BCC_TO ? { bcc: BCC_TO } : {})
        });
        await new Promise(r=>setTimeout(r, 1200 + Math.random()*800));
      } else {
        console.log(`[DRY] ${email} <- "${subj}"`);
      }
      rows[i][7] = 'sent'; // 仅改 status 列
      sent++;
    }catch(e){
      console.error('send error:', e && (e.response || e.message || e));
      continue;
    }
  }

  write9(CSV, rows);
  console.log(`triggered send complete: sent=${sent}, window=${WINDOW_H}h, vendors=${hotVendors.size}`);
  if (sent>0) postSlack(`📤 Triggered S1 sent: ${sent} lead(s) within ${WINDOW_H}h evidence window.`);
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
