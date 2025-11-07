#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
function* walkReports(){
  const rep = 'reports'; if(!fs.existsSync(rep)) return;
  for(const ym of fs.readdirSync(rep)){
    const p = path.join(rep, ym);
    if(!/^\d{4}-\d{2}$/.test(ym) || !fs.statSync(p).isDirectory()) continue;
    for(const v of fs.readdirSync(p)){
      const idx = path.join(p, v, 'index.html');
      if(fs.existsSync(idx)){ const stat = fs.statSync(idx); yield { vendor: v, ym, mtime: stat.mtime, url: `${ORIGIN}/reports/${ym}/${v}/` }; }
    }
  }
}
const all = Array.from(walkReports()).sort((a,b)=>b.mtime-a.mtime).slice(0,100);
const items = all.map(i=>`<item><title>${i.vendor} changes — ${i.ym}</title><link>${i.url}</link></item>`).join('\n');
const xml = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
<title>CG Alert — Weekly Vendor Change Radar</title><link>${ORIGIN}/reports/</link><description>Top recent vendor change packs</description>
${items}
</channel></rss>`;
fs.mkdirSync('rss',{recursive:true}); fs.writeFileSync('rss/index.xml', xml, 'utf8'); console.log('wrote rss.xml (root)');
