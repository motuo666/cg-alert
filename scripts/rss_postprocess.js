// scripts/rss_postprocess.js
const fs = require('fs'), path = require('path');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');

const RSS = path.join(process.cwd(), 'reports', 'rss.xml');
const XSL = path.join(process.cwd(), 'reports', 'rss.xsl');
const CGNS = 'https://www.cg-alert.com/ns';
const PI = '<?xml-stylesheet type="text/xsl" href="/reports/rss.xsl"?>';

function ensureXsl(){
  if(!fs.existsSync(XSL)){
    fs.mkdirSync(path.dirname(XSL), {recursive:true});
    fs.writeFileSync(XSL, `<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:cg="https://www.cg-alert.com/ns">
  <xsl:output method="html" encoding="UTF-8" indent="yes"/>
  <xsl:param name="brandColor" select="'#0b1533'"/>
  <xsl:param name="accentColor" select="'#3b5bdb'"/>
  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title><xsl:value-of select="rss/channel/title"/> — RSS</title>
        <style>
          :root { --brand: #0b1533; --accent: #3b5bdb; }
          body{font:16px/1.65 -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:var(--brand);background:#fff;margin:0}
          header{position:sticky;top:0;background:var(--brand);color:#fff;padding:12px 16px;font-weight:600}
          header a{color:#fff;text-decoration:none;margin-right:16px}
          .wrap{max-width:1100px;margin:24px auto;padding:0 16px;}
          h1{margin:0 0 6px 0}
          .meta{color:#5b6a8a;margin:0 0 16px 0}
          table{width:100%;border-collapse:collapse;margin:12px 0;box-shadow:0 1px 3px rgba(0,0,0,.06);}
          th,td{text-align:left;padding:12px 10px;border-bottom:1px solid #e8edf7;vertical-align:top;font-size:15px}
          th{background:#f6f9ff;color:#243a6b;font-size:13px;text-transform:uppercase;letter-spacing:.02em}
          tr:hover td{background:#fafcff}
          a.item{color:var(--brand);text-decoration:none;font-weight:600}
          .badge{display:inline-block;background:#eef3ff;color:var(--accent);border:1px solid #d7e2ff;padding:2px 8px;border-radius:999px;font-size:12px;margin-left:8px}
          .desc{color:#2d3b59}
          .small{font-size:12px;color:#5b6a8a}
          code{background:#f4f7ff;padding:2px 4px;border-radius:4px}
          .nowrap{white-space:nowrap;}
          .url a{color:var(--accent)}
        </style>
      </head>
      <body>
        <header>
          <a href="/">CG&nbsp;Alert</a>
          <a href="/#pricing">Pricing</a>
          <a href="/reports/">Reports</a>
          <a href="/reports/rss/">RSS</a>
        </header>
        <div class="wrap">
          <h1><xsl:value-of select="rss/channel/title"/></h1>
          <p class="meta">
            <b><xsl:value-of select="count(rss/channel/item)"/></b> items ·
            Updated <xsl:value-of select="rss/channel/lastBuildDate"/>
          </p>
          <table>
            <thead>
              <tr>
                <th>Title</</th>
                <th>Summary</th>
                <th class="nowrap">When</th>
                <th>Source URL</th>
                <th>SHA256</th>
              </tr>
            </thead>
            <tbody>
              <xsl:for-each select="rss/channel/item">
                <tr>
                  <td>
                    <a class="item"><xsl:attribute name="href"><xsl:value-of select="link"/></xsl:attribute><xsl:value-of select="title"/></a>
                    <xsl:if test="category"><span class="badge"><xsl:value-of select="category"/></span></xsl:if>
                  </td>
                  <td class="desc"><xsl:value-of select="description" disable-output-escaping="yes"/></td>
                  <td class="small nowrap"><xsl:value-of select="pubDate"/></td>
                  <td class="url small"><a target="_blank" rel="noopener"><xsl:attribute name="href"><xsl:value-of select="cg:source | source | link"/></xsl:attribute><xsl:value-of select="cg:source | source | link"/></a></td>
                  <td class="small"><xsl:value-of select="cg:sha256 | sha256"/></td>
                </tr>
              </xsl:for-each>
            </tbody>
          </table>
          <p class="small">Raw feed URL: <code>https://www.cg-alert.com/reports/rss.xml</code></p>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
`);
  }
}
function read(){ return fs.existsSync(RSS) ? fs.readFileSync(RSS,'utf8') : ''; }
function write(s){ fs.writeFileSync(RSS, s); console.log('rss.xml updated'); }

function ensurePi(xml){
  if(!xml) return '';
  xml = xml.replace(/<\?xml-stylesheet[^>]*\?>\s*/ig,''); // drop dup
  if(!/^\s*<\?xml\s/i.test(xml)) xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + xml;
  return xml.replace(/(^\s*<\?xml[^>]*\?>)/i, `$1\n${PI}`);
}

function pick(v){
  if(v==null) return null;
  if(typeof v==='string') return v;
  if(typeof v==='object' && '@_href' in v) return v['@_href'];
  return String(v);
}

function transform(doc){
  if(doc.rss){
    doc.rss['@_version'] = doc.rss['@_version'] || '2.0';
    doc.rss['@_xmlns:cg'] = doc.rss['@_xmlns:cg'] || CGNS;
    let ch = doc.rss.channel || (doc.rss.channel={});
    let items = ch.item || [];
    if(!Array.isArray(items)) items=[items];
    items.forEach(it=>{
      if(!it) return;
      if(!('cg:sourceUrl' in it)){
        const src = pick(it['cg:source']) || pick(it.source) || pick(it.link);
        if(src) it['cg:sourceUrl'] = src;
      }
      if(!('cg:sha256' in it)){
        let sha = it.sha256 || null;
        const cat = it.category;
        if(Array.isArray(cat)){
          for(const c of cat){ if(c && c['@_term']==='sha256' && c['@_label']){ sha=c['@_label']; break; } }
        }else if(cat && cat['@_term']==='sha256' && cat['@_label']) sha=cat['@_label'];
        if(sha) it['cg:sha256']=sha;
      }
    });
    ch.item=items;
  }
  return doc;
}

function main(){
  ensureXsl();
  let xml = read();
  if(!xml){ console.log('rss.xml not found, skip'); return; }
  const parser = new XMLParser({ ignoreAttributes:false, attributeNamePrefix:'@_', preserveOrder:false });
  let doc = parser.parse(xml);
  doc = transform(doc);
  const builder = new XMLBuilder({ ignoreAttributes:false, attributeNamePrefix:'@_', format:true, suppressEmptyNode:true });
  let out = builder.build(doc);
  out = ensurePi(out);
  write(out);
}
main();
