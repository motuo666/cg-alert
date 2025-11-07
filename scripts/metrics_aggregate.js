// scripts/metrics_aggregate.js
const fs = require('fs'); const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const mdir = 'data/metrics'; fs.mkdirSync(mdir,{recursive:true});
const outCsv = path.join(mdir, 'summary.csv');
const outJson = path.join(mdir, 'summary.json');

function countLeads(){ try { return Math.max(0, (fs.readFileSync('data/leads.csv','utf8').trim().split(/\r?\n/).length-1)); } catch { return 0; } }
function countSuppress(){ try { return fs.readFileSync('data/suppressions.csv','utf8').trim().split(/\r?\n/).filter(Boolean).length; } catch { return 0; } }
function countRss(){ try { const xml=fs.readFileSync('reports/rss/index.xml','utf8'); const p=new XMLParser({ignoreAttributes:false,attributeNamePrefix:'@_'}); const doc=p.parse(xml); const items=doc?.rss?.channel?.item; return Array.isArray(items)?items.length:(items?1:0);} catch { return 0; } }
function today(){ return new Date().toISOString().slice(0,10); }

function parseEvents(){
  try{
    const lines = fs.readFileSync(path.join(mdir,'events.log'),'utf8').trim().split(/\r?\n/);
    const last30 = lines.slice(-5000); // keep recent
    let sent=0, attempts=0;
    for(const L of last30){
      const m = /,outreach,attempts=(\d+),sent=(\d+),/.exec(L);
      if(m){ attempts += +m[1]; sent += +m[2]; }
    }
    return { attempts, sent };
  }catch{ return { attempts:0, sent:0 }; }
}

(function main(){
  const summary = {
    date: today(),
    leads: countLeads(),
    suppressions: countSuppress(),
    rss_items: countRss(),
    outreach: parseEvents()
  };
  const csvLine = `${summary.date},${summary.leads},${summary.suppressions},${summary.rss_items},${summary.outreach.attempts},${summary.outreach.sent}\n`;
  const csvHeader = 'date,leads,suppressions,rss_items,outreach_attempts,outreach_sent\n';
  if(!fs.existsSync(outCsv)) fs.writeFileSync(outCsv, csvHeader);
  fs.appendFileSync(outCsv, csvLine);
  fs.writeFileSync(outJson, JSON.stringify(summary,null,2));
  console.log('[metrics]', summary);
})();