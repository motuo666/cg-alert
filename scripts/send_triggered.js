#!/usr/bin/env node
// send_triggered.js — final (NDX date-first/vendor-first 兼容 + 30d fallback)

const fs = require('fs');
const path = require('path');
const argv = require('minimist')(process.argv.slice(2));
const num = (v, d) => (v===undefined || v===null || v==='') ? d : Number(v);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s||'').slice(0,10));
const nonZeroHash = h => !!(h && !/^0+$/i.test(String(h)));

function includesAny(hay, allow){
  const s = String(hay||'').toLowerCase();
  return (allow||[]).some(k => s.includes(String(k||'').toLowerCase()));
}

// 覆盖参数（默认：1/14/14/14）
let DOMAIN_CAP  = num(process.env.DOMAIN_CAP  ?? argv.domain_cap, 1);
let DOMAIN_WINDOW_DAYS  = num(process.env.DOMAIN_WINDOW_DAYS  ?? argv.domain_window_d, 14);
let EMAIL_COOLDOWN_DAYS = num(process.env.EMAIL_COOLDOWN_DAYS ?? argv.email_cooldown_d, 14);
let VENDOR_COMPANY_COOLDOWN_DAYS = num(process.env.VENDOR_COMPANY_COOLDOWN_DAYS ?? argv.vendor_company_d, 14);

// 统一下限（兼容 COOLDOWN_DAYS）
const CD = num(process.env.COOLDOWN_DAYS ?? argv.cooldown_days, null);
if (CD !== null) {
  DOMAIN_WINDOW_DAYS = Math.min(DOMAIN_WINDOW_DAYS, CD);
  EMAIL_COOLDOWN_DAYS = Math.min(EMAIL_COOLDOWN_DAYS, CD);
  VENDOR_COMPANY_COOLDOWN_DAYS = Math.min(VENDOR_COMPANY_COOLDOWN_DAYS, CD);
}

// 旁路 / 窗口 / 兜底
const FORCE_MIN_SEND = num(process.env.FORCE_MIN_SEND ?? argv.force_min_send, 0);
const TRIGGER_WINDOW_H = num(process.env.TRIGGER_WINDOW_H ?? argv.window_h, 168);
const FALLBACK_30D = !!(process.env.FALLBACK_30D ?? argv.fallback_30d);

// 数据装载
const ndxPath = 'data/evidence.ndx';
const leadsCsv = fs.existsSync('data/leads.csv') ? fs.readFileSync('data/leads.csv','utf8').split(/\r?\n/) : [];
const ndx = fs.existsSync(ndxPath) ? fs.readFileSync(ndxPath,'utf8').trim().split(/\r?\n/) : [];

function parseLeads(lines){
  const rows = [];
  for (const ln of lines){
    if(!ln || !ln.trim()) continue;
    const [email,company,domain,v1,v2,v3,persona,status,mx_ok] = ln.split(',');
    rows.push({email,company,domain,vendors:[v1,v2,v3].filter(Boolean), persona:(persona||'').toLowerCase(), status:(status||'new'), mx_ok:(mx_ok==='1')});
  }
  return rows;
}

// 兼容两种 NDX 结构：date-first 与（过时的）vendor-first
function parseNdxLine(ln){
  const t = ln.split('\t');
  if (t.length < 4) return null;
  if (isDate(t[0])) {
    const [date, slug, type, hash, rel, url, run_url] = t;
    return {slug: String(slug||'').trim(), ts: Date.parse(date), type, hash: hash||'', rel: rel||'', url: url||'', run_url: run_url||''};
  } else {
    // 旧格式：vendor, date, _, hash, type, url
    const [vendor, date, _, hash, type, url] = t;
    return {slug: String(vendor||'').trim(), ts: Date.parse(date), type, hash: hash||'', rel: '', url: url||'', run_url: url||''};
  }
}

function loadEvidence(windowH){
  const now = Date.now();
  const cutoff = now - windowH*3600*1000;
  const out = new Map(); // slug -> latest
  for (const ln of ndx){
    const r = parseNdxLine(ln); if(!r) continue;
    if (!Number.isFinite(r.ts)) continue;
    if (!nonZeroHash(r.hash)) continue;
    if (r.ts < cutoff) continue;
    const cur = out.get(r.slug);
    if (!cur || r.ts > cur.ts) out.set(r.slug, r);
  }
  return out;
}
function loadEvidenceLast30d(){
  const now = Date.now();
  const cutoff = now - 30*24*3600*1000;
  const out = new Map();
  for (const ln of ndx){
    const r = parseNdxLine(ln); if(!r) continue;
    if (!Number.isFinite(r.ts)) continue;
    if (!nonZeroHash(r.hash)) continue;
    if (r.ts < cutoff) continue;
    const cur = out.get(r.slug);
    if (!cur || r.ts > cur.ts) out.set(r.slug, r);
  }
  return out;
}

function applyStatusMx(leads){
  return leads.filter(l => l.mx_ok && !['bounced','unsub','optout','bad-mx','invalid'].includes(l.status));
}
function applyPersona(leads){
  const allow = (process.env.PERSONA_RULES && fs.existsSync(process.env.PERSONA_RULES))
    ? JSON.parse(fs.readFileSync(process.env.PERSONA_RULES,'utf8'))
    : ["security","trust","privacy","legal","procurement","sourcing","vendor","thirdparty","compliance","risk","dpo","gdpr"];
  return leads.filter(l => includesAny(l.persona, allow));
}
function applyRegion(leads){ return leads; }

function intersectVendors(leads, evMap){
  const evVendors = new Set(evMap.keys());
  const out=[];
  for (const l of leads){
    const hit = l.vendors.find(v => v && evVendors.has(v));
    if (hit){
      const ev = evMap.get(hit);
      out.push({...l, hitVendor: hit, ev});
    }
  }
  return out;
}

function applyCooldownAndCap(cands){
  const counter = new Map(); // by domain/company
  const out=[];
  for (const c of cands){
    const key = (c.domain||c.company||'').toLowerCase();
    const cnt = counter.get(key)||0;
    if (cnt >= DOMAIN_CAP) continue;
    counter.set(key, cnt+1);
    out.push(c);
  }
  return out;
}

(async function main(){
  const allLeads = parseLeads(leadsCsv);
  let pool = applyStatusMx(allLeads);
  pool = applyPersona(pool);
  pool = applyRegion(pool);

  // Stage 1：按 TRIGGER_WINDOW_H
  let evMap = loadEvidence(TRIGGER_WINDOW_H);
  let vendorMatched = intersectVendors(pool, evMap);
  const preSuppress = vendorMatched.slice();

  // 抑制
  let candidates = applyCooldownAndCap(vendorMatched);

  // 强制最小发送（救火）
  if (FORCE_MIN_SEND > 0 && candidates.length < FORCE_MIN_SEND){
    candidates = preSuppress.slice(0, FORCE_MIN_SEND);
  }

  // 30 天兜底（仅在显式开启且仍<8时）
  if (FALLBACK_30D && candidates.length < 8){
    const ev30 = loadEvidenceLast30d();
    const vm30 = intersectVendors(pool, ev30);
    const merged = [...candidates, ...vm30];
    // 去重（email|vendor）
    const seen = new Set(); const dedup=[];
    for (const x of merged){
      const k = `${x.email}|${x.hitVendor||''}`;
      if (seen.has(k)) continue; seen.add(k); dedup.push(x);
    }
    candidates = applyCooldownAndCap(dedup);
    if (candidates.length < 8) candidates = dedup.slice(0, 8);
  }

  // DRY 输出
  const limit = Math.min(candidates.length, Number(argv.limit||12));
  if (argv.dry){
    console.log(JSON.stringify({final: limit}));
    return;
  }

  // 真发（nodemailer 最小实现）
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT||587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
  const take = candidates.slice(0, limit);

  function reportLink(slug, ev){
    const ym = new Date(ev?.ts||Date.now()).toISOString().slice(0,7);
    return `${SITE}/reports/${ym}/${slug}/`;
  }

  let sent = 0;
  for (const c of take){
    const ev = c.ev || {};
    const link = reportLink(c.hitVendor, ev);
    const when = ev.ts ? new Date(ev.ts).toISOString().slice(0,10) : null;
    const subj = when
      ? `[Evidence] ${c.hitVendor} changed ${ev.type || 'Update'} on ${when}`
      : `[Evidence] Recent updates for ${c.hitVendor}`;
    const body = [
      `Hi ${c.company||''} team,`,
      `We detected a public change from ${c.hitVendor}. Evidence (verifiable): ${link}`,
      `If you want alerts with proof packs: ${SITE}/updates/?q=${encodeURIComponent(c.hitVendor)}`
    ].join('\n');

    try{
      await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to: c.email,
        bcc: process.env.BCC_TO || undefined,
        subject: subj,
        text: body
      });
      sent++;
    }catch(e){ /* 单封失败不阻断 */ }
  }
  console.log(JSON.stringify({final: sent}));
})();
