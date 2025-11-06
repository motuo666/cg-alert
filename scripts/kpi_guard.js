import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const EVD = path.join(ROOT,'evidence');

async function countEvidenceToday(){
  let n=0;
  try{
    const files = await fs.readdir(EVD);
    const today = new Date().toISOString().slice(0,10);
    for(const f of files){
      if(!f.endsWith('.json')) continue;
      const ts = new Date(parseInt(f.split('-')[0]||Date.now(),10));
      const isToday = ts.toISOString().slice(0,10) === today;
      if(isToday) n++;
    }
  }catch{}
  return n;
}

(async function(){
  const n = await countEvidenceToday();
  const pass = n >= 10;
  console.log(`evidence_today=${n}`);
  if(!pass){
    console.log('::notice::kpi_guard blocked outreach due to insufficient evidence');
    process.exit(2);
  }
})(); 
