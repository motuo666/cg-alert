#!/usr/bin/env node
const https=require('https'), fs=require('fs'), path=require('path');
const HOST=(process.env.SITE_ORIGIN||'https://www.cg-alert.com').replace(/\/$/,'');
const KEY=process.env.INDEXNOW_KEY||''; if(!KEY){ console.log('INDEXNOW_KEY missing; skip'); process.exit(0); }
const site=fs.readFileSync(path.join('public','sitemap.xml'),'utf8'); const urls=[...site.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m=>m[1]).slice(0,1000);
const payload=JSON.stringify({host:HOST.replace(/^https?:\/\//,''),key:KEY,keyLocation:`${HOST}/indexnow-${KEY}.txt`,urlList:urls});
const req=https.request('https://api.indexnow.org/indexnow',{method:'POST',headers:{'content-type':'application/json'}},res=>{let b='';res.on('data',d=>b+=d);res.on('end',()=>console.log('indexnow',res.statusCode));});
req.on('error',e=>console.error(e)); req.write(payload); req.end();
