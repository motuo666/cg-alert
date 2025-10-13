#!/usr/bin/env node
/**
 * promote-intakes.js — 每15分钟把 data/intakes.csv 去重追加到 data/customers.csv
 * 特性：
 * - 并发锁：.tmp/promote-intakes.lock，避免本地/CI并发
 * - 幂等：按邮箱（不区分大小写）去重；无邮箱按整行SHA1去重
 * - 表头智能：识别/保留表头；customers无表头→沿用intakes表头；都无表头→纯行模式
 * - 容错：自动创建 data/ 与 customers.csv；BOM/CRLF清理；空文件早退
 * - 开关：
 *   - PROMOTE_DRY=1   只打印不写文件
 *   - PROMOTE_MAX=100 每次最多追加N条（默认无限）
 *   - PROMOTE_STRICT_HEADER=1 有表头但字段数不匹配时跳过该行
 * 日志：最终输出 scanned/added/skipped/customers_total
 *
 * 依赖：仅 Node 内置模块
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR  = path.join(__dirname, '..', 'data');
const INTAKES   = path.join(DATA_DIR, 'intakes.csv');
const CUSTOMERS = path.join(DATA_DIR, 'customers.csv');
const TMP_DIR   = path.join(__dirname, '..', '.tmp');
const LOCK_FILE = path.join(TMP_DIR, 'promote-intakes.lock');

const DRY  = process.env.PROMOTE_DRY === '1';
const MAX  = Number(process.env.PROMOTE_MAX || '0'); // 0=不限
const STRICT_HEADER = process.env.PROMOTE_STRICT_HEADER === '1';

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function withLock(fn) {
  ensureDir(TMP_DIR);
  let fd;
  try {
    fd = fs.openSync(LOCK_FILE, 'wx'); // 不存在才创建；存在即抛错
    fs.writeFileSync(fd, String(process.pid));
    return fn();
  } catch (e) {
    if (e.code === 'EEXIST') {
      console.log('promote: another process is running (lock present) → exit 0');
      process.exit(0);
    }
    throw e;
  } finally {
    try {
      if (fd) fs.closeSync(fd);
      fs.unlinkSync(LOCK_FILE);
    } catch (_) {}
  }
}

function readText(file) {
  if (!fs.existsSync(file)) return '';
  let buf = fs.readFileSync(file);
  // 去BOM
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) buf = buf.slice(3);
  return buf.toString('utf8');
}

// 极简CSV解析（支持引号、双引号转义、CRLF）
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  // 去除全空行 & 去两端空白
  return rows
    .map(r => r.map(s => (s ?? '').trim()))
    .filter(r => r.some(x => x && x.length));
}

function stringifyCSV(rows) {
  const out = rows.map(r => r.map(v => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(','));
  return out.join('\n') + (out.length ? '\n' : '');
}

function isHeaderRow(row) {
  const joined = row.join(' ').toLowerCase();
  const hasKeyword = /(email|e-mail|mail|company|org|domain|vendor|name|phone|plan|tier|notes)/.test(joined);
  const hasAt = /@/.test(joined);
  // 有典型字段名且不包含@，视为表头
  return hasKeyword && !hasAt;
}

function normHeader(row) {
  return row.map(x => x.toLowerCase().replace(/\s+/g, '_'));
}

function emailFromRow(row, header = null) {
  if (header) {
    // 优先使用表头定位 email 列
    const idx = header.findIndex(h => /^e[-_]?mail$|^email$|^mail$/.test(h));
    if (idx >= 0 && row[idx]) return String(row[idx]).toLowerCase();
  }
  // 回退：全文扫描
  const txt = row.join(' ');
  const m = txt.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

function keyForRow(row, header = null) {
  const mail = emailFromRow(row, header);
  if (mail) return `email:${mail}`;
  return `row:${crypto.createHash('sha1').update(row.join('|')).digest('hex')}`;
}

function alignRowToHeader(row, srcHeader, dstHeader) {
  if (!srcHeader || !dstHeader) return row.slice(); // 无法对齐，按原样
  const map = new Map();
  srcHeader.forEach((h, i) => map.set(h, i));
  return dstHeader.map(h => (map.has(h) ? row[map.get(h)] : ''));
}

function main() {
  ensureDir(DATA_DIR);

  const intakeText = readText(INTAKES).trim();
  if (!intakeText) {
    console.log('promote: intakes.csv not found or empty → nothing to do');
    return { scanned: 0, added: 0, skipped: 0, total: linesCount(CUSTOMERS) };
  }
  let intakeRowsRaw = parseCSV(intakeText);
  if (intakeRowsRaw.length === 0) {
    console.log('promote: intakes has 0 data rows → nothing to do');
    return { scanned: 0, added: 0, skipped: 0, total: linesCount(CUSTOMERS) };
  }

  // 识别表头
  let intakeHeader = null;
  if (isHeaderRow(intakeRowsRaw[0])) {
    intakeHeader = normHeader(intakeRowsRaw[0]);
    intakeRowsRaw = intakeRowsRaw.slice(1);
  }

  // 读 customers
  let customersText = readText(CUSTOMERS).trim();
  let custHeader = null;
  let custRows = [];
  if (customersText) {
    let tmp = parseCSV(customersText);
    if (tmp.length) {
      if (isHeaderRow(tmp[0])) { custHeader = normHeader(tmp[0]); tmp = tmp.slice(1); }
      custRows = tmp;
    }
  }

  // 目标表头决定：优先 customers 表头；否则用 intakes 表头；都没有→无表头模式
  const dstHeader = custHeader || intakeHeader || null;

  // 已存在键
  const existing = new Set(custRows.map(r => keyForRow(r, custHeader)));

  // 逐行处理
  let scanned = 0, added = 0, skipped = 0;
  const toAppend = [];
  const limit = Math.max(0, MAX|0);

  for (const r0 of intakeRowsRaw) {
    scanned++;
    let r = r0;

    // 如要求严格头且有头部，且列数不匹配，跳过
    if (STRICT_HEADER && intakeHeader && dstHeader && r.length !== intakeHeader.length) {
      skipped++; continue;
    }

    // 若两端都有表头，按目标表头重排字段；否则原样
    if (intakeHeader && dstHeader) {
      r = alignRowToHeader(r0, intakeHeader, dstHeader);
    }

    const k = keyForRow(r, dstHeader);
    if (existing.has(k)) { skipped++; continue; }

    existing.add(k);
    toAppend.push(r);
    added++;

    if (limit > 0 && added >= limit) break;
  }

  // 汇总输出
  const outRows = [];
  if (dstHeader) outRows.push(dstHeader);
  outRows.push(...custRows, ...toAppend);

  if (DRY) {
    console.log(`[DRY] promote: scanned=${scanned}, added=${added}, skipped=${skipped}, customers_total=${dstHeader ? (outRows.length - 1) : outRows.length}`);
    return { scanned, added: 0, skipped, total: dstHeader ? (outRows.length - 1) : outRows.length };
  }

  // 写入（原子替换）
  ensureDir(DATA_DIR);
  if (!fs.existsSync(CUSTOMERS)) fs.writeFileSync(CUSTOMERS, '');
  const tmpFile = CUSTOMERS + '.tmp';
  fs.writeFileSync(tmpFile, stringifyCSV(outRows), 'utf8');
  fs.renameSync(tmpFile, CUSTOMERS);

  const total = dstHeader ? (outRows.length - 1) : outRows.length;
  console.log(`promote: scanned=${scanned}, added=${added}, skipped=${skipped}, customers_total=${total}`);
  return { scanned, added, skipped, total };
}

function linesCount(file) {
  if (!fs.existsSync(file)) return 0;
  const t = readText(file).trim();
  if (!t) return 0;
  return t.split(/\r?\n/).filter(Boolean).length;
}

try {
  withLock(() => {
    const res = main();
    // 成功或无事可做都 exit 0
    process.exit(0);
  });
} catch (e) {
  console.error('promote: fatal', e && e.stack || e);
  process.exit(1);
}
