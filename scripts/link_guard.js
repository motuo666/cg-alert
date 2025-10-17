#!/usr/bin/env node
/**
 * Link Guard (final)
 * 目标：
 *  - 只校验“这次要发出去”的真实链接（如存在 artifacts/outreach_links.json）
 *  - 否则用 repo 内已有内容动态取样（reports/<YYYY-MM>/* or vendors/*）
 *  - 若本月无 pack，自动降级为 /updates/?q=<domain> 的 fallback，不视为错误
 *  - 严格校验：将要发的“最终落地链接”不可 4xx/5xx；示例/不存在的 pack 只 WARN
 *
 * 约定（可选）：
 *  - artifacts/outreach_links.json: [{domain:"okta.com", packUrl:"...", updatesUrl:"..."}...]
 *    若存在则优先使用，代表本次批次的真实落地链接集合（send_triggered 的 dry-run 导出）
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const ROOT = path.join(__dirname, '..');
const ART_LINKS = path.join(ROOT, 'artifacts', 'outreach_links.json');

const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const UTM_SRC = process.env.LG_UTM_SOURCE || 'email';
const UTM_MED = process.env.LG_UTM_MEDIUM || 'triggered';
const UTM_CAMP = process.env.LG_UTM_CAMPAIGN || ('cp_' + new Date().toISOString().slice(0,7).replace('-',''));

const YM = new Date().toISOString().slice(0,7); // YYYY-MM

function joinUrl(base, suffix){
  if (base.endsWith('/') && suffix.startsWith('/')) return base + suffix.slice(1);
  if (!base.endsWith('/') && !suffix.startsWith('/')) return base + '/' + suffix;
  return base + suffix;
}

function addUtm(u, src=UTM_SRC, med=UTM_MED, camp=UTM_CAMP){
  const hasQ = u.includes('?');
  const sep = hasQ ? '&' : '?';
  return `${u}${sep}utm_source=${encodeURIComponent(src)}&utm_medium=${encodeURIComponent(med)}&utm_campaign=${encodeURIComponent(camp)}`;
}

function httpCheck(url, timeoutMs=8000){
  return new Promise((resolve) => {
    try{
      const lib = url.startsWith('https') ? https : http;
      const req = lib.request(url, { method:'GET', timeout: timeoutMs, headers:{'User-Agent':'CG-LinkGuard'}}, (res) => {
        // 2xx/3xx 视为可达；其余不可达
        const ok = res.statusCode >= 200 && res.statusCode < 400;
        // 读取并丢弃响应体，尽快结束
        res.resume();
        res.on('end', ()=> resolve({ ok, status: res.statusCode || 0 }));
      });
      req.on('timeout', ()=> { req.destroy(); resolve({ ok:false, status:0 }); });
      req.on('error', ()=> resolve({ ok:false, status:0 }));
      req.end();
    }catch(e){
      resolve({ ok:false, status:0 });
    }
  });
}

function existsLocalPack(domain){
  // 用本地构建的文件判断是否有 pack（更快）
  const p = path.join(ROOT, 'reports', YM, domain, 'index.html');
  return fs.existsSync(p);
}

function pickDomainsFromRepo(max=8){
  const out = [];
  const base = path.join(ROOT, 'reports', YM);
  if (fs.existsSync(base)){
    for (const d of fs.readdirSync(base, { withFileTypes:true })){
      if (d.isDirectory() && d.name !== '.' && d.name !== '..'){
        out.push(d.name);
        if (out.length >= max) break;
      }
    }
  }
  if (out.length < Math.floor(max/2)) {
    // 回落 vendors/*/index.html
    const vdir = path.join(ROOT, 'vendors');
    if (fs.existsSync(vdir)){
      for (const d of fs.readdirSync(vdir, { withFileTypes:true })){
        if (d.isDirectory()){
          const dom = d.name;
          if (!out.includes(dom)) out.push(dom);
          if (out.length >= max) break;
        }
      }
    }
  }
  return out;
}

function loadPlannedLinks(){
  try{
    if (fs.existsSync(ART_LINKS)){
      const a = JSON.parse(fs.readFileSync(ART_LINKS,'utf8'));
      if (Array.isArray(a) && a.length) return a;
    }
  }catch{}
  return null;
}

async function main(){
  const planned = loadPlannedLinks();
  let targets = [];

  if (planned){
    // 使用本次批次真实链接
    for (const it of planned){
      const domain = (it.domain||'').trim();
      if (!domain) continue;
      const pack = it.packUrl || joinUrl(ORIGIN, `/reports/${YM}/${domain}/`);
      const updates = it.updatesUrl || joinUrl(ORIGIN, `/updates/?q=${encodeURIComponent(domain)}`);
      targets.push({ domain, pack, updates, kind:'real' });
    }
  }else{
    // 动态取样：从已有 packs 或 vendors 里挑
    const ds = pickDomainsFromRepo(8);
    for (const domain of ds){
      const pack = joinUrl(ORIGIN, `/reports/${YM}/${domain}/`);
      const updates = joinUrl(ORIGIN, `/updates/?q=${encodeURIComponent(domain)}`);
      targets.push({ domain, pack, updates, kind:'sample' });
    }
  }

  // CTA 链接（如果配置了就校验；没配不报错）
  const extras = [];
  const intake = process.env.INTAKE_FORM_URL;
  if (intake && /^https?:\/\//.test(intake)) extras.push({ label:'Enable alerts', url:intake });
  const stripe = process.env.STRIPE_LINK_PORTFOLIO;
  if (stripe && /^https?:\/\//.test(stripe)) extras.push({ label:'Buy Portfolio', url:stripe });

  const lines = [];
  lines.push(`### Link Guard Report`);
  lines.push(`- Site origin: **${ORIGIN}**`);
  lines.push(`- Mode: **${planned ? 'planned-batch' : 'dynamic-sample'}**`);
  lines.push(`- UTM: source=${UTM_SRC}, medium=${UTM_MED}, campaign=${UTM_CAMP}`);
  lines.push('');

  let errors = 0, warns = 0, checks = 0;

  // 校验每个目标的“最终落地”与 UTM 落地
  for (const t of targets){
    const packLocal = existsLocalPack(t.domain);
    // 决策：有 pack 就以 pack 为主，没 pack 就用 updates
    const finalUrl = packLocal ? t.pack : t.updates;
    const finalUtm = addUtm(finalUrl);

    // 对示例目标：如果选中了 pack 但远端 404，则只 WARN；对真实批次：ERROR
    const isReal = t.kind === 'real';

    // 先测最终落地
    const r1 = await httpCheck(finalUrl); checks++;
    if (!r1.ok){
      if (isReal){
        errors++; lines.push(`- ERROR: Unreachable final URL for **${t.domain}** -> ${finalUrl} [status=${r1.status}]`);
        continue; // 已经 ERROR 了，不再测 UTM
      }else{
        warns++; lines.push(`- WARN: Sample final URL unreachable for **${t.domain}** -> ${finalUrl} [status=${r1.status}]`);
        // 对样本继续测 UTM，但不影响错误计数
      }
    }

    // 再测带 UTM 的最终落地
    const r2 = await httpCheck(finalUtm); checks++;
    if (!r2.ok){
      if (isReal){
        errors++; lines.push(`- ERROR: Tracked final URL unreachable for **${t.domain}** -> ${finalUtm} [status=${r2.status}]`);
      }else{
        warns++; lines.push(`- WARN: Sample tracked URL unreachable for **${t.domain}** -> ${finalUtm} [status=${r2.status}]`);
      }
    }
  }

  // 校验 CTA（如果提供了）
  for (const x of extras){
    const r = await httpCheck(x.url); checks++;
    if (!r.ok){
      errors++; lines.push(`- ERROR: CTA unreachable: **${x.label}** -> ${x.url} [status=${r.status}]`);
    }
  }

  lines.unshift(`- Checks: **${checks}** links`);
  if (errors>0) lines.push(`\n**ERRORS (${errors})**`);
  if (warns>0)  lines.push(`\n**WARNINGS (${warns})**`);

  console.log(lines.join('\n'));
  if (process.env.GITHUB_STEP_SUMMARY){
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n')+'\n', 'utf8');
  }

  process.exit(errors>0 ? 1 : 0);
}

main();
