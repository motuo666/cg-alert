#!/usr/bin/env node
/**
 * Merge suppression lists into leads.csv（幂等、零依赖）
 * - 输入：data/bounces.csv、data/unsubscribes.csv（任意简单CSV/文本，脚本自动从每行抽取第一个 email）
 * - 目标：把对应 email 在 data/leads.csv（9列，无表头）中的 status 列更新为：
 *   * unsubscribes → "optout"
 *   * bounces      → "bounced"（若已是 optout 则保持 optout）
 * - 只更新存在于 leads.csv 的邮箱；其余忽略
 * - 输出：覆盖写回 leads.csv，并在同目录生成 leads.csv.bak 备份
 *
 * 列定义（按仓库约定）：
 *   0 email, 1 company, 2 domain, 3 vendor1, 4 vendor2, 5 vendor3, 6 persona, 7 status, 8 mx_ok
 *
 * 用法：
 *   node scripts/merge_suppression.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DATA = p => path.join(ROOT, 'data', p);

const FILE_LEADS = DATA('leads.csv');
const FILE_BOUNCES = DATA('bounces.csv');
const FILE_UNSUBS = DATA('unsubscribes.csv');

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function readLines(fp) {
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter(l => l.trim().length);
}

function extractEmailsFromFile(fp) {
  const set = new Set();
  for (const line of readLines(fp)) {
    // 跳过可能的表头
    if (/email/i.test(line) && !EMAIL_RE.test(line)) continue;
    const m = line.match(EMAIL_RE);
    if (m) set.add(m[0].toLowerCase());
  }
  return set;
}

// 解析 leads.csv（容忍 company 字段含逗号）：
// - 若列数 === 9：按标准取
// - 若列数  >  9：从右侧截取 8 列；中间剩余合并为 company
function parseLeadsCSV(fp) {
  const out = [];
  for (const raw of readLines(fp)) {
    const cols = raw.split(',');
    if (cols.length < 1) continue;
    if (cols.length === 9) {
      out.push({
        email: cols[0].trim(),
        company: cols[1],
        domain: cols[2],
        v1: cols[3], v2: cols[4], v3: cols[5],
        persona: cols[6],
        status: cols[7],
        mx_ok: cols[8],
        _raw: raw
      });
    } else if (cols.length > 9) {
      const email = cols[0].trim();
      const tail = cols.slice(-8);
      const company = cols.slice(1, cols.length - 8).join(','); // 保留原逗号
      out.push({
        email,
        company,
        domain: tail[0],
        v1: tail[1], v2: tail[2], v3: tail[3],
        persona: tail[4],
        status: tail[5],
        mx_ok: tail[6],
        _raw: raw
      });
    }
  }
  return out;
}

function serializeLead(row) {
  // 统一写成 9 列（company 原样输出，可能包含逗号；下游解析已容错）
  const arr = [
    row.email,
    row.company ?? '',
    row.domain ?? '',
    row.v1 ?? '',
    row.v2 ?? '',
    row.v3 ?? '',
    row.persona ?? '',
    row.status ?? '',
    row.mx_ok ?? ''
  ];
  return arr.join(',');
}

(function main(){
  if (!fs.existsSync(FILE_LEADS)) {
    console.error('leads.csv not found:', FILE_LEADS);
    process.exit(1);
  }

  const bounces = extractEmailsFromFile(FILE_BOUNCES);
  const unsubs  = extractEmailsFromFile(FILE_UNSUBS);

  const leads = parseLeadsCSV(FILE_LEADS);

  let nOptout=0, nBounced=0, nSkip=0;

  // 备份
  const bak = FILE_LEADS + '.bak';
  try { fs.copyFileSync(FILE_LEADS, bak); } catch {}

  for (const r of leads) {
    const email = String(r.email||'').toLowerCase();
    if (!email) { nSkip++; continue; }

    const isUnsub = unsubs.has(email);
    const isBounce = bounces.has(email);

    const cur = String(r.status||'').toLowerCase();

    if (isUnsub) {
      if (cur !== 'optout') {
        r.status = 'optout';
        nOptout++;
      }
      continue; // optout 优先级最高
    }
    if (isBounce) {
      if (cur !== 'optout' && cur !== 'bounced') {
        r.status = 'bounced';
        nBounced++;
      }
      continue;
    }
    nSkip++;
  }

  const out = leads.map(serializeLead).join('\n') + '\n';
  fs.writeFileSync(FILE_LEADS, out, 'utf8');

  console.log(`merge_suppression: leads=${leads.length} optout=${nOptout} bounced=${nBounced} untouched=${nSkip}`);
  console.log(`backup: ${bak}`);
})();
