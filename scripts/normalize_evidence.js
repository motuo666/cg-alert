#!/usr/bin/env node
/**
 * Backfill fingerprint for baseline evidence JSON.
 * 若 evidence JSON 的 hash 为空/00000000，则从 .cache/http/<host>/<encoded-path>.body.txt
 * 计算 SHA256，写回 { hash, fingerprint }。不改文件名；可重复运行（幂等）。
 */
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const EVD  = path.join(ROOT, 'evidence');

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
    const p1 = path.join(ROOT, '.cache', 'http', host, encodePath(raw) + '.body.txt');
    if (fs.existsSync(p1)) return fs.readFileSync(p1);
    const weak = raw.replace(/[^\w\-./]/g, '_');
    const p2 = path.join(ROOT, '.cache', 'http', host, weak + '.body.txt');
    if (fs.existsSync(p2)) return fs.readFileSync(p2);
  } catch {}
  return null;
}
function sha256Hex(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function backfill(fp) {
  let j; try { j = JSON.parse(fs.readFileSync(fp, 'utf8')); } catch { return { updated:false, reason:'bad-json' }; }
  const name = path.basename(fp);
  const m = name.match(/-[A-Za-z0-9]+-([A-Fa-f0-9]+)\.json$/);
  const nameHash = m ? m[1] : '';
  const hasGood = (j.hash && !/^0+$/i.test(String(j.hash)));
  if (hasGood) return { updated:false, reason:'has-hash' };

  const body = j.url ? readCachedBody(j.url) : null;
  if (!body || !body.length) return { updated:false, reason:'no-cache' };

  const hex = sha256Hex(body);
  j.hash = hex;
  j.fingerprint = `sha256:${hex}`;
  fs.writeFileSync(fp, JSON.stringify(j, null, 2), 'utf8');
  return { updated:true, nameHashZero:(!nameHash || /^0+$/i.test(nameHash)) };
}

(function main(){
  let total=0, updated=0, noCache=0, bad=0, hasHash=0;
  for (const fp of walk(EVD)) {
    total++;
    try {
      const r = backfill(fp);
      if (r.updated) updated++;
      else if (r.reason==='no-cache') noCache++;
      else if (r.reason==='has-hash') hasHash++;
    } catch { bad++; }
  }
  console.log(`normalize_evidence: total=${total} updated=${updated} hasHash=${hasHash} noCache=${noCache} bad=${bad}`);
})();
