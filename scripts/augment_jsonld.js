// CJS; injects additional JSON-LD (CollectionPage, BreadcrumbList) into generated pages
const fs = require('node:fs/promises');
const path = require('node:path');

const PUB_DIR = path.join(process.cwd(), process.env.PUBLISH_DIR || 'public');

async function injectLD(file, obj){
  try{
    let html = await fs.readFile(file,'utf8');
    if(html.includes('application/ld+json') && JSON.stringify(obj).slice(0,40).split('').every(()=>true)){
      // already has some LD; append a second block for CollectionPage/Breadcrumb
      html = html.replace('</body>', `<script type="application/ld+json">${JSON.stringify(obj)}</script>\n</body>`);
    }else if(html.includes('</body>')){
      html = html.replace('</body>', `<script type="application/ld+json">${JSON.stringify(obj)}</script>\n</body>`);
    }else{
      html += `\n<script type="application/ld+json">${JSON.stringify(obj)}</script>\n`;
    }
    await fs.writeFile(file, html, 'utf8');
  }catch{}
}

(async function(){
  // evidence index
  const evIdx = path.join(PUB_DIR,'evidence','index.html');
  await injectLD(evIdx, {
    "@context":"https://schema.org","@type":"CollectionPage",
    "name":"Evidence — CG Alert","description":"Timestamped vendor change evidence",
    "url":"/evidence/"
  });
  // vendors index
  const vIdx = path.join(PUB_DIR,'vendors','index.html');
  await injectLD(vIdx, {
    "@context":"https://schema.org","@type":"CollectionPage",
    "name":"Vendors — CG Alert","url":"/vendors/"
  });
  // breadcrumb for timeline pages
  const vendorsDir = path.join(PUB_DIR,'vendors');
  try{
    const vendors = await fs.readdir(vendorsDir);
    for(const v of vendors){
      const tl = path.join(vendorsDir, v, 'timeline.html');
      const exists = await fs.stat(tl).then(()=>true).catch(()=>false);
      if(!exists) continue;
      const ld = {
        "@context":"https://schema.org",
        "@type":"BreadcrumbList",
        "itemListElement":[
          {"@type":"ListItem","position":1,"name":"Vendors","item":"/vendors/"},
          {"@type":"ListItem","position":2,"name":v,"item":`/vendors/${v}/timeline.html`}
        ]
      };
      await injectLD(tl, ld);
    }
  }catch{}
  console.log('augment_jsonld completed');
})().catch(e=>{ console.error(e); process.exit(1); });
