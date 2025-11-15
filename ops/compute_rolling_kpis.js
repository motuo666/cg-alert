// ops/compute_rolling_kpis.js
// Reads CSV-like inputs and computes rolling KPIs.
// Enhancement: also writes JSON snapshots to ops/kpi/YYYYMMDD.json and ops/kpi/latest.json

const fs = require('fs');
const path = require('path');

function parseCSV(t) {
  const [hdr, ...rows] = t.split(/\r?\n/).filter(Boolean);
  const head = hdr.split(',').map(s=>s.trim());
  return rows.map(line => {
    const cols = line.split(',').map(s=>s.trim());
    const o = {};
    head.forEach((k,i) => o[k] = cols[i] ?? '');
    return o;
  });
}

function pct(n, d) {
  if (!d || d === 0) return 0;
  return Math.round((n*10000)/d)/100; // 2 decimals
}

function todayStamp() {
  const d = new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth()+1).padStart(2,'0');
  const dd = String(d.getUTCDate()).padStart(2,'0');
  return `${yyyy}${mm}${dd}`;
}

function safeMkdir(p) {
  fs.mkdirSync(p, { recursive: true });
}

(function main(){
  try {
    const sent = fs.existsSync('ops/sent.csv') ? fs.readFileSync('ops/sent.csv','utf8') : 'ts,count\n';
    const unsub = fs.existsSync('ops/unsub.csv') ? fs.readFileSync('ops/unsub.csv','utf8') : 'ts,count\n';
    const bounce = fs.existsSync('ops/bounce.csv') ? fs.readFileSync('ops/bounce.csv','utf8') : 'ts,count\n';
    const complain = fs.existsSync('ops/complaint.csv') ? fs.readFileSync('ops/complaint.csv','utf8') : 'ts,count\n';

    const S = parseCSV(sent);
    const U = parseCSV(unsub);
    const B = parseCSV(bounce);
    const C = parseCSV(complain);

    const sent7 = S.slice(-7).reduce((a,b)=>a + (+b.count||0), 0);
    const unsub7 = U.slice(-7).reduce((a,b)=>a + (+b.count||0), 0);
    const bounce7 = B.slice(-7).reduce((a,b)=>a + (+b.count||0), 0);
    const complain7 = C.slice(-7).reduce((a,b)=>a + (+b.count||0), 0);

    const unsub7_pct = pct(unsub7, sent7);
    const bounce7_pct = pct(bounce7, sent7);
    const complaint7_pct = pct(complain7, sent7);

    const ok = (unsub7_pct <= 1.5) && (bounce7_pct <= 2.0) && (complaint7_pct <= 0.2);
    const reason = ok ? 'ok' : 'kpi_threshold_violation';

    const out = {
      ok, reason,
      sent7, unsub7, bounce7, complain7,
      unsub7_pct, bounce7_pct, complaint7_pct,
      generated_at: new Date().toISOString()
    };

    // Write JSON snapshots
    const kpiDir = path.join('ops','kpi');
    safeMkdir(kpiDir);
    const stamp = todayStamp();
    fs.writeFileSync(path.join(kpiDir, `${stamp}.json`), JSON.stringify(out, null, 2));
    fs.writeFileSync(path.join(kpiDir, `latest.json`), JSON.stringify(out, null, 2));

    // Also export GITHUB_OUTPUT if available
    if (process.env.GITHUB_OUTPUT) {
      const lines = [
        `ok=${ok}`,
        `reason=${reason}`,
        `sent7=${sent7}`,
        `unsub7_pct=${unsub7_pct}`,
        `bounce7_pct=${bounce7_pct}`,
        `complaint7_pct=${complaint7_pct}`
      ];
      fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join('\n') + '\n');
    }

    console.log(JSON.stringify(out));
  } catch (err) {
    console.error('[compute_rolling_kpis] error:', err && err.stack || err);
    process.exit(1);
  }
})();
