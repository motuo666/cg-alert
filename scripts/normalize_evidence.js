#!/usr/bin/env node
/**
 * Backfill fingerprint for baseline evidence JSON.
 * - If evidence JSON .hash is missing/empty/null or filename hash is 00000000,
 *   compute SHA256 from cached body (.cache/http/<host>/<encoded-path>.body.txt)
 *   and write back { hash, fingerprint } (non-destructive).
 * - Does NOT rename files. Safe to run repeatedly (idempotent).
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

function encodePath(pth) {
  return encodeURIComponent(pth).replace(/%2F/g, '/');
}
function readCachedBody(u) {
  try {
    const { host, pathname, search } = new URL(u);
    const raw = pathname + (search || '');
    const c1 = path.join(ROOT, '.cache', 'http', host, encodePath(raw) + '.body.txt');
    if (fs.existsSync(c1)) return fs.readFileSync(c1);
    const weak = raw.replace(/[^\w\-./]/g, '_');
    const c2 = path.join(ROOT, '.cache', 'http', host, weak + '.body.txt');
    if (fs.existsSync(c2)) return fs.readFileSync(c2);
  } catch {}
  return null;
}
function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function backfill(fp) {
  const raw = fs.readFileSync(fp, 'utf8');
  let j;
  try { j = JSON.parse(raw); } catch { return { updated:false, reason:'bad-json' }; }

  const name = path.basename(fp);
  const m = name.match(/-(?:[A-Za-z0-9]+)-([A-Fa-f0-9]+)\.json$/);
  const nameHash = m ? m[1] : '';
  const isZero = !nameHash || /^0+$/i.test(nameHash);

  const curHash = (j.hash || '').toString();
  if (curHash && !/^0+$/i.test(curHash)) return { updated:false, reason:'has-hash' };

  // try cached body
  const body = j.url ? readCachedBody(j.url) : null;
  if (!body || !body.length) return { updated:false, reason:'no-cache' };

  const hex = sha256Hex(body);
  j.hash = hex;
  j.fingerprint = `sha256:${hex}`;
  // do not mutate other fields (vendor/type/url/kind/detected_at...)

  fs.writeFileSync(fp, JSON.stringify(j, null, 2), 'utf8');
  return { updated:true, hash:hex, nameHashZero:isZero };
}

(function main(){
  let total=0, updated=0, noCache=0, bad=0, hasHash=0;
  for (const fp of walk(EVD)) {
    total++;
    try {
      const r = backfill(fp);
      if (r.updated) updated++;
      else if (r.reason === 'no-cache') noCache++;
      else if (r.reason === 'has-hash') hasHash++;
    } catch { bad++; }
  }
  console.log(`normalize_evidence: total=${total} updated=${updated} hasHash=${hasHash} noCache=${noCache} bad=${bad}`);
})();
