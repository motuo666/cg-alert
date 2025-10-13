#!/usr/bin/env node
// promote-intakes.js — 每15分钟把 data/intakes.csv 去重追加到 data/customers.csv
// 设计：
// - 优先用行内邮箱作为主键去重（大小写不敏感）；无邮箱则用整行sha1作为键
// - 自动识别表头（首行包含 "email" 等字段名则视为表头）；customers.csv 若空会带上表头
// - 幂等：重复跑不会重复追加
// - 无第三方依赖

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
const INTAKES = path.join(DATA_DIR, 'intakes.csv');
const CUSTOMERS = path.join(DATA_DIR, 'customers.csv');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function readText(file) {
  if (!fs.existsSync(file)) return '';
  return fs.readFileSync(file, 'utf8');
}

// 极简CSV解析（支持带引号与逗号）
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  function pushField() {
    row.push(field);
    field = '';
  }
  function pushRow() {
    // 去除行尾空白
    rows.push(row.map(s => s.trim()));
    row = [];
  }

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'; // 转义双引号
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',') {
        pushField();
      } else if (c === '\r') {
        // ignore
      } else if (c === '\n') {
        pushField();
        pushRow();
      } else {
        field += c;
      }
    }
  }
  // 最后一行（如无换行）
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  // 过滤全空行
  return rows.filter(r => r.some(x => x && x.length));
}

function stringifyCSV(rows) {
  const out = [];
  for (const r of rows) {
    const fields = r.map(v => {
      const s = String(v ?? '');
      if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    });
    out.push(fields.join(','));
  }
  return out.join('\n') + (out.length ? '\n' : '');
}

function extractEmailFromRow(rowArr) {
  const line = rowArr.join(' ');
  const m = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

function isHeaderRow(rowArr) {
  // 简单判定：含有 email/company/domain/… 等关键词，且本行不含 @
  const joined = rowArr.join(' ').toLowerCase();
  const hasKeyword = /(email|e-mail|company|domain|vendor|name|phone)/.test(joined);
  const hasAt = /@/.test(joined);
  return hasKeyword && !hasAt;
}

function keyForRow(rowArr) {
  const mail = extractEmailFromRow(rowArr);
  return mail || `row:${sha1(rowArr.join('|'))}`;
}

function main() {
  ensureDir(DATA_DIR);

  const intakeText = readText(INTAKES).trim();
  if (!intakeText) {
    console.log('promote: no intakes.csv (or empty) → nothing to do');
    process.exit(0);
  }

  const intakeRowsRaw = parseCSV(intakeText);
  if (intakeRowsRaw.length === 0) {
    console.log('promote: intakes has 0 rows');
    process.exit(0);
  }

  let intakeHeader = null;
  let intakeRows = intakeRowsRaw;

  if (isHeaderRow(intakeRowsRaw[0])) {
    intakeHeader = intakeRowsRaw[0];
    intakeRows = intakeRowsRaw.slice(1);
  }

  // 读取 customers
  const customersText = readText(CUSTOMERS).trim();
  let custHeader = null;
  let custRows = [];
  if (customersText) {
    const tmp = parseCSV(customersText);
    if (tmp.length) {
      if (isHeaderRow(tmp[0])) {
        custHeader = tmp[0];
        custRows = tmp.slice(1);
      } else {
        custRows = tmp;
      }
    }
  }

  // 构建已存在的键集合（按邮箱/行哈希）
  const existingKeys = new Set();
  for (const r of custRows) existingKeys.add(keyForRow(r));

  // 生成待追加的新行
  const toAppend = [];
  let scanned = 0, skipped = 0, added = 0;

  for (const r of intakeRows) {
    scanned++;
    const k = keyForRow(r);
    if (existingKeys.has(k)) {
      skipped++;
      continue;
    }
    existingKeys.add(k);
    toAppend.push(r);
    added++;
  }

  // 生成输出
  const outRows = [];
  // 表头策略：customers优先；否则用intakes表头；都没有就不写表头
  if (custHeader) {
    outRows.push(custHeader);
  } else if (intakeHeader) {
    outRows.push(intakeHeader);
  }
  // 旧客户行 + 新追加
  outRows.push(...custRows, ...toAppend);

  // 写临时文件再替换
  const tmpFile = CUSTOMERS + '.tmp';
  fs.writeFileSync(tmpFile, stringifyCSV(outRows), 'utf8');
  fs.renameSync(tmpFile, CUSTOMERS);

  console.log(`promote: scanned=${scanned}, added=${added}, skipped=${skipped}, customers_total=${outRows.length - (outRows[0] ? 1 : 0)}`);
}

try {
  main();
  process.exit(0);
} catch (e) {
  console.error('promote: fatal', e && e.stack || e);
  process.exit(1);
}
