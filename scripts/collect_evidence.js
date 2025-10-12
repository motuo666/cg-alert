#!/usr/bin/env node
/**
 * collect_evidence.js — 轻量级公开页面采集器（遵守 robots.txt）
 * 数据源：data/domains.csv（每行：domain[,slug]）
 * 产出：evidence/<slug>/<YYYY-MM-DD>.json（当日首次观测到差异才写）
 * 状态：data/evidence_state.json（url -> last_hash）
 * 覆盖范围：Pricing / Terms / DPA / Subprocessors / Status（常见路径猜测 + status.<domain>）
 * 依赖：Node 18+（内置 fetch/crypto），无第三方包
 * 合规：尊重 robots.txt（User-agent: CGAlertBot）
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const UA = process.env.USER_AGENT || 'CGAlertBot/1.0 (+https://www.cg-alert.com)';
const ROOT = path.join(__dirname, '..');
const SITE = 'https://www.cg-alert.com';

function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function read(p, d=''){ try { return fs.readFileSync(p,'utf8'); } catch { return d; } }
function write(p, s){ ensureDir(path.dirname(p)); fs.writeFileSync(p, s); }
function lines(s){ return s.split(/\r?\n/).map(x=>x.trim()).filter(Boolean); }
function today(){ return new Date().toISOString().slice(0,10); }
function slugify(s){ return s.toLowerCase().replace(/^www\./,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,''); }
function hostOf(u){ try { return new URL(u).origin; } catch { return null; } }
function sha256(s){ return crypto.createHash('sha256').update(s).digest('hex'); }

// 读取 domains.csv：支持 "domain" 或 "domain,slug"
function readDomains(){
  const p = path.join(ROOT, 'data','domains.csv');
  if (!fs.existsSync(p)) return [];
  return lines(read(p)).map(row=>{
    const [domain, custom] = row.split(',').map(x=>x && x.trim()).filter(x=>x!==undefined);
    if(!domain) return null;
    const slug = custom && custom.length ? slugify(custom) : slugify(domain.replace(/\.[a-z]+$/,''));
    return { domain: domain.toLowerCase(), slug };
  }).filter(Boolean);
}

// 备选路径（按优先级）
const PATHS = {
  pricing: ['/pricing','/plans','/plan'],
  tos: ['/terms','/terms-of-service','/legal/terms','/legal/terms-of-service','/tos'],
  dpa: ['/dpa','/legal/dpa','/data-processing-addendum','/gdpr/dpa'],
  subprocessors: ['/subprocessors','/sub-processors','/legal/subprocessors','/gdpr/subprocessors'],
  status: ['/status'] // 另有 status.<domain> 作为独立主机
};

// 极简 robots.txt 解析（支持 User-agent 块 + Allow/Disallow，最长匹配优先）
async function fetchRobots(origin){
  try{
    const res = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!res.ok) return { allowAll: true };
    const txt = await res.text();
    return parseRobots(txt);
  }catch{ return { allowAll: true }; }
}
function parseRobots(txt){
  const lines = txt.split(/\r?\n/);
  const groups = [];
  let cur = null;
  for (const raw of lines){
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [k, ...rest] = line.split(':');
    const key = k.toLowerCase().trim();
    const val = rest.join(':').trim();
    if (key === 'user-agent'){
      cur = { agents:[val.toLowerCase()], rules: [] };
      groups.push(cur);
    }else if (key === 'allow' || key === 'disallow'){
      if (cur) cur.rules.push({ type: key, path: val });
    }else if (key === 'user-agent' && !cur){
      // ignore
    }
  }
  return { groups };
}
function isAllowed(robots, ua, pathname){
  if (!robots || robots.allowAll) return true;
  const uaLower = ua.toLowerCase();
  // 选择匹配 UA 的组（优先具体 UA，否则 *）
  const groups = robots.groups || [];
  let cand = groups.filter(g => g.agents.some(a => a === uaLower));
  if (!cand.length) cand = groups.filter(g => g.agents.some(a => a === '*'));
  if (!cand.length) return true;
  // 取所有规则，最长匹配优先
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

// 抽取文本（去脚本/样式/标签/多空白）
function extractText(html, contentType=''){
  if (/json/i.test(contentType)) return html;
  let s = html.replace(/<script[\s\S]*?<\/script>/gi, '')
              .replace(/<style[\s\S]*?<\/style>/gi, '')
              .replace(/<!--[\s\S]*?-->/g, '')
              .replace(/<[^>]+>/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

async function fetchText(url){
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html,text/plain,application/json' }, redirect: 'follow' });
  if (!res.ok) return null;
  const ct = res.headers.get('content-type') || '';
  if (!/(text|json)/i.test(ct)) return null;
  const raw = await res.text();
  return extractText(raw, ct);
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

// 生成候选 URL（存在即采；不存在跳过）
function candidateURLs(domain){
  const urls = new Set();
  const add = (u)=> urls.add(u.replace(/\/+$/,''));
  // 站内常见路径
  for (const [_, arr] of Object.entries(PATHS)){
    arr.forEach(p => add(`https://${domain}${p}`));
  }
  // status 子域
  add(`https://status.${domain}`);
  add(`https://status.${domain}/`);
  return [...urls];
}

async function crawlOne(host, paths){
  const origin = `https://${host}`;
  const robots = await fetchRobots(origin);
  const out = [];
  for (const u of paths){
    const url = u.startsWith('http') ? u : `${origin}${u}`;
    const { pathname, origin: o2 } = new URL(url);
    // robots 校验（主机变了也要拉 robots）
    const rob = o2 === origin ? robots : await fetchRobots(o2);
    if (!isAllowed(rob, UA, pathname)) { 
      console.log(`[robots] disallow ${url}`);
      continue;
    }
    const text = await fetchText(url);
    if (!text) continue;
    const hash = sha256(text);
    out.push({ url, hash, text, type: typeOfURL(url) });
  }
  return out;
}

async function main(){
  const domains = readDomains();
  if (!domains.length){
    console.log('[collect] data/domains.csv 为空；请先追加目标域。'); 
    process.exit(0);
  }
  const state = loadState();
  const todayStr = today();
  let newCount = 0;

  for (const { domain, slug } of domains){
    const urls = candidateURLs(domain);
    const host = domain;
    const items = await crawlOne(host, urls);

    for (const it of items){
      const prev = state.urls[it.url];
      if (prev && prev.hash === it.hash) continue; // 无变化
      // 写 evidence
      const evPath = path.join(ROOT,'evidence', slug, `${todayStr}.json`);
      const payload = {
        vendor: slug,
        url: it.url,
        type: it.type,
        observedAt: new Date().toISOString(),
        textHash: it.hash,
        // 只留片段，避免全文存储；提升隐私与仓库体积
        excerpt: it.text.slice(0, 800)
      };
      ensureDir(path.dirname(evPath));
      fs.appendFileSync(evPath, JSON.stringify(payload) + '\n');
      // 更新状态
      state.urls[it.url] = { hash: it.hash, updatedAt: payload.observedAt };
      newCount++;
      console.log(`[evidence] ${slug} ${it.type} → ${it.url}`);
    }
  }
  saveState(state);

  // 尝试触发站点增量构建（存在才跑；失败不阻断）
  const tryRun = (cmd) => { try { execSync(cmd, { stdio: 'inherit' }); } catch(e) { /* noop */ } };
  if (fs.existsSync(path.join(ROOT,'scripts','vendor_catalog.js'))) tryRun('node scripts/vendor_catalog.js');
  if (fs.existsSync(path.join(ROOT,'scripts','build_updates.js')))   tryRun('node scripts/build_updates.js');
  if (fs.existsSync(path.join(ROOT,'scripts','seo_inject.js')))      tryRun('node scripts/seo_inject.js');

  // 汇总输出，用于 GitHub Actions Slack 步骤
  const summary = { newEvidence: newCount, date: todayStr };
  write(path.join(ROOT,'.heartbeat','collect-evidence.json'), JSON.stringify(summary));
  console.log(`[collect] done new=${newCount}`);
}

main().catch(err => { console.error('[collect][error]', err); process.exit(1); });
