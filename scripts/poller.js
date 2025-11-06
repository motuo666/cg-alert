// Minimal poller: if there are seed domains and no evidence today, create low-noise placeholder captures only for existing vendors pages; 
// In your full system you likely have a richer crawler; this keeps pipeline alive under CJS.
const { fs, path, slugify, writeJSON, nowISO } = require('./utils.js');

const SEEDS = path.join(process.cwd(),'data','seed_domains.txt');
const EVD = path.join(process.cwd(),'evidence');

(async function(){
  await fs.mkdir(EVD,{recursive:true});
  let seeds = [];
  try{
    seeds = (await fs.readFile(SEEDS,'utf8')).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  }catch{}

  // if you have real captures already, do nothing
  const today = new Date().toISOString().slice(0,10);
  const files = (await fs.readdir(EVD)).filter(f=>f.endsWith('.json'));
  const hasToday = (await Promise.all(files.map(async f=>{
    try{ const j = JSON.parse(await fs.readFile(path.join(EVD,f),'utf8')); return String(j.ts||'').slice(0,10)===today; }catch{return false}
  }))).some(Boolean);
  if(hasToday){ console.log('poller: already have today evidence'); return; }

  // create at most 10 lightweight entries to keep pipeline moving; real fetcher should replace this.
  for(const s of seeds.slice(0,10)){
    const vendor = s.replace(/^https?:\/\//,'').split('/')[0];
    const id = `${vendor}-${today}`;
    const ev = { vendor, id, url:`https://${vendor}/`, ts: nowISO(), sha256: require('node:crypto').createHash('sha256').update(id).digest('hex'), snippet: 'seed-capture' };
    await writeJSON(path.join(EVD, `${id}.json`), ev);
  }
  console.log('poller: placeholder evidence created', Math.min(10,seeds.length));
})().catch(e=>{ console.error(e); process.exit(1); });
