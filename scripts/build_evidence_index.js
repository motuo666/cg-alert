#!/usr/bin/env node
/**
 * 构建证据索引：扫描 evidence/<slug>/<YYYY-MM-DD>-<Type>-<hash>.json（兼容下划线等变体）
 * 生成 TSV：data/evidence.ndx
 * 列顺序（无表头，保持向后兼容）：
 *   date \t slug \t type \t hash \t path \t commit \t run_url
 *
 * 兼容性与增强：
 * - 文件名解析更宽松：分隔符支持 - 或 _；type 使用非斜杠的最短匹配；hash 支持 >=6 位十六进制或 0 串
 * - 若文件名的 hash 为 00000000 或 JSON 中缺失 hash，则尝试从 .cache/http/<host>/<encoded-path>.body.txt 计算 SHA256 兜底
 * - 若 evidence JSON 中存在 { commit, run_url } 字段，则写入索引；否则留空（由上游 enrich 脚本负责填充）
 *
 * 注意：
 * - 不写表头，避免破坏现有读取脚本（如 fullchain_check.js）
 * - 输出按 date/slug/type/path 排序，稳定可 diff
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const EVD_DIR  = path.join(ROOT, 'evidence');
const OUT_TSV  = path.join(ROOT, 'data', 'evidence.ndx');

// 更宽松的文件名匹配：- 或 _ 作为分隔；type 放宽为非斜杠的最短匹配；hash 六位以上十六进制或 0 串
const RE_NAME = /^evidence\/([^/]+)\/(\d{4}-\d{2}-\d{2})[-_]([^\/]+?)[-_]([a-f0-9]{6,})\.json$/i;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function safeReadJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return {}; }
}

function encodePath(pth) {
  // 与 poll_public_endpoints.js 一致：对整条 path+search 做 encodeURIComponent，再把 %2F 复原成 /
  return encodeURIComponent(pth).replace(/%2F/g, '/');
}

function readCachedBody(u) {
  try {
    const { host, pathname, search } = new URL(u);
    const raw = pathname + (search || '');
    const guess1 = path.join(ROOT, '.cache', 'http', host, encodePath(raw) + '.body.txt');
    if (fs.existsSync(guess1)) return fs.readFileSync(guess1);
    // 兼容早期“弱编码”路径（将特殊字符替换为下划线）
    const weak = raw.replace(/[^\w\-./]/g, '_');
    const guess2 = path.join(ROOT, '.cache', 'http', host, weak + '.body.txt');
    if (fs.existsSync(guess2)) return fs.readFileSync(guess2);
  } catch {}
  return null;
}

function sha256Hex(buf) {
  try { return crypto.createHash('sha256').update(buf).digest('hex'); }
  catch { return ''; }
}

(function main() {
  fs.mkdirSync(path.dirname(OUT_TSV), { recursive: true });

  /** @type {Array<{date:string,slug:string,type:string,hash:string,rel:string,commit:string,run_url:string}>} */
  const rows = [];
  let computedHash = 0;
  let seen = 0;

  for (const abs of walk(EVD_DIR)) {
    if (!/\.json$/i.test(abs)) continue;
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/'); // 标准化分隔符
    let slug = '', date = '', type = '', hash = '';

    // 先尝试从路径解析
    const m = rel.match(RE_NAME);
    if (m) {
      [, slug, date, type, hash] = m;
      if (/^0+$/i.test(hash)) hash = ''; // 文件名的 00000000 视为无 hash
    }

    // 读取 JSON
    const j = safeReadJSON(abs);

    // 回填基本字段（以 JSON 为准）
    if (!slug) slug = rel.split('/')[1] || '';
    if (!date) {
      const guess = String(j.date || j.detected_at || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(guess)) date = guess;
    }
    if (!type) type = (j.type || 'Change');
    if (!hash) hash = (j.hash || '');

    // 仍无 hash，尝试从缓存页面正文计算（需 evidence JSON 带 url）
    if (!hash && j.url) {
      const body = readCachedBody(j.url);
      if (body && body.length) {
        hash = sha256Hex(body); // 64 位；渲染时会截到 8 位
        computedHash++;
      }
    }

    // provenance（可核证链）：尽量读 JSON（由上游 enrich 写入）；否则留空
    const commit  = typeof j.commit  === 'string' ? j.commit  : '';
    const run_url = typeof j.run_url === 'string' ? j.run_url : '';

    // 跳过没有日期的记录（索引最低要求）
    if (!date) continue;

    rows.push({ date, slug, type, hash, rel, commit, run_url });
    seen++;
  }

  // 稳定排序：date, slug, type, rel
  rows.sort((a, b) => (
    a.date.localeCompare(b.date) ||
    a.slug.localeCompare(b.slug) ||
    a.type.localeCompare(b.type) ||
    a.rel.localeCompare(b.rel)
  ));

  // 输出 TSV（无表头）
  const lines = rows.map(r => [r.date, r.slug, r.type, r.hash || '', r.rel, r.commit || '', r.run_url || ''].join('\t'));
  fs.writeFileSync(OUT_TSV, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');

  console.log(`indexed: ${rows.length} records -> ${path.relative(ROOT, OUT_TSV)} (computedHash=${computedHash}, scanned=${seen})`);
})();
