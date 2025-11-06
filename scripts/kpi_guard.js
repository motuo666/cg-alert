const { fs, path } = require('./utils.js');

const EVD = path.join(process.cwd(), 'evidence');
const MIN = parseInt(process.env.MIN_EVIDENCE_PER_DAY || '10', 10);

(async function(){
  let count = 0;
  const today = new Date().toISOString().slice(0,10);
  try{
    const files = (await fs.readdir(EVD)).filter(f=>f.endsWith('.json'));
    for(const f of files){
      try{
        const j = JSON.parse(await fs.readFile(path.join(EVD,f),'utf8'));
        if(String(j.ts||'').slice(0,10) === today) count++;
      }catch{}
    }
  }catch{}
  const ok = count >= MIN;
  if(process.env.GITHUB_OUTPUT){
    require('node:fs').appendFileSync(process.env.GITHUB_OUTPUT, `ok=${ok}\ncount=${count}\n`);
  }
  console.log('kpi_guard', {count, ok, min: MIN});
  if(!ok){ process.exit(0); } // soft block: succeeding job checks needs.kpi.outputs.ok
})().catch(e=>{ console.error(e); process.exit(1); });
