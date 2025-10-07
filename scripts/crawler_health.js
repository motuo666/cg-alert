// scripts/crawler_health.js
const fs = require('fs');
const path = require('path');

function listFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  (function walk(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push({ p, st });
    }
  })(dir);
  return out;
}

async function main() {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const files = listFiles('evidence').filter((f) => f.p.endsWith('.json'));

  let lastTs = 0;
  let last24 = 0;
  for (const f of files) {
    const m = f.st.mtimeMs;
    if (m > lastTs) lastTs = m;
    if (now - m <= DAY) last24++;
  }

  const ageH = lastTs ? ((now - lastTs) / 3600000).toFixed(1) : '∞';

  // 可选：异常队列与错误
  let queueLen = 0;
  if (fs.existsSync('queue/abnormal.jsonl')) {
    const txt = fs.readFileSync('queue/abnormal.jsonl', 'utf8').trim();
    queueLen = txt ? txt.split(/\r?\n/).length : 0;
  }
  let err24 = 0;
  if (fs.existsSync('logs/errors.log')) {
    const lines = fs.readFileSync('logs/errors.log', 'utf8').trim().split(/\r?\n/);
    const since = now - DAY;
    for (const line of lines) {
      const m = line.match(/\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)\b/);
      if (m) {
        const t = Date.parse(m[1]);
        if (!isNaN(t) && t >= since) err24++;
      }
    }
  }

  const alerts = [];
  if (!lastTs || parseFloat(ageH) > 48) alerts.push('证据中断>48h');
  if (last24 === 0) alerts.push('近24h无证据');
  if (queueLen > 50) alerts.push('异常队列过长');

  const lines = [
    '*Crawler Health*',
    `• Evidence last 24h: ${last24}`,
    `• Latest evidence age: ${ageH}h`,
    `• Queue abnormal: ${queueLen}`,
    `• Errors (24h): ${err24}`,
    alerts.length ? `→ ⚠️ ${alerts.join(' / ')}（建议暂停扩量，先查抓取）` : '→ ✅ 正常'
  ];

  await fetch(process.env.SLACK_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: lines.join('\n') })
  });

  // 产出简报文件（可用于透明度页）
  const out = {
    ts: new Date().toISOString(),
    last24,
    latest_age_hours: lastTs ? parseFloat(ageH) : null,
    queueLen,
    err24,
    alerts
  };
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync('reports/health.json', JSON.stringify(out, null, 2));
}

main().catch(async (e) => {
  try {
    await fetch(process.env.SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `Crawler Health error: ${e}` })
    });
  } catch {}
  process.exit(1);
});
