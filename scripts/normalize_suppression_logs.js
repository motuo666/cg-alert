#!/usr/bin/env node
/**
 * normalize_suppression_logs.js  —— 退订 / 退信 / 投诉 的标准化脚本（覆盖版）
 *
 * 目标（一次到位、幂等）：
 * 1) 统一三张表结构（CSV，带表头）：
 *    - data/unsubscribes.csv : when,email,source
 *    - data/bounces.csv      : when,email,code,detail
 *    - data/complaints.csv   : when,email,source
 * 2) 兼容历史老格式（无表头 / 无时间戳 / 列顺序混乱 / 只有 email 一列等），自动补齐：
 *    - 缺少 when → 写入一个很早的时间戳（BURN_IN_TS="2023-01-01T00:00:00Z"），避免被“近7日”误计
 *    - 缺少其他列 → 用空字符串占位
 * 3) 去重策略：
 *    - unsubscribes：按 email 去重，保留时间最近的一条
 *    - bounces     ：按 email+code 去重，保留时间最近的一条（code 为空则按 email）
 *    - complaints  ：按 email 去重，保留时间最近的一条
 * 4) 严格输出 UTF-8、统一换行 \n、结尾带换行；并按时间升序排序写回原文件
 *
 * 使用方式：
 *   node scripts/normalize_suppression_logs.js
 *
 * 典型接入点：
 * - 在任何使用 7d KPI 之前运行；例如在 outreach-triggered/auto-accept 的前置 step 执行。
 *
 * 注意：
 * - 本脚本只规范化抑制数据，不修改 leads.csv；合并抑制请继续用 merge_suppression.js。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = p => path.join(ROOT, 'data', p);
const BURN_IN_TS = '2023-01-01T00:00:00Z'; // 老数据的回填时间戳（极早），避免计入近7日
const TZ_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

// ---------- 小工具 ----------
function exists(p){ return fs.existsSync(p); }
function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function isValidISO8601Z(s){ return TZ_RE.test(s) && !isNaN(Date.parse(s)); }
function toISO8601Z(d){
  try {
    const dt = (d instanceof Date) ? d : new Date(d);
    if (isNaN(dt.getTime())) return null;
    return new Date(dt.toISOString()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  } catch { return null; }
}
function normalizeEmail(s){
  if (!s) return '';
  return String(s).trim().toLowerCase();
}
function parseCSVLine(line) {
  // 轻量 CSV 解析，支持双引号包裹与转义双引号
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i+1] === '"') { cur += '"'; i++; }
        else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
function joinCSVRow(cells){
  // 简单序列化：若含逗号或双引号，用双引号包裹，并转义内部引号
  return cells.map(v => {
    const s = (v == null ? '' : String(v));
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }).join(',');
}
function readCSVFlexible(fp){
  const rows = [];
  if (!exists(fp)) return rows;
  const text = fs.readFileSync(fp, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = text.split('\n').filter(l => l.length > 0);
  if (!lines.length) return rows;
  const first = parseCSVLine(lines[0]);
  let start = 0;
  // 判断是否有表头（非常宽松：包含 'email' 或 'when' 等）
  const headerLike = first.map(s => s.toLowerCase().trim());
  const hasHeader = headerLike.includes('email') || headerLike.includes('when') || headerLike.includes('code') || headerLike.includes('detail') || headerLike.includes('source');
  if (hasHeader) start = 1;
  for (let i = start; i < lines.length; i++) {
    rows.push(parseCSVLine(lines[i]));
  }
  return rows;
}
function writeCSV(fp, header, records){
  const dir = path.dirname(fp);
  ensureDir(dir);
  const out = [];
  out.push(joinCSVRow(header));
  for (const r of records) out.push(joinCSVRow(r));
  fs.writeFileSync(fp, out.join('\n') + '\n', 'utf8');
}
function parseWhen(raw){
  const s = (raw || '').trim();
  if (!s) return { iso: BURN_IN_TS, filled: true };
  // 允许多种时间格式，尽量转成 ISO8601Z；失败则用 BURN_IN_TS
  if (isValidISO8601Z(s)) return { iso: s, filled: false };
  const iso = toISO8601Z(s);
  if (iso) return { iso, filled: false };
  return { iso: BURN_IN_TS, filled: true };
}
function latest(aISO, bISO){
  // 返回时间更晚的 ISO 字符串
  const a = Date.parse(aISO), b = Date.parse(bISO);
  return (isNaN(a) || b > a) ? bISO : aISO;
}

function uniqKeepLatest(records, keyFn){
  const map = new Map();
  for (const r of records) {
    const key = keyFn(r);
    const exist = map.get(key);
    if (!exist) { map.set(key, r); continue; }
    const later = latest(exist.when, r.when);
    map.set(key, (later === r.when) ? r : exist);
  }
  return Array.from(map.values());
}
// ---------- 业务：各表规范化 ----------

function normalizeUnsubscribes(){
  const fp = DATA('unsubscribes.csv');
  const inRows = readCSVFlexible(fp);
  let converted = 0, invalid = 0, filledWhen = 0;

  // 兼容：可能只有 [email]，或 [email,source]，或 [when,email] 等乱序
  const recs = [];
  for (const raw of inRows) {
    let when = '', email = '', source = '';
    if (raw.length === 1) { email = raw[0]; }
    else if (raw.length === 2) {
      // 猜测：若第一列形似时间，则 [when,email]；否则 [email,source]
      const maybeWhen = parseWhen(raw[0]);
      if (!maybeWhen.filled && maybeWhen.iso !== BURN_IN_TS) { when = maybeWhen.iso; email = raw[1]; }
      else { email = raw[0]; source = raw[1]; }
    } else {
      // 3 列及以上，尝试匹配字段名，否则猜列位
      // 这里不读取列名，按通用顺序优先：when,email,source
      when = raw[0]; email = raw[1]; source = raw[2] || '';
    }

    email = normalizeEmail(email);
    if (!email || !email.includes('@')) { invalid++; continue; }
    const w = parseWhen(when);
    if (w.filled) filledWhen++;
    recs.push({ when: w.iso, email, source: (source || '').trim() });
    converted++;
  }

  // 去重：按 email 保留最近
  const dedup = uniqKeepLatest(recs, r => r.email);
  // 按时间升序
  dedup.sort((a,b) => Date.parse(a.when) - Date.parse(b.when));

  writeCSV(fp, ['when','email','source'], dedup.map(r => [r.when, r.email, r.source]));
  return { file: 'unsubscribes.csv', in: inRows.length, out: dedup.length, converted, invalid, filledWhen };
}

function normalizeBounces(){
  const fp = DATA('bounces.csv');
  const inRows = readCSVFlexible(fp);
  let converted = 0, invalid = 0, filledWhen = 0;

  const recs = [];
  for (const raw of inRows) {
    let when = '', email = '', code = '', detail = '';
    if (raw.length === 1) { email = raw[0]; }
    else if (raw.length === 2) {
      const maybeWhen = parseWhen(raw[0]);
      if (!maybeWhen.filled && maybeWhen.iso !== BURN_IN_TS) { when = maybeWhen.iso; email = raw[1]; }
      else { email = raw[0]; code = raw[1]; }
    } else if (raw.length >= 3) {
      // 兼容 [when,email,code,detail?] 或 [email,code,detail]
      // 优先把第一列尝试当作时间
      const maybeWhen = parseWhen(raw[0]);
      if (!maybeWhen.filled && maybeWhen.iso !== BURN_IN_TS) {
        when = maybeWhen.iso; email = raw[1]; code = raw[2] || ''; detail = raw[3] || '';
      } else {
        email = raw[0]; code = raw[1] || ''; detail = raw[2] || '';
      }
    }
    email = normalizeEmail(email);
    if (!email || !email.includes('@')) { invalid++; continue; }
    const w = parseWhen(when);
    if (w.filled) filledWhen++;
    recs.push({ when: w.iso, email, code: (code||'').trim(), detail: (detail||'').trim() });
    converted++;
  }

  // 去重：按 email+code（code 为空则按 email）保留最近
  const dedup = uniqKeepLatest(recs, r => r.email + '|' + (r.code || ''));
  dedup.sort((a,b) => Date.parse(a.when) - Date.parse(b.when));

  writeCSV(fp, ['when','email','code','detail'], dedup.map(r => [r.when, r.email, r.code, r.detail]));
  return { file: 'bounces.csv', in: inRows.length, out: dedup.length, converted, invalid, filledWhen };
}

function normalizeComplaints(){
  const fp = DATA('complaints.csv');
  const inRows = exists(fp) ? readCSVFlexible(fp) : [];
  let converted = 0, invalid = 0, filledWhen = 0;

  const recs = [];
  for (const raw of inRows) {
    let when = '', email = '', source = '';
    if (raw.length === 1) { email = raw[0]; }
    else if (raw.length === 2) {
      const maybeWhen = parseWhen(raw[0]);
      if (!maybeWhen.filled && maybeWhen.iso !== BURN_IN_TS) { when = maybeWhen.iso; email = raw[1]; }
      else { email = raw[0]; source = raw[1]; }
    } else {
      when = raw[0]; email = raw[1]; source = raw[2] || '';
    }
    email = normalizeEmail(email);
    if (!email || !email.includes('@')) { invalid++; continue; }
    const w = parseWhen(when);
    if (w.filled) filledWhen++;
    recs.push({ when: w.iso, email, source: (source||'').trim() });
    converted++;
  }

  // 去重：按 email，保留最近
  const dedup = uniqKeepLatest(recs, r => r.email);
  dedup.sort((a,b) => Date.parse(a.when) - Date.parse(b.when));

  writeCSV(fp, ['when','email','source'], dedup.map(r => [r.when, r.email, r.source]));
  return { file: 'complaints.csv', in: inRows.length, out: dedup.length, converted, invalid, filledWhen, created: !exists(fp) && dedup.length===0 ? true : false };
}

// ---------- 主流程 ----------
(function main(){
  // 若文件不存在，创建空表头，保持幂等
  if (!exists(DATA('unsubscribes.csv'))) writeCSV(DATA('unsubscribes.csv'), ['when','email','source'], []);
  if (!exists(DATA('bounces.csv')))      writeCSV(DATA('bounces.csv'),      ['when','email','code','detail'], []);
  if (!exists(DATA('complaints.csv')))   writeCSV(DATA('complaints.csv'),   ['when','email','source'], []);

  const r1 = normalizeUnsubscribes();
  const r2 = normalizeBounces();
  const r3 = normalizeComplaints();

  // 汇总日志（便于 GitHub Actions 输出）
  function fmt(r){
    return `${r.file}: in=${r.in||0} → out=${r.out||0} | converted=${r.converted||0} | invalid=${r.invalid||0} | filledWhen=${r.filledWhen||0}`;
  }
  console.log('normalize_suppression_logs:');
  console.log('  ' + fmt(r1));
  console.log('  ' + fmt(r2));
  console.log('  ' + fmt(r3));

  // Step Summary（若存在）
  const sum = process.env.GITHUB_STEP_SUMMARY;
  if (sum) {
    const md = [
      '### Normalize Suppression Logs',
      `- unsubscribes → **${r1.out||0}** rows (in:${r1.in||0}, invalid:${r1.invalid||0}, filledWhen:${r1.filledWhen||0})`,
      `- bounces      → **${r2.out||0}** rows (in:${r2.in||0}, invalid:${r2.invalid||0}, filledWhen:${r2.filledWhen||0})`,
      `- complaints   → **${r3.out||0}** rows (in:${r3.in||0}, invalid:${r3.invalid||0}, filledWhen:${r3.filledWhen||0})`,
      '',
      `> 注：缺失时间戳的历史数据已填充为 **${BURN_IN_TS}**，避免 7 日指标假性偏高；并已按时间升序、去重写回。`
    ].join('\n');
    try { fs.appendFileSync(sum, md + '\n', 'utf8'); } catch {}
  }
})();
