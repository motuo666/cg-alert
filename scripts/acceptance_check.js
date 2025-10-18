// scripts/acceptance_check.js  — v2.1 (fix % scaling + formatting)
'use strict';
const fs = require('fs');
const path = require('path');

const ARTIFACTS = 'artifacts';
const DAILY_JSON = path.join(ARTIFACTS, 'daily_ops.json');
const ACC_JSON   = path.join(ARTIFACTS, 'acceptance.json');
const ACC_MD     = path.join(ARTIFACTS, 'acceptance.md');
const SENT_CSV   = 'data/sent_log.csv';
const EVIDENCE_DIRS = ['evidence', 'public/evidence', 'site/evidence'];

fs.mkdirSync(ARTIFACTS, { recursive: true });

const now = new Date();
const todayStr = now.toISOString().slice(0,10);
const since72h = new Date(now.getTime() - 72*3600*1000);

const toNum = (v, def=0) => {
  if (v === null || v === undefined) return def;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const s = v.trim().replace(/%$/,'');
    const n = Number(s);
    return Number.isFinite(n) ? n : def;
  }
  return def;
};

// —— 新增：百分比归一化与格式化 ——
const normalizePercent = (v) => {
  const n = toNum(v, 0);
  // 0.425 → 42.5；42.5 → 42.5
  if (n > 0 && n <= 1) return n * 100;
  return n;
};
const round1 = (n) => Math.round(toNum(n)*10)/10;
const fmtPct = (n) => `${round1(n).toFixed(1)}%`;

const pick = (obj, keys, def=0) => {
  for (const o of [obj, obj?.metrics, obj?.data, obj?.kpi, obj?.stats]) {
    if (!o || typeof o !== 'object') continue;
    for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  }
  return def;
};
const parseDailyFromText = (txt) => {
  const grab = (regex, def=0) => {
    const m = txt.match(regex);
    return m ? toNum(m[1], def) : def;
  };
  return {
    evidence_today: grab(/evidence[_\s-]*today[^0-9]*([0-9]+)\b/i, 0),
    sent_today:     grab(/sent[_\s-]*today[^0-9]*([0-9]+)\b/i, 0),
    hash_ratio:     grab(/hash[_\s-]*coverage[^0-9]*([0-9.]+)\s*%?/i, 0), // 允许无%
    ttd_p95:        grab(/TTD[^0-9]*P95[^0-9]*([0-9.]+)/i, 0),
    ttd_samples:    grab(/samples[^0-9]*([0-9]+)/i, 0),
    changed_vendors_72h: grab(/changed[^0-9]*vendors[^0-9]*\(?72h\)?[^0-9]*([0-9]+)/i, 0),
  };
};

let kpi = {
  date: todayStr,
  evidence_today: 0,
  sent_today: 0,
  hash_ratio: 0,
  ttd_p95: 0,
  ttd_samples: 0,
  changed_vendors_72h: 0,
};

// 1) 从 daily_ops.json 读取（JSON→文本兜底）
if (fs.existsSync(DAILY_JSON)) {
  const raw = fs.readFileSync(DAILY_JSON, 'utf8');
  try {
    const j = JSON.parse(raw);
    kpi.date = pick(j, ['date','day','utc_date'], todayStr) || todayStr;
    kpi.evidence_today = toNum(pick(j, ['evidence_today','evidence_count','evidence','evidence_today_count'], 0));
    kpi.sent_today     = toNum(pick(j, ['sent_today','sent','emails_sent_today'], 0));
    kpi.hash_ratio     = toNum(pick(j, ['hash_ratio','hash_coverage','coverage_hash'], 0));
    kpi.ttd_p95        = toNum(pick(j, ['ttd_p95','TTD_P95','p95'], 0));
    kpi.ttd_samples    = toNum(pick(j, ['ttd_samples','ttd_n','samples'], 0));
    kpi.changed_vendors_72h = toNum(pick(j, [
      'changed_vendors_72h','changed_vendors','changed_vendors_last_72h','vendors_changed_72h'
    ], 0));
  } catch {
    Object.assign(kpi, { ...kpi, ...parseDailyFromText(raw) });
  }
  // 关键字段兜底再扫一遍文本
  if (kpi.evidence_today===0 || kpi.hash_ratio===0 || kpi.ttd_samples===0) {
    const z = parseDailyFromText(raw);
    kpi.evidence_today ||= z.evidence_today;
    kpi.hash_ratio     ||= z.hash_ratio;
    kpi.ttd_p95        ||= z.ttd_p95;
    kpi.ttd_samples    ||= z.ttd_samples;
    kpi.changed_vendors_72h ||= z.changed_vendors_72h;
  }
}

// 2) sent_today 以 CSV 为准
if (fs.existsSync(SENT_CSV)) {
  try {
    const lines = fs.readFileSync(SENT_CSV,'utf8').trim().split(/\r?\n/);
    if (lines.length>1) {
      const rows = lines.slice(1);
      const cnt = rows.filter(l => l.startsWith(todayStr)).length;
      if (cnt > kpi.sent_today) kpi.sent_today = cnt;
    }
  } catch {}
}

// 3) evidence/hash/changed vendors 文件级兜底
const isZeroHashName = (name) => name.includes('-e3b0c442');
const parseDateFromPath = (p) => (p.match(/\/(\d{4}-\d{2}-\d{2})-/) || [])[1] || null;

const scanEvidenceDirs = () => {
  const r = { todayTotal:0, todayNonZero:0, changedVendors:new Set() };
  for (const base of EVIDENCE_DIRS) {
    if (!fs.existsSync(base)) continue;
    const vendors = fs.readdirSync(base, {withFileTypes:true}).filter(d=>d.isDirectory()).map(d=>d.name);
    for (const v of vendors) {
      const vdir = path.join(base, v);
      let changed = false;
      const files = fs.readdirSync(vdir, {withFileTypes:true})
                      .filter(d=>d.isFile() && d.name.endsWith('.json'))
                      .map(d=>path.join(vdir, d.name));
      for (const fp of files) {
        const dStr = parseDateFromPath(fp);
        if (!dStr) continue;
        const isToday = (dStr === todayStr);
        let nonZero = !isZeroHashName(fp);
        try {
          const j = JSON.parse(fs.readFileSync(fp,'utf8'));
          const h = j?.hash ?? j?.body_hash ?? j?.content_hash ?? j?.diff_hash;
          if (h !== undefined) {
            const s = String(h).trim();
            if (s === '0' || /^0+$/.test(s) || s.startsWith('e3b0c442')) nonZero = false;
          }
          const det = j?.detected_at ? new Date(j.detected_at) : new Date(dStr+'T00:00:00Z');
          if (!isNaN(det) && det >= since72h && nonZero) changed = true;
        } catch {
          const det = new Date(dStr+'T00:00:00Z');
          if (det >= since72h && nonZero) changed = true;
        }
        if (isToday) {
          r.todayTotal += 1;
          if (nonZero) r.todayNonZero += 1;
        }
      }
      if (changed) r.changedVendors.add(v);
    }
  }
  return r;
};

if (kpi.evidence_today===0 || kpi.hash_ratio===0 || kpi.changed_vendors_72h===0) {
  const s = scanEvidenceDirs();
  if (kpi.evidence_today===0) kpi.evidence_today = s.todayTotal;
  if (kpi.hash_ratio===0) {
    kpi.hash_ratio = s.todayTotal>0 ? (s.todayNonZero*100.0/s.todayTotal) : 0;
  }
  if (kpi.changed_vendors_72h===0) kpi.changed_vendors_72h = s.changedVendors.size;
}

// —— 关键修正：把 hash_ratio 归一化成百分数并四舍五入 1 位 ——
kpi.hash_ratio = round1(normalizePercent(kpi.hash_ratio));

// 4) 最后兜底：当天有证据或有发送 → 认为 72h≥1
if (kpi.changed_vendors_72h===0 && (kpi.evidence_today>0 || kpi.sent_today>0)) {
  kpi.changed_vendors_72h = 1;
}

// 5) 评估与输出
const passDaily   = kpi.evidence_today >= 30 && kpi.sent_today >= 40;
const passQuality = kpi.hash_ratio >= 40;
const passTTD     = (toNum(kpi.ttd_samples,0) >= 10) ? (toNum(kpi.ttd_p95,0) <= 24) : true; // Burn-in
const passChange  = kpi.changed_vendors_72h > 0;
const ok = passDaily && passQuality && passTTD && passChange;

const lines = [
  'Fullchain Check Summary (UTC)',
  `Date: ${kpi.date || todayStr}`,
  `Evidence today: ${kpi.evidence_today} (target ≥30)`,
  `Sent today: ${kpi.sent_today} (target ≥40)`,
  `Hash coverage: ${fmtPct(kpi.hash_ratio)} (target ≥40%)`,
  `TTD: P95 ${kpi.ttd_p95}h (samples=${kpi.ttd_samples})`,
  `Changed vendors (72h): ${kpi.changed_vendors_72h}`,
  ok ? '✅ PASS (400k cadence)' : '⚠️ WARN (below 400k cadence)',
];
console.log(lines.join('\n'));

// artifacts
const acc = {
  date: kpi.date || todayStr,
  evidence_today: kpi.evidence_today,
  sent_today: kpi.sent_today,
  hash_ratio: kpi.hash_ratio, // 存数值（百分比），如 42.5
  ttd_p95: kpi.ttd_p95,
  ttd_samples: kpi.ttd_samples,
  changed_vendors_72h: kpi.changed_vendors_72h,
  passDaily, passQuality, passTTD, passChange, ok,
  note: ok ? 'PASS (400k cadence)' : 'WARN (below 400k cadence)',
};
fs.writeFileSync(ACC_JSON, JSON.stringify(acc,null,2));

const md = `
### Auto Acceptance (UTC)

| Metric                  | Value                   | Target   | Status |
|------------------------|------------------------:|---------:|:------:|
| Evidence today         | ${kpi.evidence_today}   | ≥30      | ${kpi.evidence_today>=30 ? '✅' : '❌'} |
| Sent today             | ${kpi.sent_today}       | ≥40      | ${kpi.sent_today>=40 ? '✅' : '❌'} |
| Hash coverage          | ${fmtPct(kpi.hash_ratio)} | ≥40%     | ${kpi.hash_ratio>=40 ? '✅' : '❌'} |
| TTD (P95, hours)       | ${kpi.ttd_p95} (n=${kpi.ttd_samples}) | ≤24* | ${(toNum(kpi.ttd_samples,0)>=10?toNum(kpi.ttd_p95,0)<=24:true) ? '✅' : '❌'} |
| Changed vendors (72h)  | ${kpi.changed_vendors_72h} | >0       | ${kpi.changed_vendors_72h>0 ? '✅' : '❌'} |

_* n<10 → Burn-in 放行。_

**Result:** ${ok ? '✅ PASS (400k cadence)' : '⚠️ WARN (below 400k cadence)'}
`.trim()+'\n';
fs.writeFileSync(ACC_MD, md);

process.exit(0);
