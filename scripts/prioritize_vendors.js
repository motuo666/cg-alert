#!/usr/bin/env node
/**
 * Prioritize vendors for Triggered outreach
 *
 * Input:
 *   - data/evidence.ndx        (TSV; columns: date, vendor, type, hash, ...)
 *   - reports/<YYYY-MM>/<vendor>/index.html (to check pack presence)
 *   - evidence/<vendor>/*.json (fallback to infer type/date if ndx missing)
 *
 * Output:
 *   - data/vendor_priority.csv (CSV with header)
 *   - artifacts/vendor_priority.json (for debugging/other scripts)
 *
 * Scoring (0–100, higher first):
 *   + Recent change count (default 72h) × 5
 *   + High-value type weight (Pricing/DPA/ToS/Subprocessors/Status/Security/Privacy) count × 3
 *   + Has current-month Pack: +10
 *   + Hash coverage ratio × 20
 *   + Recency bonus: ≤24h +6, ≤48h +3, ≤72h +1
 *
 * Env (optional):
 *   LOOKBACK_H=72        // recent window hours
 *   MONTH=YYYY-MM        // override current month for pack detection
 *   MIN_SCORE=0          // rows with score < MIN_SCORE will still be output (sorting is handled downstream)
 *   VENDOR_INCLUDE=regex // only include vendors that match (for debugging)
 *
 * Notes:
 *   - Idempotent; safe to run multiple times.
 *   - No external deps; Node.js 20+.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const D = p => path.join(ROOT, 'data', p);
const R = p => path.join(ROOT, p);

const NOW = Date.now();
const LOOKBACK_H = Number(process.env.LOOKBACK_H || 72);
const LOOKBACK_MS = LOOKBACK_H * 3600 * 1000;
const YM = process.env.MONTH || new Date().toISOString().slice(0,7);
const VENDOR_RE = process.env.VENDOR_INCLUDE ? new RegExp(process.env.VENDOR_INCLUDE, 'i') : null;

const HIGH_VALUE_TYPES = new Set([
  'Pricing','Price','Prices',
  'DPA','Data Processing','Data Processing Addendum',
  'ToS','TOS','Terms','Terms of Service',
  'Subprocessors','Subprocessor','Sub-processor','Sub processors',
  'Status','Security','Privacy','Policy','SLA'
]);

function safeRead(fp, fallback=''){
  try { return fs.readFileSync(fp,'utf8'); } catch { return fallback; }
}
function readLines(fp){ return safeRead(fp).split(/\r?\n/).filter(Boolean); }
function fileExists(p){ try { return fs.existsSync(p); } catch { return false; } }
function ensureDir(p){ fs.mkdirSync(p, { recursive:true }); }
function parseTSVLine(line){
  const cols = line.split('\t'); // expected: date, vendor, type, hash, ...
  // tolerate CSV fallback
  if (cols.length < 2) {
    const c2 = line.split(',');
    return { date:c2[0]||'', vendor:c2[1]||'', type:c2[2]||'', hash:c2[3]||'' };
  }
  return { date: cols[0]||'', vendor: cols[1]||'', type: cols[2]||'', hash: cols[3]||'' };
}
function parseISODate(d){
  // accept YYYY-MM-DD or ISO timestamp
  if (!d) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return Date.parse(d + 'T00:00:00Z');
  return Date.parse(d);
}

function walk(dir, pred, acc=[]){
  if (!fileExists(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes:true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, pred, acc);
    else if (!pred || pred(ent.name)) acc.push(p);
  }
  return acc;
}

function collectEvidence() {
  const idxFile = D('evidence.ndx');
  const out = [];
  if (fileExists(idxFile)) {
    for (const l of readLines(idxFile)) {
      const {date, vendor, type, hash} = parseTSVLine(l);
      if (!vendor) continue;
      out.push({date, vendor, type, hash});
    }
  }
  // Fallback: if ndx missing/empty, derive from filenames under evidence/
  if (out.length === 0 && fileExists(R('evidence'))) {
    const files = walk(R('evidence'), n => /\.json$/i.test(n));
    for (const fp of files) {
      // evidence/<vendor>/<YYYY-MM-DD>-<Type>-<hash>.json
      const parts = fp.split(path.sep);
      const vendor = parts[parts.length-2];
      const base = path.basename(fp, '.json');
      const m = base.match(/^(\d{4}-\d{2}-\d{2})-([A-Za-z]+)-([0-9a-fA-F]+|00000000)$/);
      const date = m ? m[1] : '';
      const type = m ? m[2] : '';
      const hash = m ? m[3] : '';
      out.push({date, vendor, type, hash});
    }
  }
  return out;
}

function hasPack(vendor){
  const p = R(path.join('reports', YM, vendor, 'index.html'));
  return fileExists(p);
}

function isHighValueType(t){
  if (!t) return false;
  // Normalize common variants
  const n = t.toString().trim();
  if (HIGH_VALUE_TYPES.has(n)) return true;
  const up = n.toUpperCase();
  if (up.includes('PRIC')) return true;
  if (up === 'DPA') return true;
  if (up.includes('TERM')) return true;
  if (up.includes('SUBPROCESS')) return true;
  if (up.includes('SECURITY')) return true;
  if (up.includes('PRIVACY')) return true;
  if (up.includes('STATUS')) return true;
  return false;
}

function buildPriority() {
  const ev = collectEvidence();
  const stats = new Map(); // vendor -> {recent:[], hv:count, total, hashOk, lastTs}
  const now = NOW;

  for (const r of ev) {
    const vendor = (r.vendor || '').trim();
    if (!vendor) continue;
    if (VENDOR_RE && !VENDOR_RE.test(vendor)) continue;

    const ts = parseISODate(r.date);
    const type = (r.type || '').trim();
    const okHash = r.hash && !/^0+$/i.test(String(r.hash).trim());

    let s = stats.get(vendor);
    if (!s) { s = { recent:0, hv:0, total:0, hashOk:0, lastTs:0 }; stats.set(vendor, s); }

    s.total++;
    if (okHash) s.hashOk++;
    if (!isNaN(ts)) {
      if ((now - ts) <= LOOKBACK_MS) s.recent++;
      if (ts > s.lastTs) s.lastTs = ts;
    }
    if (isHighValueType(type)) s.hv++;
  }

  // Build score
  const rows = [];
  for (const [vendor, s] of stats) {
    const recencyH = s.lastTs ? Math.max(0, (now - s.lastTs)/3600000) : 1e9;
    let recencyBonus = 0;
    if (recencyH <= 24) recencyBonus = 6;
    else if (recencyH <= 48) recencyBonus = 3;
    else if (recencyH <= LOOKBACK_H) recencyBonus = 1;

    const hashRatio = s.total ? (s.hashOk / s.total) : 0;
    const scoreRecent = s.recent * 5;            // recent volume
    const scoreHV = s.hv * 3;                    // high-value changes
    const scorePack = hasPack(vendor) ? 10 : 0;  // visibility bonus
    const scoreHash = Math.round(hashRatio * 20);// evidence credibility
    let score = scoreRecent + scoreHV + scorePack + scoreHash + recencyBonus;

    if (score > 100) score = 100; // cap

    rows.push({
      vendor,
      score,
      recent_changes: s.recent,
      hv_changes: s.hv,
      total_changes: s.total,
      hash_ratio: Number(hashRatio.toFixed(3)),
      has_pack: hasPack(vendor) ? 1 : 0,
      recency_h: isFinite(recencyH) ? Math.round(recencyH) : ''
    });
  }

  // Sort: score desc, then recency asc, then recent_changes desc
  rows.sort((a,b)=>{
    if (b.score !== a.score) return b.score - a.score;
    if (a.recency_h !== b.recency_h) return a.recency_h - b.recency_h;
    return b.recent_changes - a.recent_changes;
  });

  return rows;
}

function writeOutputs(rows){
  ensureDir(path.dirname(D('vendor_priority.csv')));
  const header = ['vendor','score','recency_h','recent_changes','hv_changes','total_changes','hash_ratio','has_pack'];
  const csv = [header.join(',')].concat(
    rows.map(r => [
      r.vendor,
      r.score,
      r.recency_h,
      r.recent_changes,
      r.hv_changes,
      r.total_changes,
      r.hash_ratio,
      r.has_pack
    ].join(','))
  ).join('\n');
  fs.writeFileSync(D('vendor_priority.csv'), csv, 'utf8');

  ensureDir(R('artifacts'));
  fs.writeFileSync(R('artifacts/vendor_priority.json'), JSON.stringify({generated_at: new Date().toISOString(), month: YM, lookback_h: LOOKBACK_H, rows}, null, 2), 'utf8');

  // Console summary
  const top = rows.slice(0, 10).map(r => `${r.vendor}#${r.score}`).join(', ');
  console.log(`vendor_priority: rows=${rows.length}, top10=[${top}]`);
}

(function main(){
  const rows = buildPriority();
  writeOutputs(rows);
})();
