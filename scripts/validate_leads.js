#!/usr/bin/env node
/**
 * validate_leads.js（覆盖版：带自动规范化）
 * 目标格式（无表头，固定 9 列）：
 *   email,company,domain,vendor1,vendor2,vendor3,persona,status,mx_ok
 *
 * 自动处理：
 *   - 多出来的列会截断到 9 列；若末尾是 "email,company,domain,status,seq,last_touch" 之类表头尾巴，直接剔除
 *   - status 为空 → new；mx_ok 为空 → 1
 *   - 保留严格校验（非法邮箱/域名/状态值），发现即报错退出
 *   - 有修复会重写 data/leads.csv
 */

const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

const FILE = path.join(__dirname, '..', 'data', 'leads.csv');

// 目标列
const COLS = ['email','company','domain','vendor1','vendor2','vendor3','persona','status','mx_ok'];
const ALLOWED_STATUS = new Set(['new','sent','bounced','unsub']);
// 可识别为“表头尾巴”的 token
const HEADER_TAIL = new Set(['email','company','domain','status','seq','last_touch','created_at','updated_at']);

function isEmail(s){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s||'').trim()); }
function isDomain(s){ return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(String(s||'').trim()); }

function normalizeRow(r){
  // 去空白
  r = r.map(x => String(x==null?'':x).trim());

  // 如果长度>9，看看是不是“表头尾巴”在末尾；无论如何都截断
  if (r.length > COLS.length) {
    const extra = r.slice(COLS.length).map(x => x.toLowerCase());
    const isHeaderTail = extra.every(x => HEADER_TAIL.has(x));
    // 无需区分，统一截断即可；只是统计 purposes
    r = r.slice(0, COLS.length);
    normalizeRow._fixedExtra = (normalizeRow._fixedExtra || 0) + 1;
  }

  // 不足 9 列则补空串
  while (r.length < COLS.length) r.push('');

  // 自动兜底
  if (!r[7]) r[7] = 'new';         // status
  if (!r[8]) r[8] = '1';           // mx_ok

  return r;
}

(function main(){
  if (!fs.existsSync(FILE)) {
    console.error(`❌ 未找到文件：${FILE}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(FILE,'utf8');
  const rows = parse(raw, { relax_column_count: true, skip_empty_lines: true, trim: true });

  const out = [];
  const errs = [];
  let fixed = 0;

  rows.forEach((r, i) => {
    const line = i + 1;
    const n = normalizeRow(r);
    if (normalizeRow._fixedExtra) fixed += 1;

    // 逐项校验
    const [email, company, domain, v1, v2, v3, persona, status, mx] = n;

    if (!isEmail(email)) errs.push(`第 ${line} 行：email 非法 -> ${email}`);
    if (!company)        errs.push(`第 ${line} 行：company 为空`);
    if (!isDomain(domain)) errs.push(`第 ${line} 行：domain 非法 -> ${domain}`);

    if (!ALLOWED_STATUS.has(String(status).toLowerCase())) {
      errs.push(`第 ${line} 行：status 必须为 new|sent|bounced|unsub，当前 -> ${status}`);
    }

    if (!/^[01]$/.test(String(mx))) {
      errs.push(`第 ${line} 行：mx_ok 必须为 0 或 1，当前 -> ${mx}`);
    }

    out.push(n);
  });

  // 如果有修复（截断/兜底），回写
  if (fixed > 0) {
    const csv = stringify(out, { quoted: false });
    fs.writeFileSync(FILE, csv, 'utf8');
    console.log(`🔧 leads.csv 已自动规范化：修复 ${fixed} 行（列数超限/表头尾巴/兜底）。`);
  }

  if (errs.length) {
    console.error('❌ leads.csv 校验失败：\n - ' + errs.join('\n - '));
    process.exit(1);
  } else {
    console.log(`✅ leads.csv 校验通过：${out.length} 行`);
    process.exit(0);
  }
})();
