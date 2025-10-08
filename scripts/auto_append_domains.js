// 每周从 data/domain_pool.csv 选 10-20 个未收录域，追加到 data/domains.csv
const fs = require('fs'); const path = require('path');
const { parse } = require('csv-parse/sync'); const { stringify } = require('csv-stringify/sync');

const ROOT = path.join(__dirname, '..');
const POOL = path.join(ROOT, 'data', 'domain_pool.csv');
const OUT  = path.join(ROOT, 'data', 'domains.csv');

const BATCH_MIN = Number(process.env.BATCH_MIN || 10);
const BATCH_MAX = Number(process.env.BATCH_MAX || 20);
const BATCH = Math.max(BATCH_MIN, Math.min(BATCH_MAX, BATCH_MIN + Math.floor(Math.random()*(BATCH_MAX-BATCH_MIN+1))));
const SLACK = process.env.SLACK_WEBHOOK_URL;

function readCsv(fp){
  if (!fs.existsSync(fp)) return [];
  const raw = fs.readFileSync(fp,'utf8').trim();
  if (!raw) return [];
  return parse(raw, { columns:true, skip_empty_lines:true });
}
function writeCsv(fp, rows){
  const csv = stringify(rows, { header:true });
  fs.writeFileSync(fp, csv, 'utf8');
}
function uniqBy(arr, key){
  const seen = new Set(); const out = [];
  for (const x of arr){ const k = key(x); if (seen.has(k)) continue; seen.add(k); out.push(x); }
  return out;
}
async function slack(text){
  if (!SLACK) return;
  try{ await fetch(SLACK, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ text }) }); }catch{}
}

(function main(){
  const pool = readCsv(POOL).map(r=>({domain:(r.domain||'').toLowerCase().trim(), company:r.company||''})).filter(r=>r.domain);
  const cur  = readCsv(OUT).map(r=>({domain:(r.domain||'').toLowerCase().trim(), company:r.company||''})).filter(r=>r.domain);

  const have = new Set(cur.map(r=>r.domain));
  const candidates = pool.filter(r=>!have.has(r.domain));
  // 简单打乱
  for (let i=candidates.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [candidates[i],candidates[j]]=[candidates[j],candidates[i]]; }
  const pick = candidates.slice(0, BATCH);
  const next = uniqBy([...cur, ...pick], x=>x.domain);

  if (pick.length>0) writeCsv(OUT, next);

  const msg = `auto_append_domains: picked=${pick.length}/${BATCH} total=${next.length}`;
  console.log(msg);
  slack(`🧩 Domains updated: +${pick.length} (${pick.map(x=>x.domain).slice(0,5).join(', ')}${pick.length>5?'…':''})`).catch(()=>{});
})();
