#!/usr/bin/env node
/**
 * remove_homepage_pricing_band.js
 * On homepage only: replace any "30k" style pricing with contact CTA,
 * and remove the bottom blue pricing band (heuristic: last 40% section/div containing pricing-ish keywords).
 */
const fs = require('fs'); const path = require('path');
const HOME = path.join('cg-alert-main','index.html');
if(!fs.existsSync(HOME)){ console.error('homepage not found:', HOME); process.exit(1); }
let s = fs.readFileSync(HOME,'utf8');

const CTA = 'Need more? Email <a href="mailto:sales@cg-alert.com">sales@cg-alert.com</a>';

// Replace 30k phrases across homepage
s = s
  .replace(/\$?\s?30\s?,?0?0?0\s*(?:\/\s?yr|\/year)?/gi, CTA)
  .replace(/30k\s*(?:\/\s?yr|\/year)?/gi, CTA)
  .replace(/\$?\s?30,000\+?/gi, CTA);

// Remove bottom band by heuristic
function stripBottomBand(html){
  const regex = /<(section|div)([^>]*?)>([\s\S]*?)<\/\1>/gi;
  let match, last;
  while((match = regex.exec(html))){
    const [full, tag, attrs, inner] = match;
    const idxEnd = regex.lastIndex;
    const inTail = idxEnd > html.length * 0.6;
    const maybeBlue = /(pricing|plans|enterprise|deal|cta|blue|footer-cta|pricing-cta)/i.test(attrs + ' ' + inner);
    const hasCard = /Buy\s+(Portfolio|Renewal|Compliance)|\$2,988|\$6,000|\$12,000/i.test(inner);
    if(inTail && (maybeBlue || hasCard)){
      last = {start: match.index, end: idxEnd, full};
    }
  }
  if(last){
    return html.slice(0, last.start) + html.slice(last.end);
  }
  return html;
}
s = stripBottomBand(s);

// Ensure we add RSS <link> for feed discovery
if(!/rel=["']alternate["'][^>]*application\/rss\+xml/i.test(s)){
  s = s.replace(/<head[^>]*>/i, m => m + '\n<link rel="alternate" type="application/rss+xml" title="CG Alert Feed" href="/rss.xml">');
}

fs.writeFileSync(HOME, s, 'utf8');
console.log('homepage band removed & 30k replaced, RSS link ensured');
