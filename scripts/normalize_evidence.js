#!/usr/bin/env node
/**
 * normalize_evidence.js  覆盖版
 *
 * 作用（幂等）：
 * 1) 指纹回填：若 evidence JSON 的 hash 为空/00000000，则从 .cache/http/<host>/<encoded-path>.body.txt
 *    计算 SHA256，写回 { hash, fingerprint }（不改文件名）。
 * 2) 可核证链：写入 provenance 信息：
 *    - provenance.commit  = 来自 env:GIT_COMMIT（短哈7位），若缺再补
 *    - provenance.run_url = 来自 env:RUN_URL（本次构建的 Actions Run 链接），若缺再补
 * 3) 变化片段摘要（可用则写）：diff_excerpt_before / diff_excerpt_after（各10–20字，UTF-8）
 *    - 与同 vendor 同 Type 的上一条 evidence 对比（按文件名日期排序），从缓存正文做最小片段提取
 *
 * 输出统计示例：
 * normalize_evidence: total=123 updated_hash=45 updated_prov=120 updated_excerpt=38 hasHash=70 noCache=8 bad=0
 *
 * 兼容性：可重复运行；遇到坏 JSON 或无法读取缓存时跳过，不抛出；不更名、不改结构。
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const EVD  = path.join(ROOT, 'evidence');
const CACHE_ROOT = path.join(ROOT, '.cache', 'http');

const ENV_COMMIT = (process.env.GIT_COMMIT || '').trim();
const ENV_RUNURL = (process.env.RUN_URL || '').trim();

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(p);
    else if (d.isFile() && d.name.endsWith('.json')) yield p;
  }
}

function encodePath(pth) { return encodeURIComponent(pth).replace(/%2F/g, '/'); }

function readCachedBody(u) {
  try {
    const { host, pathname, search } = new URL(u);
    const raw = pathname + (search || '');
    const p1 = path.join(CACHE_ROOT, host, encodePath(raw) + '.body.txt');
    if (fs.existsSync(p1)) return fs.readFileSync(p1);
    // 兼容历史弱编码
    const weak = raw.replace(/[^\w\-./]/g, '_');
    const p2 = path.join(CACHE_ROOT, host, weak + '.body.txt');
    if (fs.existsSync(p2)) return fs.readFileSync(p2);
  } catch {}
  return null;
}

function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function short7(s) { return (s || '').replace(/^([a-f0-9]{7}).*$/i, '$1'); }
function hasGoodHash(h) { return !!(h && !/^0+$/i.test(String(h))); }

function parseMetaFromFilename(fp) {
  // evidence/<slug>/<YYYY-MM-DD>-<Type>-<hash>.json
  const name = path.basename(fp);
  const m = name.match(/^(\d{4}-\d{2}-\d{2})-([A-Za-z0-9]+)-([A-Fa-f0-9]+)\.json$/);
  return m ? { date: m[1], type: m[2], nameHash: m[3] } : { date:'', type:'', nameHash:'' };
}

function findPrevEvidencePath(currentPath) {
  try {
    const dir = path.dirname(currentPath);
    const { type, date } = parseMetaFromFilename(currentPath);
    if (!type || !date) return null;
    const files = fs.readdirSync(dir)
      .filter(n => n.endsWith('.json') && n !== path.basename(currentPath))
      .sort();
    // 寻找同 Type 且日期 < 当前 的最后一条
    let candidate = null;
    for (const n of files) {
      const m = n.match(/^(\d{4}-\d{2}-\d{2})-([A-Za-z0-9]+)-/);
      if (!m) continue;
      if (m[2] !== type) continue;
      if (m[1] <= date) candidate = n; // 递增排序，最后一个满足条件的为上一条
    }
    return candidate ? path.join(dir, candidate) : null;
  } catch { return null; }
}

function toUTF8Safe(buf, maxBytes = 40000) {
  if (!buf) return '';
  try {
    // 避免超大正文占内存，只取前 N 字节
    const slice = buf.length > maxBytes ? buf.subarray(0, maxBytes) : buf;
    return slice.toString('utf8');
  } catch { return ''; }
}

function diffExcerpt(beforeStr, afterStr, window = 18) {
  // 简单 diff：找共同前缀和后缀，截出差异区域两侧的片段
  if (!beforeStr || !afterStr || beforeStr === afterStr) return { before:'', after:'' };
  const a = beforeStr, b = afterStr;
  const lenA = a.length, lenB = b.length;
  let i = 0, j = 0;
  const minLen = Math.min(lenA, lenB);
  while (i < minLen && a[i] === b[i]) i++;
  while (j < minLen - i && a[lenA - 1 - j] === b[lenB - 1 - j]) j++;
  const aMid = a.slice(Math.max(0, i - window), Math.min(lenA, lenA - j + window));
  const bMid = b.slice(Math.max(0, i - window), Math.min(lenB, lenB - j + window));

  // 只取可读的 10–20 字符
  const trim = (s) => {
    const s2 = s.replace(/\s+/g, ' ').trim();
    if (s2.length <= 20) return s2;
    return s2.slice(0, 20) + '…';
  };
  return { before: trim(aMid), after: trim(bMid) };
}

function ensureProvenance(obj) {
  let changed = false;
  obj.provenance = obj.provenance && typeof obj.provenance === 'object' ? obj.provenance : {};
  if (ENV_COMMIT && !obj.provenance.commit) { obj.provenance.commit = short7(ENV_COMMIT); changed = true; }
  if (ENV_RUNURL && !obj.provenance.run_url) { obj.provenance.run_url = ENV_RUNURL; changed = true; }
  return changed;
}

function backfillAndEnrich(fp) {
  let j;
  try { j = JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return { updated:false, reason:'bad-json' }; }

  const meta = parseMetaFromFilename(fp);

  let didHash = false, didProv = false, didExcerpt = false;

  // 1) 指纹回填
  if (!hasGoodHash(j.hash)) {
    const body = j.url ? readCachedBody(j.url) : null;
    if (body && body.length) {
      const hex = sha256Hex(body);
      j.hash = hex;
      j.fingerprint = `sha256:${hex}`;
      didHash = true;
    } else {
      // 没有缓存，hash 仍为空
    }
  }

  // 2) 可核证链（provenance）
  if (ensureProvenance(j)) didProv = true;

  // 3) 变化片段摘要（仅当尚未写入且有缓存正文）
  if (!j.diff_excerpt_before && !j.diff_excerpt_after && j.url) {
    const currBuf = readCachedBody(j.url);
    const prevPath = findPrevEvidencePath(fp);
    let prevBuf = null;
    if (prevPath) {
      try {
        const pj = JSON.parse(fs.readFileSync(prevPath, 'utf8'));
        if (pj && pj.url) prevBuf = readCachedBody(pj.url);
      } catch {}
    }
    const currStr = toUTF8Safe(currBuf);
    const prevStr = toUTF8Safe(prevBuf);
    if (currStr && prevStr) {
      const ex = diffExcerpt(prevStr, currStr);
      if (ex.before || ex.after) {
        j.diff_excerpt_before = ex.before;
        j.diff_excerpt_after  = ex.after;
        didExcerpt = true;
      }
    }
  }

  if (didHash || didProv || didExcerpt) {
    fs.writeFileSync(fp, JSON.stringify(j, null, 2), 'utf8');
    return { updated:true, didHash, didProv, didExcerpt };
  }
  return { updated:false, reason: hasGoodHash(j.hash) ? 'has-hash' : 'no-cache' };
}

(function main(){
  let total=0, updated_hash=0, updated_prov=0, updated_excerpt=0, hasHash=0, noCache=0, bad=0;
  for (const fp of walk(EVD)) {
    total++;
    try {
      const r = backfillAndEnrich(fp);
      if (r.updated) {
        if (r.didHash) updated_hash++;
        if (r.didProv) updated_prov++;
        if (r.didExcerpt) updated_excerpt++;
      } else {
        if (r.reason==='has-hash') hasHash++;
        else if (r.reason==='no-cache') noCache++;
      }
    } catch { bad++; }
  }
  console.log(`normalize_evidence: total=${total} updated_hash=${updated_hash} updated_prov=${updated_prov} updated_excerpt=${updated_excerpt} hasHash=${hasHash} noCache=${noCache} bad=${bad}`);
})();
