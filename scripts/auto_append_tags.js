// 每周从 data/vendor_tags_pool.csv 选 5-10 条未覆盖映射，追加到 data/vendor_tags.csv
const fs = require('fs'); const path = require('path');
const { parse } = require('csv-parse/sync'); const { stringify } = require('csv-stringify/sync');

const ROOT = path.join(__dirname, '..');
const POOL = path.join(ROOT, 'data', 'vendor_tags_pool.csv');
const OUT  = path.join(ROOT, 'data', 'vendor_tags.csv');
const BATCH_MIN = Number(process.env.BATCH_MIN || 5);
const BATCH_MAX = Number(process.env.BATCH_MAX || 10);
const BATCH = Math.max(BATCH_MIN, Math.min(BATCH_MAX, BATCH_MIN + Math.floor(Math.random()*(BATCH_MAX-BATCH_MIN+1))));
const SLACK = process.env.SLACK_WEBHOOK_URL;

function readCsv(fp){ if(!fs.existsSync(fp)) return [];
  const raw=fs.readFileSync(fp,'utf8').trim(); if(!raw) return [];
  return parse(raw,{columns:true, skip_empty_lines:true});
}
function writeCsv(fp, rows){ const csv=stringify(rows,{header:true}); fs.writeFileSync(fp,csv,'utf8'); }
function keyOf(r){ return `${(r.vendor||'').toLowerCase().trim()}::${(r.tag||'').toLowerCase().trim()}`; }
async function slack(text){ if(!SLACK) return; try{ await fetch(SLACK,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}); }catch{} }

(function main(){
  const pool = readCsv(POOL).map(r=>({vendor:(r.vendor||'').trim(), tag:(r.tag||'').trim().toLowerCase()})).filter(r=>r.vendor && r.tag);
  const cur  = readCsv(OUT).map(r=>({vendor:(r.vendor||'').trim(), tag:(r.tag||'').trim().toLowerCase()})).filter(r=>r.vendor && r.tag);

  const have = new Set(cur.map(keyOf));
  const candidates = pool.filter(r=>!have.has(keyOf(r)));

  // 打乱
  for (let i=candidates.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [candidates[i],candidates[j]]=[candidates[j],candidates[i]]; }
  const pick = candidates.slice(0, BATCH);
  const next = [...cur, ...pick];

  if (pick.length>0) writeCsv(OUT, next);

  const msg = `auto_append_tags: picked=${pick.length}/${BATCH} total=${next.length}`;
  console.log(msg);
  slack(`🏷️ Vendor tags updated: +${pick.length} (${pick.map(x=>`${x.vendor}:${x.tag}`).slice(0,5).join(', ')}${pick.length>5?'…':''})`).catch(()=>{});
})();
