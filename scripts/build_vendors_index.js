const { fs, path, slugify, readJSON } = require('./utils.js');
const PUB = path.join(process.cwd(), process.env.PUBLISH_DIR || 'public');
const EVD = path.join(process.cwd(), 'evidence');

function html(title, body){
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>body{font:16px/1.6 -apple-system,Segoe UI,Roboto,Arial;margin:24px;color:#0b0f19}a{color:#0b62f2}</style>
</head><body><main>${body}</main></body></html>`;
}

(async function(){
  const map = new Map();
  try{
    const files = (await fs.readdir(EVD)).filter(f=>f.endsWith('.json'));
    for(const f of files){
      const e = await readJSON(path.join(EVD,f), null);
      if(!e || !e.vendor) continue;
      const v = slugify(e.vendor);
      map.set(v, (map.get(v)||0)+1);
    }
  }catch{}
  const list = Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).map(([v,c])=>`<li><a href="/vendors/${v}/">${v}</a> <small>(${c})</small></li>`).join('');
  await fs.mkdir(path.join(PUB,'vendors'),{recursive:true});
  await fs.writeFile(path.join(PUB,'vendors','index.html'), html('Vendors', `<h1>Vendors</h1><ul>${list}</ul>`), 'utf8');
  console.log('vendors index size', map.size);
})().catch(e=>{ console.error(e); process.exit(1); });
