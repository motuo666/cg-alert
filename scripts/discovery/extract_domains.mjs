
import { parse } from 'node:url';
const SOCIAL = new Set(["facebook.com", "x.com", "twitter.com", "linkedin.com", "instagram.com", "youtube.com", "t.me", "discord.gg", "discord.com"]);
export function extractCandidateDomains(baseUrl, html, allowRegexList) {
  const out = new Set();
  if (!html || typeof html !== 'string') return [];
  const A_RE = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = A_RE.exec(html)) !== null) {
    try {
      const href = m[1];
      const abs = new URL(href, baseUrl);
      const host = abs.hostname.toLowerCase();
      if (!host) continue;
      if (SOCIAL.has(host) || SOCIAL.has(host.replace(/^www\./,''))) continue;
      const ok = allowRegexList.some(rx => rx.test(abs.pathname));
      if (!ok) continue;
      const baseHost = new URL(baseUrl).hostname.toLowerCase();
      if (getETLD1(host) === getETLD1(baseHost) ) continue;
      out.add(getETLD1(host));
    } catch {}
  }
  return Array.from(out);
}
function getETLD1(host) {
  if (!host) return host;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const ccTLD = new Set(['uk','jp','au','nz','br','de','fr','it','es','ca','us','in','cn','sg','io','ai']);
  const last = parts[parts.length-1];
  if (ccTLD.has(last) && parts.length >= 3) {
    return parts.slice(-3).join('.');
  }
  return parts.slice(-2).join('.');
}
