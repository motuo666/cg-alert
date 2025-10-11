#!/usr/bin/env node
/**
 * validate_leads.js — 零依赖版
 * 规范/校验 data/leads.csv，仅保留 9 列：
 *   email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok
 * 功能：
 *  - 自动去掉“粘贴进来的尾巴列”（比如 seq,last_touch 等），强制 9 列
 *  - status 空则补 new，mx_ok 空则补 1
 *  - 从 email 衍生 domain（当 domain 为空）
 *  - 按 email 去重
 *  - 邮箱/域名/枚举值严格校验，出错直接 exit 1（不重写文件）
 *  - 校验通过则写回规范化后的 CSV（含标准表头）
 */

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'leads.csv');
const HEAD = ['email','company','domain','vendor1','vendor2','vendor3','persona','status','mx_ok'];
const ALLOWED_STATUS = new Set(['new','sent','bounced','unsub']);

// -------- CSV parse / stringify（零依赖）--------
function csvParse(text) {
  // 支持引号和逗号；按“非引号状态下的换行”切分行
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n') {
        if (text[i - 1] === '\r') { /* 处理 \r\n */ }
        row.push(field); field = '';
        rows.push(row); row = [];
      } else {
        field += ch;
      }
    }
  }
  row.push(field); rows.push(row);
  // 若文件末尾多出一空行，清理掉
  if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
  return rows;
}
function csvEscape(s) {
  s = s == null ? '' : String(s);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function writeCSV(rows) {
  const out = rows.map(r => r.map(csvEscape).join(',')).join('\n') + '\n';
  fs.writeFileSync(FILE, out, 'utf8');
}

// -------- 小工具 --------
const trim = s => String(s ?? '').trim();
const lower = s => trim(s).toLowerCase();
const validEmail  = e => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower(e));
const validDomain = d => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(trim(d));

if (!fs.existsSync(FILE)) {
  console.log('leads.csv not found, skip.');
  process.exit(0);
}

let raw = fs.readFileSync(FILE, 'utf8').replace(/^\uFEFF/, ''); // 去 BOM
const rows = csvParse(raw);
if (!rows.length) { console.log('leads.csv empty, skip.'); process.exit(0); }

// 识别是否有表头（容忍大小写/前后空格）
let header = rows[0].map(x => lower(x));
const hasHeader = header.includes('email') && header.includes('company');
const data = hasHeader ? rows.slice(1) : rows;

const errs = [];
const seen = new Set();
const normalized = [];

data.forEach((r, i0) => {
  // 防呆：如果中间有“又粘贴了一行表头”，跳过
  const lowerRow = r.map(x => lower(x));
  if (lowerRow[0] === 'email' && lowerRow[1] === 'company') return;

  // 只保留前 9 列，不足补空
  const cells = Array.from({ length: HEAD.length }, (_, i) => trim(r[i]));

  let [email, company, domain, vendor1, vendor2, vendor3, persona, status, mx_ok] = cells;

  email   = lower(email);
  company = trim(company);
  domain  = lower(domain);
  vendor1 = trim(vendor1);
  vendor2 = trim(vendor2);
  vendor3 = trim(vendor3);
  persona = trim(persona);

  // domain 缺失时从 email 推导
  if (!domain && email.includes('@')) domain = email.split('@')[1];

  // 默认值
  status = lower(status) || 'new';
  mx_ok  = trim(mx_ok); if (mx_ok === '') mx_ok = '1';

  // 严格校验
  const rowNum = i0 + 1 + (hasHeader ? 1 : 0);
  if (!ALLOWED_STATUS.has(status)) errs.push(`第 ${rowNum} 行：status 非法 -> ${status}`);
  if (!/^(0|1)$/.test(mx_ok))       errs.push(`第 ${rowNum} 行：mx_ok 必须为 0 或 1，当前 -> ${mx_ok}`);
  if (!validEmail(email))          errs.push(`第 ${rowNum} 行：email 非法 -> ${email}`);
  if (!validDomain(domain))        errs.push(`第 ${rowNum} 行：domain 非法 -> ${domain}`);

  const key = email;
  if (seen.has(key)) return; // 去重（按 email）
  seen.add(key);

  normalized.push([email, company, domain, vendor1, vendor2, vendor3, persona, status, mx_ok]);
});

// 出错就不写回，直接失败
if (errs.length) {
  console.error('\n❌ leads.csv 校验失败：');
  errs.slice(0, 200).forEach(e => console.error(' - ' + e));
  process.exit(1);
}

// 写回规范化后的 CSV（带标准表头）
writeCSV([HEAD, ...normalized]);
console.log(`✅ leads.csv 校验通过：${normalized.length} 行（已规范化/去重/强制 9 列）`);
process.exit(0);
