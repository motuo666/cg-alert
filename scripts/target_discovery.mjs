
import fs from 'node:fs';
import path from 'node:path';
import { crawlForVendors } from './discovery/crawl_vendor.mjs';
const ROOT = process.cwd();
const CONF = JSON.parse(fs.readFileSync(path.join(ROOT,'config/expand_rules.json'),'utf8'));
function rxList(){ return (CONF.allow_paths_regex || []).map(s => new RegExp(s.replace(/\//g,'\\/'),'i')); }
function readLines(p){ try{ return fs.readFileSync(p,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);}catch{return[];} }
function uniq(a){ return Array.from(new Set(a)); }
function eTLD1(h){ const parts=h.split('.'); if(parts.length<=2) return h; const cc=new Set(['uk','jp','au','nz','br','de','fr','it','es','ca','us','in','cn','sg','io','ai']); const last=parts[parts.length-1]; return (cc.has(last)&&parts.length>=3)?parts.slice(-3).join('.'):parts.slice(-2).join('.'); }
async function main(){
  const SEED_FILE = path.join(ROOT,'data/seed_domains.txt');
  const LEADS_CSV = path.join(ROOT,'data/leads.csv');
  let seeds = readLines(SEED_FILE).map(eTLD1);
  if (seeds.length===0 && Array.isArray(CONF.bootstrap_seeds)) seeds = CONF.bootstrap_seeds.map(eTLD1);
  seeds = uniq(seeds).slice(0, CONF.max_seeds_per_run || 30);
  const allow = rxList(); const found = new Set();
  const conc = CONF.concurrency || 4; let idx = 0;
  async function next(){ while(idx<seeds.length){ const s=seeds[idx++]; try{ const list = await crawlForVendors(s, allow, CONF.timeout_ms||15000, CONF.user_agent, CONF.max_pages_per_domain||6); for(const d of list) found.add(d); console.log(`seed=${s} -> ${list.length} candidates`);}catch(e){ console.log(`seed=${s} error: ${e?.message||e}`);} } }
  await Promise.all(Array.from({length: conc}, next));
  const merged = uniq([...seeds, ...Array.from(found)]);
  fs.mkdirSync(path.dirname(SEED_FILE), { recursive: true }); fs.writeFileSync(SEED_FILE, merged.join('\n')+'\n','utf8');
  const ts = new Date().toISOString(); fs.mkdirSync(path.dirname(LEADS_CSV), { recursive: true });
  let out=''; for(const d of found){ out += `${d},${ts},autopilot\n`; } if(out) fs.appendFileSync(LEADS_CSV, out, 'utf8');
  console.log(`discovery_done seeds_in=${seeds.length} new_found=${found.size} merged_total=${merged.length}`);
}
main().catch(e=>{ console.error(e); process.exit(1); });
