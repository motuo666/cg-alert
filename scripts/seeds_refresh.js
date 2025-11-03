// scripts/seeds_refresh.js
/**
 * From reports/rss.xml extract cg:sourceUrl hosts, merge into data/seed_domains.txt (dedup, cap length).
 * Config via env: SEEDS_MAX (default 500)
 */
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

const MAX = parseInt(process.env.SEEDS_MAX || '500', 10);

function hostsFromRSS(xml){
  const p = new XMLParser({ignoreAttributes:false, attributeNamePrefix:'@_'});
  const doc = p.parse(xml);
  const items = doc?.rss?.channel?.item || [];
  const arr = Array.isArray(items)?items:[items];
  const out = new Set();
  for(const it of arr){
    const u = it['cg:sourceUrl'] || it['sourceUrl'] || it['link'];
    if(!u) continue;
    try{ out.add(new URL(String(u)).host.toLowerCase()); }catch{}
  }
  return Array.from(out);
}
function loadSeeds(p){
  if(!fs.existsSync(p)) return [];
  return fs.readFileSync(p,'utf8').split(/\r?\n/).map(s=>s.trim().toLowerCase()).filter(Boolean);
}
function saveSeeds(p, list){
  fs.mkdirSync(require('path').dirname(p), {recursive:true});
  fs.writeFileSync(p, list.join('\n')+'\n');
}

(function main(){
  const rssP = 'reports/rss.xml';
  const seedsP = 'data/seed_domains.txt';
  if(!fs.existsSync(rssP)){ console.log('no reports/rss.xml'); return; }
  const xml = fs.readFileSync(rssP,'utf8');
  const hosts = hostsFromRSS(xml);
  const base = loadSeeds(seedsP);
  const set = new Set(base);
  for(const h of hosts){ set.add(h); }
  const merged = Array.from(set).slice(0, MAX).sort();
  saveSeeds(seedsP, merged);
  console.log(`seeds_refresh done. seeds=${merged.length} (cap=${MAX})`);
})();