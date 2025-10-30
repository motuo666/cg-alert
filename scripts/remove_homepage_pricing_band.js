#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const files = ['cg-alert-main/index.html','index.html'];
const CTA='Need more? Email <a href="mailto:sales@cg-alert.com">sales@cg-alert.com</a>';
for(const f of files){
  if(!fs.existsSync(f)) continue;
  let s = fs.readFileSync(f,'utf8'), out=s;
  // Replace 30k variants
  out = out
    .replace(/\bStarts?\s*\$?\s*30\s*,?0?0?0\s*\/\s*yr\b/gi, CTA)
    .replace(/\b30k\s*(?:\/\s*yr|\/\s*year)?\b/gi, CTA)
    .replace(/\$\s*30,?000\+?/gi, CTA);
  // Remove bottom pricing band (heuristic: last 40% section/div with blue/pricing keywords)
  function strip(html){
    const rx=/<(section|div)([^>]*?)>([\s\S]*?)<\/\1>/gi; let m,last;
    while((m=rx.exec(html))){
      const attrs=m[2], inner=m[3];
      const tail = rx.lastIndex > html.length*0.6;
      const looks=/pricing|plans|enterprise|deal|cta|blue|footer-cta|pricing-cta/i.test(attrs+' '+inner);
      if(tail && looks){ last={start:m.index,end:rx.lastIndex}; }
    }
    return last ? html.slice(0,last.start)+html.slice(last.end) : html;
  }
  out = strip(out);
  if(out!==s){ fs.writeFileSync(f,out,'utf8'); console.log('homepage adjusted:', f); }
}
console.log('homepage pricing/footer band check done');
