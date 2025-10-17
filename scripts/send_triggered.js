#!/usr/bin/env node
// send_triggered.js — final
// - 兼容 evidence.ndx 两种行格式（date-first / vendor-first）
// - 画像容错（可放宽：RELAX_PERSONA=1）
// - DRY 模式输出 “DRY SENT …” 行，用于工作流计数
// - 真实发送输出 “SENT …” 行，并写入 data/sent_log.csv
// - 支持 30d 兜底 / 域与公司 cap / 简易冷却
// - 与现有 Outreach Triggered 工作流的 A→E 升级路径完全兼容

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

/* ------------------------------ Args ------------------------------ */
// 用 minimist 的 boolean/default，确保 --dry=false 解析成布尔 false（不会再被当成“真”）
const argv = minimist(process.argv.slice(2), {
  boolean: ['dry', 'fallback_30d', 'relax_persona', 'include_discovered'],
  default: {
    dry: true,
    limit: 12,
    window_h: 168,
  },
});

const toBool = (x) => {
  if (typeof x === 'boolean') return x;
  if (x === undefined || x === null) return false;
  const s = String(x).trim().toLowerCase();
  return !(s === '0' || s === 'false' || s === 'no' || s === '');
};
const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v));

/* ------------------------------ Env/Params ------------------------------ */
const SITE = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';

let DOMAIN_CAP  = num(process.env.DOMAIN_CAP  ?? argv.domain_cap, 1);
let DOMAIN_WINDOW_DAYS  = num(process.env.DOMAIN_WINDOW_DAYS  ?? argv.domain_window_d, 14);
let EMAIL_COOLDOWN_DAYS = num(process.env.EMAIL_COOLDOWN_DAYS ?? argv.email_cooldown_d, 14);
let VENDOR_COMPANY_COOLDOWN_DAYS = num(process.env.VENDOR_COMPANY_COOLDOWN_DAYS ?? argv.vendor_company_d, 14);

// 统一下限（兼容 COOLDOWN_DAYS）
const CD = num(process.env.COOLDOWN_DAYS ?? argv.cooldown_days, NaN);
if (!Number.isNaN(CD)) {
  DOMAIN_WINDOW_DAYS = Math.min(DOMAIN_WINDOW_DAYS, CD);
  EMAIL_COOLDOWN_DAYS = Math.min(EMAIL_COOLDOWN_DAYS, CD);
  VENDOR_COMPANY_COOLDOWN_DAYS = Math.min(VENDOR_COMPANY_COOLDOWN_DAYS, CD);
}

const SEND_LIMIT          = num(process.env.SEND_LIMIT ?? argv.limit, 12);
const TRIGGER_WINDOW_H    = num(process.env.TRIGGER_WINDOW_H ?? argv.window_h, 168);
const FORCE_MIN_SEND      = num(process.env.FORCE_MIN_SEND ?? argv.force_min_send, 0);
const FALLBACK_30D        = toBool(process.env.FALLBACK_30D ?? argv.fallback_30d);
const RELAX_PERSONA       = toBool(process.env.RELAX_PERSONA ?? argv.relax_persona);
const INCLUDE_DISCOVERED  = toBool(process.env.INCLUDE_DISCOVERED ?? argv.include_discovered);
const DRY                 = toBool(argv.dry);

/* ------------------------------ Utils ------------------------------ */
const isDate = (s) => /^\d{4}-\d{2}-\d{2}/.test(String(s||''));
const nonZeroHash = (h) => !!(h && !/^0+$/i.test(String(h||'')));

function readJsonSafe(p, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}

function normalizeVendor(v) {
  if (!v) return '';
  let s = String(v).trim().toLowerCase();
  if (s.startsWith('www.')) s = s.slice(4);
  return s;
}

const toArray = (x) => {
  if (Array.isArray(x)) return x;
  if (x == null) return [];
  if (typeof x === 'string') return x.split(',').map(s=>s.trim()).filter(Boolean);
  if (typeof x === 'object' && Array.isArray(x.allow)) return x.allow; // 兼容 {allow:[...]}
  return [];
};

/* ------------------------------ Data load ------------------------------ */
const ndxPath = 'data/evidence.ndx';
const ndxLines = fs.existsSync(ndxPath) ? fs.readFileSync(ndxPath, 'utf8').trim().split(/\r?\n/) : [];

const leadsLines = fs.existsSync('data/leads.csv')
  ? fs.readFileSync('data/leads.csv', 'utf8').split(/\r?\n/)
  : [];

// 别名池（提升 vendor 匹配率）
const aliasPoolPath = 'data/vendor_alias_pool.csv';
const aliasMap = new Map();
if (fs.existsSync(aliasPoolPath)) {
  for (const ln of fs.readFileSync(aliasPoolPath,'utf8').split(/\r?\n/)) {
    if(!ln || !ln.trim()) continue;
    const [alias, canonical] = ln.split(',').map(s => String(s||'').trim().toLowerCase());
    if (alias && canonical) aliasMap.set(alias, canonical);
  }
}
const mapAlias = (v) => aliasMap.get(normalizeVendor(v)) || normalizeVendor(v);

// 兼容两种 NDX 结构：date-first 与（旧）vendor-first
function parseNdxLine(ln){
  const t = ln.split('\t');
  if (t.length < 4) return null;
  if (isDate(t[0])) {
    const [date, slug, type, hash, rel, url, run_url] = t;
    return { slug: normalizeVendor(slug||''), ts: Date.parse(date), type, hash: hash||'', rel: rel||'', url: url||'', run_url: run_url||'' };
  } else {
    // 旧格式：vendor, date, _, hash, type, url
    const [vendor, date, , hash, type, url] = t;
    return { slug: normalizeVendor(vendor||''), ts: Date.parse(date), type, hash: hash||'', rel: '', url: url||'', run_url: url||'' };
  }
}

function loadEvidence(windowH){
  const now = Date.now();
  const cutoff = now - windowH*3600*1000;
  const out = new Map(); // slug -> latest record
  for (const ln of ndxLines){
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
  for (const ln of ndxLines){
    const r = parseNdxLine(ln); if(!r) continue;
    if (!Number.isFinite(r.ts)) continue;
    if (!nonZeroHash(r.hash)) continue;
    if (r.ts < cutoff) continue;
    const cur = out.get(r.slug);
    if (!cur || r.ts > cur.ts) out.set(r.slug, r);
  }
  return out;
}

function parseLeads(lines){
  const rows = [];
  for (const ln of lines){
    if(!ln || !ln.trim()) continue;
    const cols = ln.split(',');
    const [email,company,domain,v1,v2,v3,persona,status,mx_ok] = cols;
    // 跳过表头/无效行
    if (!/@/.test(String(email||''))) continue;
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

/* ------------------------------ Filters ------------------------------ */
function applyStatusMx(leads){
  return leads.filter(l =>
    l.mx_ok &&
    !['bounced','unsub','optout','bad-mx','invalid','complaint'].includes(l.status)
  );
}

function applyPersona(leads){
  if (RELAX_PERSONA) return leads;
  let allow = [];
  const rulesPath = process.env.PERSONA_RULES || 'config/persona_rules.json';
  if (fs.existsSync(rulesPath)) {
    const rules = readJsonSafe(rulesPath, {});
    allow = toArray(rules.allow_personas);
  }
  if (allow.length === 0) {
    allow = ["security","trust","privacy","legal","procurement","sourcing","vendor","thirdparty","third-party","compliance","risk","dpo","gdpr"];
  }
  return leads.filter(l => {
    const hay = String(l.persona||'').toLowerCase();
    return allow.some(k => hay.includes(String(k||'').toLowerCase()));
  });
}

function applyRegion(leads){
  const regionCfgPath = process.env.REGION_FILTER || 'config/region_filter.json';
  if (!fs.existsSync(regionCfgPath)) return leads; // 默认不过滤
  const cfg = readJsonSafe(regionCfgPath, {});
  const allow = toArray(cfg.allow_regions);
  if (allow.length === 0) return leads;
  return leads.filter(l => {
    const dom = l.domain || '';
    return allow.some(code => dom.endsWith(`.${String(code).toLowerCase()}`));
  });
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

// 极简限流（company/domain 维度）；冷却窗口由上游工作流控制
function applyCooldownAndCap(cands){
  const counter = new Map();
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
  const allLeads = parseLeads(leadsLines);
  const total = allLeads.length;

  const pool1 = applyStatusMx(allLeads);
  const afterStatusMx = pool1.length;

  const pool2 = applyPersona(pool1);
  const afterPersona = pool2.length;

  const pool3 = applyRegion(pool2);
  const afterRegion = pool3.length;

  // Stage 1：按 TRIGGER_WINDOW_H
  const evMap = loadEvidence(TRIGGER_WINDOW_H);
  const changedVendors = evMap.size;

  const vendorMatched = intersectVendors(pool3, evMap);
  const vendorMatchCount = vendorMatched.length;

  // 抑制前候选（用于 FORCE_MIN_SEND）
  const preSuppress = vendorMatched.slice();

  // Cap
  let candidates = applyCooldownAndCap(vendorMatched);

  // FORCE_MIN_SEND：仍基于“真实变更”，不跨 30 天
  if (FORCE_MIN_SEND > 0 && candidates.length < FORCE_MIN_SEND){
    candidates = preSuppress.slice(0, FORCE_MIN_SEND);
  }

  // 显式开启 + <8：启用 30d 兜底（并去重 email|vendor）
  if (FALLBACK_30D && candidates.length < 8){
    const ev30 = loadEvidenceLast30d();
    const vm30 = intersectVendors(pool3, ev30);
    const merged = [...candidates, ...vm30];
    const seen = new Set(), dedup=[];
    for (const x of merged){
      const k = `${x.email}|${x.hitVendor||''}`;
      if (seen.has(k)) continue; seen.add(k); dedup.push(x);
    }
    candidates = applyCooldownAndCap(dedup);
    if (candidates.length < 8) candidates = dedup.slice(0, 8);
  }

  // 限额
  const take = candidates.slice(0, SEND_LIMIT);

  // 可观测性
  const elig = {
    total,
    "status+mx": afterStatusMx,
    persona: afterPersona,
    region: afterRegion,
    changed_vendors: changedVendors,
    "vendor-match": vendorMatchCount,
    final: take.length,
    window_h: TRIGGER_WINDOW_H
  };
  console.log('eligibility: ' + JSON.stringify(elig));

  /* ------------------------------ DRY ------------------------------ */
  const renderLine = (prefix, c) => {
    const ev = c.ev || {};
    const ym = new Date(ev.ts || Date.now()).toISOString().slice(0,7);
    const when = ev.ts ? new Date(ev.ts).toISOString().slice(0,10) : '';
    const title = ev.rel || ev.type || 'Update';
    const link = `${SITE}/reports/${ym}/${c.hitVendor}/`;
    const subj = when
      ? `[Evidence] ${c.hitVendor} changed ${title} on ${when}`
      : `[Evidence] Recent updates for ${c.hitVendor}`;
    return { line: `${prefix} to ${c.email} subj="${subj}" link="${link}"`, subj, link };
  };

  if (DRY){
    for (const c of take){
      const { line } = renderLine('DRY SENT', c);
      console.log(line);
    }
    console.log(JSON.stringify({final: take.length}));
    return;
  }

  /* ------------------------------ REAL SEND ------------------------------ */
  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT||587),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  let sent = 0;
  for (const c of take){
    const { line, subj, link } = renderLine('SENT', c);
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
      // 打印供工作流 grep '^SENT ' 统计
      console.log(line);
      // 写入 sent_log.csv（供 daily_ops/fullchain 统计 sent_today）
      await fs.promises.appendFile(
        'data/sent_log.csv',
        `${new Date().toISOString()},${c.email},${c.company||''},${c.hitVendor||''}\n`
      );
      sent++;
    }catch(e){
      // 单封失败不阻断整体流程
      console.error('SEND_FAIL', c.email, e && e.message ? e.message : String(e));
    }
  }
  console.log(JSON.stringify({final: sent}));
})();
