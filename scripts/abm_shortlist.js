#!/usr/bin/env node
/**
 * ABM Shortlist (Top-N target accounts with real vendor changes)
 *
 * 目的：
 *  - 在近 window_h 小时内，找出“确有真实变更（非零 hash）”的 vendor 列表
 *  - 与 data/leads.csv 的 vendor1/2/3 交集，按“匹配数量 & 最近一次变更时间”给出 Top-N 账户清单
 *  - 输出 artifacts/abm_targets.csv（供销售/触发式或人工定投使用）
 *
 * 输入数据（均为本地文件，无第三方依赖）：
 *  - data/evidence.ndx     行格式（制表符）：when \t vendor_domain \t type \t hash \t ...
 *  - data/leads.csv        9 列，无表头：email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok
 *
 * 过滤规则（默认即可，必要时改 ENV）：
 *  - 只统计「非零 hash」且时间在 window_h 小时内的证据
 *  - leads: 排除 status ∈ {bounced, unsub, optout, invalid, bad-mx}；要求 mx_ok=1
 *  - persona 命中以下之一：security/trust/privacy/legal/procurement/sourcing/compliance/vendor/thirdparty/dpo/gdpr
 *
 * 排序与评分：
 *  - 主排序：matched_count（匹配上的 vendor 数量，降序）
 *  - 次排序：latest_change_ts（最近一次变更时间，降序）
 *
 * 输出（CSV）：
 *  rank,company,company_domain,contacts (≤3;分号分隔),matched_vendors (按最近时间降序),matched_count,latest_change_iso,primary_updates_link,primary_pack_link
 *
 * 运行：
 *  node scripts/abm_shortlist.js --window_h=168 --top=20
 *  环境变量：
 *   - SITE_ORIGIN（默认 https://www.cg-alert.com）
 *   - ABM_PERSONA_RE（可自定义 persona 过滤正则，如 "security|privacy|legal"）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const D = p => path.join(ROOT, 'data', p);
const ART = p => path.join(ROOT, 'artifacts', p);

const argv = parseArgs(process.argv.slice(2));
const WINDOW_H = num(argv.window_h, 168); // 近 7 天默认窗口
const TOP_N    = num(argv.top, 20);

const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const PERSONA_RE = new RegExp(
  process.env.ABM_PERSONA_RE || 'security|trust|privacy|legal|procurement|sourcing|compliance|vendor|thirdparty|dpo|gdpr',
  'i'
);

const BAD_STATUS = new Set(['bounced','unsub','optout','invalid','bad-mx']);

// --- helpers ---
function parseArgs(args){
  const out = {};
  for (const a of args){
    const m = a.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
function num(s, d){ const n = Number(s); return Number.isFinite(n) ? n : d; }
function readLines(fp){ if (!fs.existsSync(fp)) return []; return fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter(Boolean); }
function ensureDir(fp){ fs.mkdirSync(path.dirname(fp), { recursive: true }); }
function isNonZeroHash(h){ return !!h && !/^0+$/.test(h); }
function iso(d){ try{ return new Date(d).toISOString(); }catch{ return ''; } }
function byDesc(a,b){ return a>b?-1:a<b?1:0; }

// --- load changed vendors within window ---
function loadChangedVendors(windowHours){
  const ndx = readLines(D('evidence.ndx'));
  const cutoff = Date.now() - windowHours*3600*1000;
  /** map: vendor_domain -> { latestTs:number, items:number } */
  const M = new Map();
  for (const ln of ndx){
    // when \t vendor \t type \t hash \t ...
    const parts = ln.split('\t');
    if (parts.length < 4) continue;
    const when = Date.parse(parts[0] || '');
    const vendor = (parts[1] || '').trim().toLowerCase();
    const hash = (parts[3] || '').trim();
    if (!vendor || !isNonZeroHash(hash)) continue;
    if (!Number.isFinite(when) || when < cutoff) continue;
    const prev = M.get(vendor) || { latestTs: 0, items: 0 };
    const latestTs = Math.max(prev.latestTs, when);
    M.set(vendor, { latestTs, items: prev.items + 1 });
  }
  return M;
}

// --- load leads ---
function loadLeads(){
  const lines = readLines(D('leads.csv'));
  const rows = [];
  for (const ln of lines){
    const cols = splitCsv9(ln);
    if (!cols) continue;
    const [email, company, domain, v1, v2, v3, persona, status, mx_ok] = cols;
    rows.push({
      email: (email||'').trim(),
      company: (company||'').trim(),
      domain: (domain||'').trim().toLowerCase(),
      vendor1: (v1||'').trim().toLowerCase(),
      vendor2: (v2||'').trim().toLowerCase(),
      vendor3: (v3||'').trim().toLowerCase(),
      persona: (persona||'').trim(),
      status: (status||'').trim().toLowerCase(),
      mx_ok: (mx_ok||'').trim(),
    });
  }
  return rows;
}

// 简单 9 列 CSV 分割（无引号场景；若你后续引入逗号/引号，请换正式 CSV 解析）
function splitCsv9(line){
  // 容错：多余列合并到最后一个字段
  const parts = line.split(',');
  if (parts.length < 9) return null;
  const first8 = parts.slice(0,8);
  const last = parts.slice(8).join(',');
  return [...first8, last];
}

// --- main ---
function main(){
  const changed = loadChangedVendors(WINDOW_H); // Map<vendor,{latestTs,items}>
  const leads = loadLeads();

  // 账户聚合：key=company|domain
  /** Map<string, { company, domain, contacts:Set<string>, matched:Set<string>, latestTs:number }> */
  const agg = new Map();

  for (const ld of leads){
    // 过滤“不可触达”的行（短名单默认只留健康池）
    if (BAD_STATUS.has(ld.status)) continue;
    if (ld.mx_ok !== '1') continue;
    if (ld.persona && !PERSONA_RE.test(ld.persona)) continue;

    const vendors = [ld.vendor1, ld.vendor2, ld.vendor3].filter(Boolean);
    const matched = vendors.filter(v => changed.has(v));
    if (matched.length === 0) continue;

    const key = `${ld.company}|${ld.domain}`;
    const row = agg.get(key) || {
      company: ld.company || ld.domain || '(unknown)',
      domain: ld.domain || '',
      contacts: new Set(),
      matched: new Set(),
      latestTs: 0,
    };
    if (ld.email) row.contacts.add(ld.email.toLowerCase());
    for (const v of matched){
      row.matched.add(v);
      const ts = changed.get(v).latestTs;
      if (ts > row.latestTs) row.latestTs = ts;
    }
    agg.set(key, row);
  }

  // 评分/排序
  const arr = [...agg.values()].map(it => {
    const matchedVendors = [...it.matched].sort((a,b)=>{
      const ta = changed.get(a)?.latestTs || 0;
      const tb = changed.get(b)?.latestTs || 0;
      return byDesc(ta,tb);
    });
    return {
      company: it.company,
      domain: it.domain,
      contacts: [...it.contacts].slice(0,3), // 最多 3 个
      matchedVendors,
      matchedCount: matchedVendors.length,
      latestTs: it.latestTs,
    };
  });

  arr.sort((a,b)=>{
    if (a.matchedCount !== b.matchedCount) return b.matchedCount - a.matchedCount;
    return b.latestTs - a.latestTs;
  });

  const top = arr.slice(0, TOP_N);

  // 输出 CSV
  ensureDir(ART('abm_targets.csv'));
  const ym = yyyymm(new Date());
  const csvHeader = [
    'rank','company','company_domain','contacts','matched_vendors','matched_count',
    'latest_change_iso','primary_updates_link','primary_pack_link'
  ].join(',') + '\n';

  const csvRows = top.map((t, i) => {
    const primary = t.matchedVendors[0] || '';
    const updates = primary ? `${SITE_ORIGIN}/updates/?q=${encodeURIComponent(primary)}` : '';
    const pack = primary ? `${SITE_ORIGIN}/reports/${ym}/${primary}/` : '';
    return [
      i+1,
      csvSafe(t.company),
      csvSafe(t.domain),
      csvSafe(t.contacts.join(';')),
      csvSafe(t.matchedVendors.join(';')),
      t.matchedCount,
      csvSafe(iso(t.latestTs)),
      csvSafe(updates),
      csvSafe(pack),
    ].join(',');
  }).join('\n');

  fs.writeFileSync(ART('abm_targets.csv'), csvHeader + csvRows, 'utf8');

  // Step Summary & 控制台
  const sum = [];
  sum.push(`### ABM Shortlist`);
  sum.push(`- window_h: **${WINDOW_H}**`);
  sum.push(`- changed_vendors: **${changed.size}**`);
  sum.push(`- leads_scanned: **${leads.length}**`);
  sum.push(`- shortlisted: **${top.length}** / top=${TOP_N}`);
  if (top.length){
    sum.push(``);
    sum.push(`| # | Company | Domain | Contacts(≤3) | Matched Vendors | Matches | Latest Change |`);
    sum.push(`|---:|---|---|---|---|---:|---|`);
    for (let i=0;i<top.length;i++){
      const t = top[i];
      sum.push(`| ${i+1} | ${mdEsc(t.company)} | ${mdEsc(t.domain)} | ${mdEsc(t.contacts.join('; '))} | ${mdEsc(t.matchedVendors.join(', '))} | ${t.matchedCount} | ${iso(t.latestTs)} |`);
    }
  }
  console.log(sum.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY){
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, sum.join('\n')+'\n', 'utf8');
  }
}

// --- utils for formatting ---
function csvSafe(s){
  s = (s==null ? '' : String(s));
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}
function mdEsc(s){
  return String(s==null?'':s).replace(/\|/g,'\\|');
}
function yyyymm(d){
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth()+1).padStart(2,'0');
  return `${y}-${m}`;
}

main();
