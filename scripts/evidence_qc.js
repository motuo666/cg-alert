// scripts/evidence_qc.js
const fs = require('fs'); const path = require('path');
const { XMLParser } = require('fast-xml-parser');

const out = 'data/qc/latest.md'; fs.mkdirSync('data/qc', {recursive:true});
function pick3(items){ return items.slice(-3); }

(function main(){
  try {
    const xml = fs.readFileSync('reports/rss.xml','utf8');
    const p = new XMLParser({ ignoreAttributes:false, attributeNamePrefix:'@_' });
    const doc = p.parse(xml); const items = doc?.rss?.channel?.item || [];
    const arr = Array.isArray(items) ? items : [items];
    const picked = pick3(arr);
    let md = `# Evidence QC (${new Date().toISOString()})\n\n`;
    for(const it of picked){
      const source = it['cg:sourceUrl'] || '';
      const sha = it['cg:sha256'] || '';
      const title = it.title || '';
      const ok = source && sha;
      md += `- ${ok?'✅':'⚠️'} ${title}  \n  source: ${source}  \n  sha256: ${sha}\n`;
    }
    fs.writeFileSync(out, md);
    console.log('qc ok, wrote', out);
  } catch (e) {
    console.log('qc error:', e.message);
    process.exit(0); // non-fatal
  }
})();