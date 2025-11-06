
import { extractCandidateDomains } from './extract_domains.mjs';
export async function fetchText(url, timeoutMs, userAgent) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent || 'CG-AlertBot/1.0' },
      signal: ctl.signal, redirect: 'follow',
    });
    if (!res.ok) return null;
    return await res.text();
  } catch { return null; } finally { clearTimeout(t); }
}
export async function robotsAllows(origin, path, timeoutMs, userAgent) {
  try {
    const u = new URL(origin); u.pathname = '/robots.txt';
    const txt = await fetchText(u.toString(), timeoutMs, userAgent);
    if (txt === null) return true;
    const lines = txt.split(/\r?\n/).map(s => s.trim().toLowerCase());
    if (lines.some(s => s.startsWith('disallow: /'))) return false;
    return true;
  } catch { return true; }
}
export async function crawlForVendors(seedDomain, allowRegexList, timeoutMs, userAgent, maxPages=6) {
  const origin = `https://${seedDomain}`;
  const ok = await robotsAllows(origin, '/', timeoutMs, userAgent);
  if (!ok) return [];
  const paths = ['/subprocessors','/sub-processor','/dpa','/legal','/policies','/policy','/privacy','/security','/trust','/trust-center','/terms','/pricing','/status'];
  const out = new Set();
  for (const p of paths.slice(0, maxPages)) {
    const url = origin + p;
    const html = await fetchText(url, timeoutMs, userAgent);
    if (!html) continue;
    const domains = extractCandidateDomains(url, html, allowRegexList);
    for (const d of domains) out.add(d);
  }
  return Array.from(out);
}
