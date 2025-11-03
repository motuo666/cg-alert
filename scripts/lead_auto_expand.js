// scripts/lead_auto_expand.js (configurable width)
const fs = require('fs'); const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const fetch = global.fetch;

function loadJSON(p, fb){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{ return fb; } }
const rules = loadJSON('config/expand_rules.json', {"mode":"balanced","keywords":{"balanced":["pricing","terms","dpa","subprocessors","security","status"]},"max_fetch":50});

const MODE = (process.env.AUTOEXPAND_MODE || rules.mode || 'balanced').toLowerCase();
const KEYWORDS = (rules.keywords && rules.keywords[MODE]) ? rules.keywords[MODE] : (rules.keywords?.balanced || ["pricing","terms","dpa","subprocessors"]);
const MAX_FETCH = parseInt(process.env.AUTOEXPAND_MAX_FETCH || rules.max_fetch || '50', 10);

function buildRegex(words){
  const esc = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp("(" + esc.map(w => `/${w}(\\/|$)`).join("|") + ")", "i");
}
const URL_RE = buildRegex(KEYWORDS);

function readSeeds(){
  const f = 'data/seed_domains.txt';
  if(!fs.existsSync(f)) return [];
  return fs.readFileSync(f,'utf8').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
}
async function fetchText(u){
  try{
    const r = await fetch(u, {redirect:'follow'});
    if(!r.ok) return '';
    return await r.text();
  }catch{return ''}
}
async function getRobots(domain){ return await fetchText(`https://${domain}/robots.txt`); }
function parseSitemaps(robots){
  const out = [];
  robots.split(/\r?\n/).forEach(l=>{ const m=/^sitemap:\s*(.+)$/i.exec(l.trim()); if(m) out.push(m[1].trim()); });
  return out;
}
function pickRelevant(xmlOrHtml, isXml){
  if(isXml){
    try{
      const p = new XMLParser({ignoreAttributes:false, attributeNamePrefix:'@_'});
      const doc = p.parse(xmlOrHtml); const urls = (doc?.urlset?.url || []).map(u => u.loc).filter(Boolean);
      return urls.filter(u => URL_RE.test(u)).slice(0, 20);
    }catch{return []}
  } else {
    const links = Array.from(xmlOrHtml.matchAll(/href="([^"]+)"/gi)).map(m=>m[1]);
    return links.filter(u => /^https?:\/\//.test(u) && URL_RE.test(u)).slice(0, 20);
  }
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
    const row = [e,'','Legal/Procurement','',domain,'','discovered'].join(',') + '\n';
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
    if(sitemaps.length===0){
      const html = await fetchText(`https://${domain}`); budget--;
      const links = pickRelevant(html, false);
      for(const u of links){
        if(budget<=0) break;
        const page = await fetchText(u); budget--;
        newCount += appendLeads(domain, extractEmails(page));
      }
      continue;
    }
    for(const sm of sitemaps){
      if(budget<=0) break;
      const xml = await fetchText(sm); budget--;
      const pages = pickRelevant(xml, true);
      for(const u of pages){
        if(budget<=0) break;
        const html = await fetchText(u); budget--;
        newCount += appendLeads(domain, extractEmails(html));
      }
    }
  }
  console.log(`auto-expand(${MODE}) done. new_leads=${newCount} budget_left=${budget}`);
})();