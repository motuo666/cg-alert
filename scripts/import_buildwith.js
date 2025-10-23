// scripts/import_buildwith.js
// 功能：读取 data/*.csv|json 批量导入到 Worker /import（或 /import/buildwith）
// 特性：分批(默认100)、双路径兜底、跳过无关文件、健壮CSV解析、轻量去重、自动重试、详细日志

'use strict';

const fs = require('fs');
const path = require('path');
const fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));

const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, ''); // e.g. https://lead-gateway.xxx.workers.dev
const OBS_KEY    = process.env.OBS_KEY || '';
const IMPORT_KEY = process.env.IMPORT_KEY || ''; // 可选；若提供则优先用 x-import-key
if (!WORKER_URL || !OBS_KEY && !IMPORT_KEY) {
  console.error('❌ Missing WORKER_URL or OBS_KEY/IMPORT_KEY');
  process.exit(1);
}

// ------- 参数 -------
const MAX_BATCH = parseInt(process.env.MAX_BATCH || '100', 10); // 每批最多100，稳过Workers限制
const DATA_DIR  = path.join(process.cwd(), 'data');
const SKIP_FILES = new Set([
  'sent_log.csv',     // 外发历史，不作为导入线索
  'bounces.csv',      // 退信清单
  'complaints.csv'    // 投诉清单
]);

// ------- 小工具 -------
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function isEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s||'')); }

// 简单的CSV解析（支持双引号包裹和转义的逗号/双引号）
function parseCSV(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  // 去除全空行
  const filtered = lines.filter(ln => ln && ln.trim() !== '');
  if (!filtered.length) return [];

  // 逐行解析
  function splitCSVLine(line) {
    const out = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"'; i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === ',' && !inQuotes) {
        out.push(cur);
        cur = '';
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  const header = splitCSVLine(filtered.shift()).map(s => s.trim().toLowerCase());
  const idx = k => header.indexOf(k);

  // 兼容 tech/techs/company/company_name 等字段名
  const colEmail   = idx('email');
  const colDomain  = idx('domain');
  const colCompany = idx('company') !== -1 ? idx('company') : idx('company_name');
  const colTech    = idx('tech') !== -1 ? idx('tech') : idx('techs');

  const out = [];
  for (const ln of filtered) {
    const cols = splitCSVLine(ln);
    const email   = (cols[colEmail]   || '').trim().toLowerCase();
    const domain  = (cols[colDomain]  || '').trim().toLowerCase();
    const company = (cols[colCompany] || '').trim();
    const techRaw = (cols[colTech]    || '').trim();
    const tech = techRaw ? techRaw.split(/;|,/).map(s => s.trim()).filter(Boolean) : [];
    if (email) out.push({ email, domain, company, tech });
  }
  return out;
}

function listDataFiles() {
  if (!fs.existsSync(DATA_DIR)) return [];
  const files = fs.readdirSync(DATA_DIR).filter(f => /\.(csv|json)$/i.test(f));
  return files.map(f => ({ name: f, full: path.join(DATA_DIR, f) }));
}

function normalizeItems(items) {
  // 轻量清洗 + 字段兼容
  return (items || []).map(x => {
    const email   = String(x.email || '').trim().toLowerCase();
    const domain  = String(x.domain || x.host || '').trim().toLowerCase();
    const company = String(x.company || x.company_name || '').trim();
    const techs   = Array.isArray(x.tech) ? x.tech
                   : Array.isArray(x.techs) ? x.techs
                   : (x.tech ? String(x.tech).split(/;|,/).map(s=>s.trim()) : []);
    return { email, domain, company, tech: techs.filter(Boolean) };
  }).filter(r => !!r.email);
}

// 单批次发送（带自动重试 + 双端点兜底）
async function sendBatch(items) {
  const endpoints = [`${WORKER_URL}/import`, `${WORKER_URL}/import/buildwith`];
  const headers = {
    'content-type': 'application/json',
    ...(IMPORT_KEY ? { 'x-import-key': IMPORT_KEY } : { 'x-obs-key': OBS_KEY })
  };
  const body = JSON.stringify(items);

  const maxRetries = 3;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    for (const url of endpoints) {
      let res, txt;
      try {
        res = await fetch(url, { method: 'POST', headers, body });
        txt = await res.text();
      } catch (e) {
        if (attempt === maxRetries) throw new Error(`IMPORT_FAIL neterr: ${e.message}`);
        await delay(400 * (attempt + 1));
        continue;
      }

      // 404：试下一个端点
      if (res.status === 404) {
        continue;
      }
      // 429/5xx：指数退避重试
      if ((res.status === 429 || (res.status >= 500 && res.status <= 599)) && attempt < maxRetries) {
        await delay(600 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        throw new Error(`IMPORT_FAIL ${res.status}: ${txt}`);
      }
      try {
        return JSON.parse(txt || '{}');
      } catch {
        throw new Error(`IMPORT_FAIL bad_json: ${txt?.slice(0, 200)}`);
      }
    }
    // 所有端点都 404 或临时失败，重试
    await delay(400 * (attempt + 1));
  }
  throw new Error('IMPORT_FAIL endpoints not available');
}

(async () => {
  const files = listDataFiles();
  if (!files.length) { console.log('No data files.'); return; }

  let totalImported = 0, totalSkipped = 0, totalInvalid = 0, totalDup = 0;
  const seen = new Set(); // 全局去重（按 email）

  for (const f of files) {
    if (SKIP_FILES.has(f.name)) {
      console.log(`Skip ${f.name} (by rule)`);
      continue;
    }

    const raw = fs.readFileSync(f.full, 'utf-8');
    let items = [];

    if (/\.json$/i.test(f.name)) {
      let j = {};
      try { j = JSON.parse(raw); } catch (e) {
        console.log(`File ${f.name} -> JSON parse error: ${e.message}`);
        continue;
      }
      items = Array.isArray(j) ? j : (Array.isArray(j.items) ? j.items : []);
    } else {
      items = parseCSV(raw);
    }

    items = normalizeItems(items);

    // 过滤非法邮箱 + 全局去重
    const before = items.length;
    items = items.filter(r => {
      if (!isEmail(r.email)) { totalInvalid++; return false; }
      if (seen.has(r.email)) { totalDup++; return false; }
      seen.add(r.email);
      return true;
    });

    console.log(`File ${f.name} -> ${before} rows, valid after filter: ${items.length}, invalid:${before - items.length > 0 ? (before - items.length) : 0}`);

    if (!items.length) continue;

    // 分批发送
    for (const part of chunk(items, MAX_BATCH)) {
      const r = await sendBatch(part);
      const imp = r.imported || 0;
      const skp = r.skipped  || 0;
      totalImported += imp;
      totalSkipped  += skp;
      console.log(`  batch imported:${imp} skipped:${skp} (size:${part.length})`);
    }
  }

  console.log(`\nImport done. ✅`);
  console.log(`Summary -> imported:${totalImported} skipped:${totalSkipped} invalid:${totalInvalid} dup:${totalDup}`);
})().catch(e => { console.error(e); process.exit(1); });
