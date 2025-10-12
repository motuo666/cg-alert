#!/usr/bin/env node
/**
 * collect_evidence.js — 公开页面采集器（加固版）
 * - 尊重 robots.txt（User-agent: CGAlertBot）
 * - data/domains.csv：每行 "domain" 或 "domain,slug"（无表头！）
 * - 容错：非法域名直接跳过；网络错误重试；单站失败不影响全局
 * - 产出：evidence/<slug>/<YYYY-MM-DD>.json（仅当日首次发现差异才追加一行）
 * - 状态：data/evidence_state.json（url -> last_hash）
 * - 依赖：Node 18+（内置 fetch/crypto）；零第三方包
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const UA = process.env.USER_AGENT || 'CGAlertBot/1.0 (+https://www.cg-alert.com)';
const ROOT = path.join(__dirname, '..');
const SITE = 'https://www.cg-alert.com';
const RETRIES = Number(process.env.RETRIES || 3);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 12000);

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function read(p, d=''){ try { return fs.readFileSync(p,'utf8'); } catch { return d; } }
function write(p, s){ ensureDir(path.dirname(p)); fs.writeFileSync(p, s); }
function lines(s){ return s.split(/\r?\n/).map(x=>x.trim()).filter(Boolean); }
function today(){ return new Date().toISOString().slice(0,10); }
function slugify(s){ return s.toLowerCase().replace(/^www\./,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
function sha256(s){ return crypto.createHash('sha256').update(s).digest('hex'); }
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));

function isLikelyDomain(d){
  if (!d) return false;
  if (d.startsWith('http://') || d.startsWith('https://')) return false;
  if (/[^\w\.\-]/.test(d)) return false;           // 只允许字母数字点连字符
  if (!d.includes('.')) return false;               // 必须有 .
  const low = d.toLowerCase();
  const banned = new Set(['domain','localhost','example.com','example.org','example.net','invalid','test','local']);
  if (banned.has(low)) return false;
  return true;
}

// 读取 domains.csv
function readDomains(){
  const p = path.join(ROOT, 'data','domains.csv');
  if (!fs.existsSync(p)) return [];
  const out = [];
  for (const row of lines(read(p))) {
    if (row.startsWith('#') || row.toLowerCase().startsWith('domain')) continue; // 忽略表头/注释
    const [domainRaw, customSlugRaw] = row.split(',').map(x=>x && x.trim());
    const domain = (domainRaw || '').toLowerCase();
    if (!isLikelyDomain(domain)) { console.log(`[skip] invalid domain row: "${row}"`); continue; }
    const slug = customSlugRaw && customSlugRaw.length
      ? slugify(customSlugRaw)
      : slugify(domain.replace(/\.[a-z0-9\-]+$/,''));
    out.push({ domain, slug });
  }
  // 去重
  const seen = new Set(); const dedup = [];
  for (const d of out) { const k = d.domain; if (seen.has(k)) continue; seen.add(k); dedup.push(d); }
  return dedup;
}

// 候选路径
const PATHS = {
  pricing: ['/pricing','/plans','/plan'],
  tos: ['/terms','/terms-of-service','/legal/terms','/legal/terms-of-service','/tos'],
  dpa: ['/dpa','/legal/dpa','/data-processing-addendum','/gdpr/dpa'],
  subprocessors: ['/subprocessors','/sub-processors','/legal/subprocessors','/gdpr/subprocessors'],
  status: ['/status'] // 另尝试 status.<domain>
};

const robotsCache = new Map();
async function fetchWithRetry(url, opt={}){
  let attempt = 0, lastErr = null;
  while (attempt < RETRIES) {
    attempt++;
    const ctrl = new AbortController();
    const t = setTimeout(()=>ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        ...opt,
        headers: { 'User-Agent': UA, ...(opt.headers||{}) },
        redirect: 'follow',
        signal: ctrl.signal
      });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      const body = await res.text();
      return { ok: true, body, ct };
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < RETRIES) await sleep(300 * attempt);
    }
  }
  return { ok: false, err: lastErr };
}

// 极简 robots 解析
function parseRobots(txt){
  const lines = txt.split(/\r?\n/);
  const groups = []; let cur = null;
  for (const raw of lines){
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf(':'); if (i === -1) continue;
    const key = line.slice(0,i).trim().toLowerCase();
    const val = line.slice(i+1).trim();
    if (key === 'user-agent'){ cur = { agents:[val.toLowerCase()], rules: [] }; groups.push(cur); }
    else if ((key === 'allow' || key === 'disallow') && cur){ cur.rules.push({ type:key, path:val }); }
  }
  return { groups };
}
async function getRobots(origin){
  if (robotsCache.has(origin)) return robotsCache.get(origin);
  const r = await fetchWithRetry(`${origin}/robots.txt`);
  if (!r.ok) { robotsCache.set(origin, { allowAll: true }); return robotsCache.get(origin); }
  const parsed = parseRobots(r.body);
  robotsCache.set(origin, parsed);
  return parsed;
}
function isAllowed(robots, ua, pathname){
  if (!robots || robots.allowAll) return true;
  const uaLower = ua.toLowerCase();
  let cand = (robots.groups||[]).filter(g => g.agents.some(a => a === uaLower));
  if (!cand.length) cand = (robots.groups||[]).filter(g => g.agents.some(a => a === '*'));
  if (!cand.length) return true;
  const rules = cand.flatMap(g => g.rules || []);
  let best = { len: -1, allow: true };
  for (const r of rules){
    const p = r.path || '/';
    if (pathname.startsWith(p) && p.length > best.len){
      best = { len: p.length, allow: r.type === 'allow' };
    }
  }
  return best.allow;
}

function extractText(html, contentType=''){
  if (/json/i.test(contentType)) return html;
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<!--[\s\S]*?-->/g, '')
              .replace(/<[^>]+>/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
function typeOfURL(url){
  const l = url.toLowerCase();
  if (l.includes('pricing') || l.endsWith('/plans')) return 'pricing';
  if (l.includes('terms')) return 'tos';
  if (l.includes('/dpa') || l.includes('data-processing')) return 'dpa';
  if (l.includes('subprocessor')) return 'subprocessors';
  if (l.includes('status')) return 'status';
  return 'other';
}

function loadState(){
  const p = path.join(ROOT,'data','evidence_state.json');
  try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{ return { urls: {} }; }
}
function saveState(st){
  const p = path.join(ROOT,'data','evidence_state.json');
  ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(st, null, 2));
}

function candidateURLs(domain){
  const urls = new Set();
  const add = (u)=> urls.add(u.replace(/\/+$/,''));
  for (const arr of Object.values(PATHS)) arr.forEach(p => add(`https://${domain}${p}`));
  add(`https://status.${domain}`); add(`https://status.${domain}/`);
  return [...urls];
}

async function crawlOneHost(domain){
  const origin = `https://${domain}`;
  const robots = await getRobots(origin);
  const out = [];
  const all = candidateURLs(domain);

  for (const u of all){
    try {
      const uObj = new URL(u);
      const rob = (uObj.origin === origin) ? robots : await getRobots(uObj.origin);
      if (!isAllowed(rob, UA, uObj.pathname)) { console.log(`[robots] disallow ${u}`); continue; }
      const r = await fetchWithRetry(u);
      if (!r.ok) { console.log(`[fetch] fail ${u} :: ${(r.err && r.err.message) || 'error'}`); continue; }
      const text = extractText(r.body, r.ct);
      if (!text) continue;
      out.push({ url: u, text, hash: sha256(text), type: typeOfURL(u) });
    } catch (e) {
      console.log(`[skip] ${u} :: ${e.message}`);
    }
  }
  return out;
}

async function main(){
  const domains = readDomains();
  if (!domains.length){
    console.log('[collect] data/domains.csv 为空或全是非法行；请先追加目标域。');
    process.exit(0);
  }
  const state = loadState();
  const todayStr = today();
  let newCount = 0;

  for (const { domain, slug } of domains){
    console.log(`[crawl] ${domain} (${slug})`);
    let items = [];
    try {
      items = await crawlOneHost(domain);
    } catch (e) {
      console.log(`[host-error] ${domain} :: ${e.message}`);
      continue;
    }
    for (const it of items){
      const prev = state.urls[it.url];
      if (prev && prev.hash === it.hash) continue; // 无变化
      const evPath = path.join(ROOT,'evidence', slug, `${todayStr}.json`);
      const payload = {
        vendor: slug,
        url: it.url,
        type: it.type,
        observedAt: new Date().toISOString(),
        textHash: it.hash,
        excerpt: it.text.slice(0, 800)
      };
      ensureDir(path.dirname(evPath));
      fs.appendFileSync(evPath, JSON.stringify(payload) + '\n');
      state.urls[it.url] = { hash: it.hash, updatedAt: payload.observedAt };
      newCount++;
      console.log(`[evidence] ${slug} ${it.type} → ${it.url}`);
    }
  }
  saveState(state);

  // 触发站点增量（存在才跑；失败不阻断）
  const tryRun = (cmd) => { try { execSync(cmd, { stdio: 'inherit' }); } catch(e) { /* noop */ } };
  if (fs.existsSync(path.join(ROOT,'scripts','vendor_catalog.js'))) tryRun('node scripts/vendor_catalog.js');
  if (fs.existsSync(path.join(ROOT,'scripts','build_updates.js')))   tryRun('node scripts/build_updates.js');
  if (fs.existsSync(path.join(ROOT,'scripts','seo_inject.js')))      tryRun('node scripts/seo_inject.js');

  write(path.join(ROOT,'.heartbeat','collect-evidence.json'), JSON.stringify({ newEvidence: newCount, date: todayStr }));
  console.log(`[collect] done new=${newCount}`);
}

// 全局兜底：任何未捕获错误也不要让 CI 失败（改为软失败）
main().catch(err => {
  console.error('[collect][error]', err);
  process.exit(0);
});
