#!/usr/bin/env node
const fs=require('fs'), path=require('path');
function ensure(p){ fs.mkdirSync(path.dirname(p),{recursive:true}); }
function shell(title, body){ return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="canonical" href="/vendors/">
<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;background:#0b1020;color:#e5e9ff}
header{padding:18px 16px;background:#0f1530;border-bottom:1px solid #26314a}h1{font-size:20px;margin:0}
main{max-width:980px;margin:18px auto;padding:0 16px 48px}.card{background:#121933;border:1px solid #26314a;border-radius:14px;padding:14px 16px;margin:14px 0}
a{color:#7fb3ff;text-decoration:none}.meta{opacity:.8;font-size:12px;margin:6px 0 0}</style>
<header><h1>${title}</h1></header><main>${body}</main>`; }
const ROOT=process.cwd(), VROOT=path.join(ROOT,'public','vendors');
if(!fs.existsSync(VROOT)){ console.log('no vendors dir'); process.exit(0); }
for(const vendor of fs.readdirSync(VROOT)){
  const vd = path.join(VROOT, vendor);
  if(!fs.statSync(vd).isDirectory()) continue;
  const ch = path.join(vd,'changes'); if(!fs.existsSync(ch)) continue;
  const days = fs.readdirSync(ch).filter(x=>/^\\d{4}-\\d{2}-\\d{2}$/.test(x)).sort();
  const recent = days.slice(-365);
  let body = `<div class=card><b>${vendor}</b><div class=meta>Recent ${recent.length} days</div><ul>` + recent.reverse().map(d=>`<li><a href="/vendors/${vendor}/changes/${d}/">${d}</a></li>`).join('') + `</ul></div>`;
  const out = path.join(vd,'timeline','index.html'); ensure(out); fs.writeFileSync(out, shell(`${vendor} — timeline`, body));
}
console.log('timeline built');
