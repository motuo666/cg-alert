#!/usr/bin/env node
/**
 * link_guard.js
 * 目的：在发信前对「即将使用的落地页/按钮链接」做健全性体检，避免无效/错误UTM/明文http。
 * 体检项：
 *  - 协议必须 https
 *  - 组合 UTM 后不出现 "??"、"&?"、"&&"
 *  - 关键页面可访问（HEAD 优先，失败回退 GET），状态码 < 400 视为可用
 *  - 对当期“有真实变更”的 vendor 给出示例链接校验（/updates/?q=domain、/reports/YYYY-MM/domain/）
 *
 * 退出码：出现任一 ERROR → exit 1（阻断发信）；否则 exit 0。
 *
 * 环境变量（由 workflow 提供）：
 *  - SITE_ORIGIN              站点根，例如 https://www.cg-alert.com
 *  - INTAKE_FORM_URL          启用 Alerts 的表单链接（可为空）
 *  - STRIPE_LINK_PORTFOLIO    Portfolio 购买链接（可为空）
 *  - UTM_SOURCE / UTM_MEDIUM / UTM_CAMPAIGN  可选，未设则用默认
 *
 * 读取数据：
 *  - data/evidence.ndx  用于抽取最近 window_h 小时内有“非零 hash”的变更 vendor（示例链接校验）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');
const { URL } = require('url');

const ROOT = path.join(__dirname, '..');
const EVID_NDX = path.join(ROOT, 'data', 'evidence.ndx');

// ---------- 配置与工具 ----------
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://www.cg-alert.com').replace(/\/+$/,'');
const INTAKE_FORM_URL = (process.env.INTAKE_FORM_URL || '').trim();
const STRIPE_LINK_PORTFOLIO = (process.env.STRIPE_LINK_PORTFOLIO || '').trim();

const UTM = {
  source:   process.env.UTM_SOURCE   || 'email',
  medium:   process.env.UTM_MEDIUM   || 'triggered',
  campaign: process.env.UTM_CAMPAIGN || inferCampaign(),
};

const WINDOW_H = Number(getArg('--window_h', '168')); // 用于抽取示例 vendor
const EXAMPLE_TOPK = Number(getArg('--topk', '10'));  // 最多校验 10 个 vendor 示例
const TIMEOUT_MS = 8000;

function getArg(flag, dflt){
  const i = process.argv.indexOf(flag);
  return i>=0 ? (process.argv[i+1]||'') : dflt;
}
function inferCampaign(){
  const d = new Date();
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
  return `cp_${ym}`;
}
function ymd(){
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
}
function assertHttps(u){
  try{
    const url = new URL(u);
    return url.protocol === 'https:';
  }catch{ return false; }
}
function joinUTM(base, utm){
  // base 可能已有 ?（如 /updates/?q=domain），utm 传入形如 "utm_source=..&utm_medium=..&utm_campaign=.."
  const hasQ = base.includes('?');
  return base + (hasQ ? '&' : '?') + utm;
}
function hasBadQuerySyntax(u){
  return /\?\?|&\?|\?\&|&&/.test(u);
}
function httpHeadOrGet(url){
  return new Promise((resolve)=>{
    let done = false;
    const lib = url.startsWith('https://') ? https : http;
    const controller = new AbortController();
    const to = setTimeout(()=>{
      if (done) return;
      done = true; controller.abort();
      resolve({ ok:false, status: 599, error: 'timeout' });
    }, TIMEOUT_MS);

    const req = lib.request(url, { method: 'HEAD', signal: controller.signal }, res=>{
      if (done) return;
      done = true; clearTimeout(to);
      resolve({ ok: res.statusCode < 400, status: res.statusCode, location: res.headers.location||'' });
    });
    req.on('error', ()=>{
      // 回退 GET（部分站点不支持 HEAD）
      if (done) return;
      const req2 = lib.request(url, { method: 'GET', signal: controller.signal }, res=>{
        if (done) return;
        done = true; clearTimeout(to);
        resolve({ ok: res.statusCode < 400, status: res.statusCode, location: res.headers.location||'' });
      });
      req2.on('error', (e)=>{
        if (done) return;
        done = true; clearTimeout(to);
        resolve({ ok:false, status: 598, error: e && e.message || 'error' });
      });
      req2.end();
    });
    req.end();
  });
}
function readLines(fp){
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp,'utf8').split(/\r?\n/).filter(Boolean);
}
function uniq(arr){ return Array.from(new Set(arr)); }
function isNonZeroHash(h){ return !!h && !/^0+$/.test(h); }

// ---------- 收集待校验链接 ----------
const issues = [];
const checks = [];

function pushIssue(level, what, detail){
  issues.push({ level, what, detail });
}

function addCheck(name, url, kind){
  checks.push({ name, url, kind });
}

function collectStaticLinks(){
  // 站内基础页
  addCheck('Home', `${SITE_ORIGIN}/`, 'page');
  addCheck('Updates', `${SITE_ORIGIN}/updates/`, 'page');
  addCheck('Reports (month root)', `${SITE_ORIGIN}/reports/${ymd().slice(0,7)}/`, 'page');

  // 可选按钮
  if (INTAKE_FORM_URL) addCheck('Enable alerts (intake)', INTAKE_FORM_URL, 'cta');
  if (STRIPE_LINK_PORTFOLIO) addCheck('Buy Portfolio (stripe)', STRIPE_LINK_PORTFOLIO, 'cta');
}

function collectVendorExamples(){
  // 从 evidence.ndx 中抓近 window_h 的非零 hash 记录，按 domain 去重取前 EXAMPLE_TOPK
  const cutoff = Date.now() - WINDOW_H*3600*1000;
  const lines = readLines(EVID_NDX);
  const recentDomains = [];
  for (const ln of lines){
    const [when, domain, , hash] = ln.split('\t');
    const t = Date.parse(when||'');
    if (!isNaN(t) && t>=cutoff && isNonZeroHash(hash||'')){
      if (domain) recentDomains.push(domain);
    }
  }
  const domains = uniq(recentDomains).slice(0, EXAMPLE_TOPK);

  for (const d of domains){
    const u1 = `${SITE_ORIGIN}/updates/?q=${encodeURIComponent(d)}`;
    const u2 = `${SITE_ORIGIN}/reports/${ymd().slice(0,7)}/${d}/`;
    addCheck(`[Example] Updates?q=${d}`, u1, 'example');
    addCheck(`[Example] ChangePack ${d}`, u2, 'example');
  }
}

collectStaticLinks();
collectVendorExamples();

// ---------- 规则检查（本地语法） ----------
for (const c of checks){
  // 1) https 强制
  if (!assertHttps(c.url)){
    pushIssue('ERROR', 'Non-HTTPS URL', `${c.name} -> ${c.url}`);
  }
  // 2) 组合 UTM 语法模拟检查
  const utm = `utm_source=${encodeURIComponent(UTM.source)}&utm_medium=${encodeURIComponent(UTM.medium)}&utm_campaign=${encodeURIComponent(UTM.campaign)}`;
  const testTracked = joinUTM(c.url, utm);
  if (hasBadQuerySyntax(testTracked)){
    pushIssue('ERROR', 'Bad query join (??/&?)', `${c.name} -> ${testTracked}`);
  }
}

// ---------- 远程可达性检查 ----------
async function runNetworkChecks(){
  for (const c of checks){
    const res = await httpHeadOrGet(c.url);
    if (!res.ok){
      pushIssue('ERROR', 'Unreachable URL', `${c.name} -> ${c.url} [status=${res.status}${res.location? ' loc='+res.location:''}]`);
    }
    // 再对带 UTM 的追踪链接做一次探测（仅站内页）
    if (c.url.startsWith(SITE_ORIGIN)){
      const utm = `utm_source=${encodeURIComponent(UTM.source)}&utm_medium=${encodeURIComponent(UTM.medium)}&utm_campaign=${encodeURIComponent(UTM.campaign)}`;
      const tracked = joinUTM(c.url, utm);
      const res2 = await httpHeadOrGet(tracked);
      if (!res2.ok){
        pushIssue('ERROR', 'Tracked URL unreachable', `${c.name} (UTM) -> ${tracked} [status=${res2.status}${res2.location? ' loc='+res2.location:''}]`);
      }
    }
  }
}

// ---------- 输出与退出 ----------
async function main(){
  await runNetworkChecks();

  const sum = [];
  sum.push('### Link Guard Report');
  sum.push(`- Site origin: **${SITE_ORIGIN}**`);
  sum.push(`- Checks: **${checks.length}** links`);
  sum.push(`- UTM: source=${UTM.source}, medium=${UTM.medium}, campaign=${UTM.campaign}`);
  if (issues.length === 0){
    sum.push('\nAll good ✅');
  }else{
    const errs = issues.filter(i=>i.level==='ERROR');
    const warns = issues.filter(i=>i.level!=='ERROR');
    if (errs.length) sum.push(`\n**ERRORS (${errs.length})**:`);
    for (const e of errs) sum.push(`- ${e.what}: ${e.detail}`);
    if (warns.length) sum.push(`\n**WARNINGS (${warns.length})**:`);
    for (const w of warns) sum.push(`- ${w.what}: ${w.detail}`);
  }

  // 控制台输出
  console.log(sum.join('\n'));

  // Step Summary（Actions UI）
  if (process.env.GITHUB_STEP_SUMMARY){
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, sum.join('\n')+'\n', 'utf8');
  }

  // 退出码
  if (issues.some(i=>i.level==='ERROR')) process.exit(1);
  process.exit(0);
}

main().catch(e=>{
  console.error('link_guard crashed:', e && e.stack || e);
  process.exit(1);
});
