#!/usr/bin/env node
// send_triggered.js — final（兼容 NDX 两种格式 / 画像容错 / DRY 输出“DRY SENT …”行 / 30d 兜底）

const fs = require('fs');
const path = require('path');
const argv = require('minimist')(process.argv.slice(2));

/* ------------------------------ Helpers ------------------------------ */
const num = (v, d) => (v===undefined || v===null || v==='') ? d : Number(v);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s||'').slice(0,10));
const nonZeroHash = h => !!(h && !/^0+$/i.test(String(h||'')));

const toArray = (x) => {
  if (Array.isArray(x)) return x;
  if (x == null) return [];
  if (typeof x === 'string') return x.split(',').map(s=>s.trim()).filter(Boolean);
  if (typeof x === 'object' && Array.isArray(x.allow)) return x.allow; // 容错 {allow:[...]}
  return [];
};

function readJsonSafe(p, fallback = {}) {
  try {
    const raw = fs.readFileSync(p, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function normalizeVendor(v){
  if(!v) return '';
  let s = String(v).trim().toLowerCase();
  if (s.startsWith('www.')) s = s.slice(4);
  return s;
}

/* ------------------------------ Params ------------------------------ */
// 覆盖参数（默认：cap=1 / 窗口=14/14/14天）
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
const RELAX_PERSONA = !!(process.env.RELAX_PERSONA ?? argv.relax_persona);
const INCLUDE_DISCOVERED = !!(process.env.INCLUDE_DISCOVERED ?? argv.include_discovered);

// 站点
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';

/* ------------------------------ Data load ------------------------------ */
const ndxPath = 'data/evidence.ndx';
const leadsCsv = fs.existsSync('data/leads.csv') ? fs.readFileSync('data/leads.csv','utf8').split(/\r?\n/) : [];
const ndx = fs.existsSync(ndxPath) ? fs.readFileSync(ndxPath,'utf8').trim().split(/\r?\n/) : [];

// 可选：别名池提升匹配率
const aliasPoolPath = 'data/vendor_alias_pool.csv';
const aliasMap = new Map();
if (fs.existsSync(aliasPoolPath)) {
  for (const ln of fs.readFileSync(aliasPoolPath,'utf8').split(/\r?\n/)) {
    if(!ln || !ln.trim()) continue;
    const [alias, canonical] = ln.split(',').map(x=>String(x||'').trim().toLowerCase());
    if(alias && canonical) aliasMap.set(alias, canonical);
  }
}

function mapAlias(v){
  const s = normalizeVendor(v);
  return aliasMap.get(s) || aliasMap.get(s.replace(/^www\./,'')) || s;
}

function parseLeads(lines){
  const rows = [];
  for (const ln of lines){
    if(!ln || !ln.trim()) continue;
    const cols = ln.split(',');
    // 期望 9 列：email,company,domain,v1,v2,v3,persona,status,mx_ok
    const [email,company,domain,v1,v2,v3,persona,status,mx_ok] = cols;
    rows.push({
      email: (email||'').trim(),
      company: (company||'').trim(),
      domain: normalizeVendor(domain||''),
      vendors: [v1,v2,v3].filter(Boolean).map(mapAlias).filter(Boolean),
      persona: String(persona||'').toLowerCase(),
      status: (status||'new').toLowerCase(),
      mx_ok: (String(mx_ok||'1')==='1')
    });
  }
  return rows;
}

// 兼容两种 NDX 结构：date-first 与（过时的）vendor-first
function parseNdxLine(ln){
  const t = ln.split('\t');
  if (t.length < 4) return null;
  if (isDate(t[0])) {
    const [date, slug, type, hash, rel, url, run_url] = t;
    return {slug: normalizeVendor(slug||''), ts: Date.parse(date), type, hash: hash||'', rel: rel||'', url: url||'', run_url: run_url||''};
  } else {
    // 旧格式：vendor, date, _, hash, type, url
    const [vendor, date, _, hash, type, url] = t;
    return {slug: normalizeVendor(vendor||''), ts: Date.parse(date), type, hash: hash||'', rel: '', url: url||'', run_url: url||''};
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

/* ------------------------------ Filters ------------------------------ */
function applyStatusMx(leads){
  return leads.filter(l => l.mx_ok && !['bounced','unsub','optout','bad-mx','invalid','complaint'].includes(l.status));
}

function applyPersona(leads){
  if (RELAX_PERSONA) return leads;
  let allow = [];
  const rulesPath = process.env.PERSONA_RULES || 'config/persona_rules.json';
  if (fs.existsSync(rulesPath)) {
    const rules = readJsonSafe(rulesPath, {});
    allow = toArray(rules.allow_personas);
  }
  // 默认关键字（宽松）
  if (allow.length === 0) {
    allow = ["security","trust","privacy","legal","procurement","sourcing","vendor","thirdparty","third-party","compliance","risk","dpo","gdpr"];
  }
  return leads.filter(l => {
    const hay = String(l.persona||'').toLowerCase();
    return allow.some(k => hay.includes(String(k||'').toLowerCase()));
  });
}

function applyRegion(leads){
  // 预留：目前不做区域过滤（避免误杀）
  return leads;
}

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

// 极简 cap（只按 company/domain 限流；冷却策略在上游工作流控制）
function applyCooldownAndCap(cands){
  const counter = new Map(); // by domain/company
  const out=[];
  for (const c of cands){
    const key = (c.domain || c.company || '').toLowerCase();
    const cnt = counter.get(key)||0;
    if (cnt >= DOMAIN_CAP) continue;
    counter.set(key, cnt+1);
    out.push(c);
  }
  return out;
}

/* ------------------------------ Main ------------------------------ */
(async function main(){
  const allLeads = parseLeads(leadsCsv);
  const total = allLeads.length;

  let pool1 = applyStatusMx(allLeads);
  const afterStatusMx = pool1.length;

  let pool2 = applyPersona(pool1);
  const afterPersona = pool2.length;

  let pool3 = applyRegion(pool2);
  const afterRegion = pool3.length;

  // Stage 1：按 TRIGGER_WINDOW_H
  const evMap = loadEvidence(TRIGGER_WINDOW_H);
  const changedVendors = evMap.size;

  let vendorMatched = intersectVendors(pool3, evMap);
  const vendorMatchCount = vendorMatched.length;

  // 记住抑制前的候选（用于 FORCE_MIN_SEND 兜底）
  const preSuppress = vendorMatched.slice();

  // Cap（极简）
  let candidates = applyCooldownAndCap(vendorMatched);

  // FORCE_MIN_SEND：救火（仍基于真实变更，不跨 30 天）
  if (FORCE_MIN_SEND > 0 && candidates.length < FORCE_MIN_SEND){
    candidates = preSuppress.slice(0, FORCE_MIN_SEND);
  }

  // 显式开启且仍 < 8：30d 兜底
  if (FALLBACK_30D && candidates.length < 8){
    const ev30 = loadEvidenceLast30d();
    const vm30 = intersectVendors(pool3, ev30);
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

  // 限额
  const want = num(argv.limit, 12);
  const take = candidates.slice(0, want);

  // 可观测性：eligibility 概览
  const elig = {
    total,
    "status+mx": afterStatusMx,
    persona: afterPersona,
    region: afterRegion,
    "changed_vendors": changedVendors,
    "vendor-match": vendorMatchCount,
    final: take.length,
    window_h: TRIGGER_WINDOW_H
  };
  console.log('eligibility: ' + JSON.stringify(elig));

  // DRY：按行输出“DRY SENT …”，供工作流用 awk 计数
  if (argv.dry){
    for (const c of take){
      const ev = c.ev || {};
      const ym = new Date(ev.ts || Date.now()).toISOString().slice(0,7);
      const when = ev.ts ? new Date(ev.ts).toISOString().slice(0,10) : '';
      const link = `${SITE}/reports/${ym}/${c.hitVendor}/`;
      const subj = when
        ? `[Evidence] ${c.hitVendor} changed ${ev.type || 'Update'} on ${when}`
        : `[Evidence] Recent updates for ${c.hitVendor}`;
      console.log(`DRY SENT to ${c.email} subj="${subj}" link="${link}"`);
    }
    // 同时给一份 JSON 汇总，方便手动阅读
    console.log(JSON.stringify({final: take.length}));
    return;
  }

  // 真发（使用 nodemailer）
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT||587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  let sent = 0;
  for (const c of take){
    const ev = c.ev || {};
    const ym = new Date(ev.ts || Date.now()).toISOString().slice(0,7);
    const when = ev.ts ? new Date(ev.ts).toISOString().slice(0,10) : '';
    const link = `${SITE}/reports/${ym}/${c.hitVendor}/`;
    const subj = when
      ? `[Evidence] ${c.hitVendor} changed ${ev.type || 'Update'} on ${when}`
      : `[Evidence] Recent updates for ${c.hitVendor}`;
    const body = [
      `Hi ${c.company||''} team,`,
      `We detected a public change from ${c.hitVendor}.`,
      `Evidence (verifiable): ${link}`,
      ``,
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
    }catch(e){
      // 单封失败不阻断整体流程
    }
  }
  console.log(JSON.stringify({final: sent}));
})();
