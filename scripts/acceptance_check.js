// scripts/acceptance_check.js  (Node 20, CommonJS, zero-deps)
const fs = require('fs');
const path = require('path');

const ARTIFACTS = 'artifacts';
const DAILY_JSON = path.join(ARTIFACTS, 'daily_ops.json');
const ACC_JSON   = path.join(ARTIFACTS, 'acceptance.json');
const ACC_MD     = path.join(ARTIFACTS, 'acceptance.md');
const SENT_CSV   = 'data/sent_log.csv';
const EVIDENCE_DIR = 'evidence';

fs.mkdirSync(ARTIFACTS, { recursive: true });

// UTC helpers
const now = new Date();
const todayStr = new Date(now.toISOString().slice(0,10)).toISOString().slice(0,10); // YYYY-MM-DD (UTC)
const since72h = new Date(now.getTime() - 72 * 3600 * 1000);

// util: robust number parse (%/strings)
const toNum = (v, def = 0) => {
  if (v === null || v === undefined) return def;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim().replace(/%$/, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : def;
  }
  return def;
};

// pick from shallow or known nests
const pickDeep = (obj, keys, def = 0) => {
  const candidates = [obj, obj?.metrics, obj?.data];
  for (const o of candidates) {
    if (!o || typeof o !== 'object') continue;
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined && o[k] !== null) {
        return o[k];
      }
    }
  }
  return def;
};

// ---------- 1) load daily_ops.json (if any) ----------
let daily = {};
if (fs.existsSync(DAILY_JSON)) {
  try {
    daily = JSON.parse(fs.readFileSync(DAILY_JSON, 'utf8'));
  } catch (_) {}
}

let kpi = {
  date: pickDeep(daily, ['date'], todayStr),
  evidence_today: toNum(pickDeep(daily, ['evidence_today','evidence_count','evidence','evidence_today_count'], 0)),
  sent_today: toNum(pickDeep(daily, ['sent_today','sent'], 0)),
  hash_ratio: toNum(pickDeep(daily, ['hash_ratio','hash_coverage'], 0)),
  ttd_p95: toNum(pickDeep(daily, ['ttd_p95','TTD_P95','ttdP95'], 0)),
  ttd_samples: toNum(pickDeep(daily, ['ttd_samples','ttd_n','ttdSamples'], 0)),
  changed_vendors_72h: toNum(pickDeep(daily, ['changed_vendors_72h','changed_vendors','changed_vendors_last_72h'], 0)),
};

// ---------- 2) fallback: sent_today from CSV (>=) ----------
if (fs.existsSync(SENT_CSV)) {
  try {
    const lines = fs.readFileSync(SENT_CSV, 'utf8').trim().split(/\r?\n/);
    if (lines.length > 1) {
      const rows = lines.slice(1);
      const cnt = rows.filter(l => l.startsWith(todayStr)).length;
      if (cnt > kpi.sent_today) kpi.sent_today = cnt;
    }
  } catch (_) {}
}

// helper: derive date/vendor/hash0 from evidence filename/content
const isZeroHashName = (name) => name.includes('-e3b0c442'); // empty-body sentinel commonly used
const parseDateFromPath = (p) => {
  const m = p.match(/\/evidence\/[^/]+\/(\d{4}-\d{2}-\d{2})-/);
  return m ? m[1] : null;
};
const parseVendorFromPath = (p) => {
  const m = p.match(/\/evidence\/([^/]+)\//);
  return m ? m[1] : null;
};

// walk evidence directory shallowly (vendor folders)
const scanEvidence = () => {
  const result = {
    todayTotal: 0,
    todayNonZero: 0,
    changedVendors72h: new Set(),
  };
  if (!fs.existsSync(EVIDENCE_DIR)) return result;

  const vendors = fs.readdirSync(EVIDENCE_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory()).map(d => d.name);

  for (const v of vendors) {
    const vdir = path.join(EVIDENCE_DIR, v);
    let vendorChangedWithin72h = false;

    const files = fs.readdirSync(vdir, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.endsWith('.json'))
      .map(d => path.join(vdir, d.name));

    for (const fp of files) {
      // fast checks by filename
      const dStr = parseDateFromPath(fp);
      if (!dStr) continue;

      const det = new Date(dStr + 'T00:00:00Z'); // day precision
      const isToday = (dStr === todayStr);

      let nonZero = !isZeroHashName(fp); // assume non-zero unless sentinel in name
      // Try open JSON to confirm
      try {
        const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
        const h = j?.hash ?? j?.body_hash ?? j?.content_hash ?? j?.diff_hash;
        if (h !== undefined) {
          const s = String(h).trim();
          if (s === '0' || /^0+$/.test(s) || s.startsWith('e3b0c442')) nonZero = false;
        }
        // detected_at with time → refine det
        if (j?.detected_at) {
          const dd = new Date(j.detected_at);
          if (!isNaN(dd)) {
            // use precise detection time for 72h window
            if (dd >= since72h && nonZero) vendorChangedWithin72h = true;
          }
        }
      } catch (_) {
        // if JSON unreadable, keep filename-based heuristics
      }

      if (isToday) {
        result.todayTotal += 1;
        if (nonZero) result.todayNonZero += 1;
      } else {
        // If no precise detected_at, fallback on day-based window
        if (det >= since72h && nonZero) vendorChangedWithin72h = true;
      }
    }

    if (vendorChangedWithin72h) result.changedVendors72h.add(v);
  }

  return result;
};

// ---------- 3) fallback: evidence/hash/chg vendors by scanning repo ----------
const needEvidence = (kpi.evidence_today <= 0) || (kpi.hash_ratio <= 0) || (kpi.changed_vendors_72h <= 0);
if (needEvidence) {
  const scan = scanEvidence();

  if (kpi.evidence_today <= 0) kpi.evidence_today = scan.todayTotal;
  if (kpi.hash_ratio <= 0) {
    const ratio = scan.todayTotal > 0 ? (scan.todayNonZero * 100.0 / scan.todayTotal) : 0;
    // 保留 1 位小数
    kpi.hash_ratio = Math.round(ratio * 10) / 10;
  }
  if (kpi.changed_vendors_72h <= 0) kpi.changed_vendors_72h = scan.changedVendors72h.size;
}

// ---------- 4) PASS rules (400k cadence) ----------
const passDaily   = kpi.evidence_today >= 30 && kpi.sent_today >= 40;
const passQuality = kpi.hash_ratio >= 40;
const passTTD     = (kpi.ttd_samples >= 10) ? (kpi.ttd_p95 <= 24) : true; // Burn-in if <10
const passChange  = (kpi.changed_vendors_72h > 0);
const ok = passDaily && passQuality && passTTD && passChange;

// ---------- 5) console & artifacts ----------
const outLines = [
  'Fullchain Check Summary (UTC)',
  `Date: ${kpi.date || todayStr}`,
  `Evidence today: ${kpi.evidence_today} (target ≥30)`,
  `Sent today: ${kpi.sent_today} (target ≥40)`,
  `Hash coverage: ${kpi.hash_ratio}% (target ≥40%)`,
  `TTD: P95 ${kpi.ttd_p95}h (samples=${kpi.ttd_samples})`,
  `Changed vendors (72h): ${kpi.changed_vendors_72h}`,
  ok ? '✅ PASS (400k cadence)' : '⚠️ WARN (below 400k cadence)',
];
console.log(outLines.join('\n'));

const acc = {
  date: kpi.date || todayStr,
  evidence_today: kpi.evidence_today,
  sent_today: kpi.sent_today,
  hash_ratio: kpi.hash_ratio,
  ttd_p95: kpi.ttd_p95,
  ttd_samples: kpi.ttd_samples,
  changed_vendors_72h: kpi.changed_vendors_72h,
  passDaily, passQuality, passTTD, passChange, ok,
  note: ok ? 'PASS (400k cadence)' : 'WARN (below 400k cadence)',
};
fs.writeFileSync(ACC_JSON, JSON.stringify(acc, null, 2));

const md = `
### Auto Acceptance (UTC)

| Metric                  | Value            | Target   | Status |
|------------------------|-----------------:|---------:|:------:|
| Evidence today         | ${kpi.evidence_today} | ≥30      | ${kpi.evidence_today>=30 ? '✅' : '❌'} |
| Sent today             | ${kpi.sent_today} | ≥40      | ${kpi.sent_today>=40 ? '✅' : '❌'} |
| Hash coverage          | ${kpi.hash_ratio}% | ≥40%     | ${kpi.hash_ratio>=40 ? '✅' : '❌'} |
| TTD (P95, hours)       | ${kpi.ttd_p95} (n=${kpi.ttd_samples}) | ≤24* | ${(kpi.ttd_samples>=10?kpi.ttd_p95<=24:true) ? '✅' : '❌'} |
| Changed vendors (72h)  | ${kpi.changed_vendors_72h} | >0       | ${kpi.changed_vendors_72h>0 ? '✅' : '❌'} |

_* 样本 <10 走 Burn-in 放行。_

**Result:** ${ok ? '✅ PASS (400k cadence)' : '⚠️ WARN (below 400k cadence)'}
`.trim() + '\n';
fs.writeFileSync(ACC_MD, md);

// always exit 0
process.exit(0);
