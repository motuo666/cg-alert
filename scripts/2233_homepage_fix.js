#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const HOME = path.join('cg-alert-main','index.html');
if(!fs.existsSync(HOME)){ console.error('homepage not found:', HOME); process.exit(0); }
let s = fs.readFileSync(HOME,'utf8'), o = s;
const CTA='Need more? Email <a href="mailto:sales@cg-alert.com">sales@cg-alert.com</a>';
s=s.replace(/\bStarts?\s*\$?\s*30\s*,?0?0?0\s*\/\s*yr\b/gi, CTA)
   .replace(/\b30k\s*(?:\/\s*yr|\/\s*year)?\b/gi, CTA)
   .replace(/\$\s*30,?000\+?/gi, CTA);
(function stripBlue(){
  const rx=/<(section|div)([^>]*?)>([\s\S]*?)<\/\1>/gi; let m,last;
  while((m=rx.exec(s))){
    const nearEnd = rx.lastIndex > s.length*0.6;
    const looks = /(pricing|plans|enterprise|deal|cta|blue|footer-cta|pricing-cta)/i.test((m[2]||'')+' '+(m[3]||''));
    if(nearEnd && looks){ last={start:m.index,end:rx.lastIndex}; }
  }
  if(last){ s = s.slice(0,last.start)+s.slice(last.end); }
})();
if(!/application\/rss\+xml/i.test(s)){
  s = s.replace(/<head[^>]*>/i, m=> m + '\n<link rel="alternate" type="application/rss+xml" href="/rss.xml">');
}
if(s!==o){ fs.writeFileSync(HOME,s,'utf8'); console.log('homepage fixed'); } else { console.log('homepage unchanged'); }
