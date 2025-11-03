// scripts/lead_auto_expand.js
/**
 * Low-cost auto expansion: fetch robots.txt -> sitemap(s) -> scan limited pages for mailto.
 * Respects robots; caps total fetches.
 */
const fs = require('fs'); const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const fetch = global.fetch;

const MAX_FETCH = 50;

function readSeeds(){
  const f = 'data/seed_domains.txt';
  if(!fs.existsSync(f)) return [];
  return fs.readFileSync(f,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
}
async function getRobots(domain){
  try{
    const r = await fetch(`https://${domain}/robots.txt`, {redirect:'follow'});
    if(!r.ok) return '';
    return await r.text();
  }catch{return ''}
}
function parseSitemaps(robots){
  const out = [];
  robots.split(/\r?\n/).forEach(l=>{
    const m = /^sitemap:\s*(.+)$/i.exec(l.trim());
    if(m) out.push(m[1].trim());
  });
  return out;
}
async function fetchXml(u){
  const r = await fetch(u, {redirect:'follow'});
  if(!r.ok) return '';
  return await r.text();
}
function pickInterestingUrls(xml){
  const p = new XMLParser({ignoreAttributes:false, attributeNamePrefix:'@_'});
  try{
    const doc = p.parse(xml);
    const urls = (doc?.urlset?.url || []).map(u => u.loc).filter(Boolean);
    return urls.filter(u => /pricing|terms|policy|privacy|dpa|subprocessor|sub-processor|security|status/i.test(u)).slice(0,15);
  }catch{return []}
}
async function fetchPage(u){
  const r = await fetch(u, {redirect:'follow'});
  if(!r.ok) return '';
  return await r.text();
}
function extractEmails(html){
  const out = new Set();
  const re = /mailto:([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
  let m; while((m=re.exec(html))){ out.add(m[1].toLowerCase()); }
  return [...out];
}
function appendLeads(domain, emails){
  if(emails.length===0) return 0;
  const file = 'data/leads.csv';
  if(!fs.existsSync(file)) fs.writeFileSync(file, 'email,name,title,company,domain,region,status\n');
  const exist = new Set(fs.readFileSync(file,'utf8').split(/\r?\n/).map(l => l.split(',')[0].toLowerCase()));
  let added = 0;
  emails.forEach(e => {
    if(exist.has(e)) return;
    const row = [e,'','Legal/Procurement','',''+domain,'','discovered'].join(',') + '\n';
    fs.appendFileSync(file, row); added++;
  });
  return added;
}

(async function main(){
  const seeds = readSeeds();
  let budget = MAX_FETCH, newCount = 0;
  for(const domain of seeds){
    if(budget<=0) break;
    const robots = await getRobots(domain);
    const sitemaps = parseSitemaps(robots);
    for(const sm of sitemaps){
      if(budget<=0) break;
      const xml = await fetchXml(sm); budget--;
      const pages = pickInterestingUrls(xml);
      for(const u of pages){
        if(budget<=0) break;
        const html = await fetchPage(u); budget--;
        const emails = extractEmails(html);
        newCount += appendLeads(domain, emails);
      }
    }
  }
  console.log(`auto-expand done. new_leads=${newCount}`);
})();