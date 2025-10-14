#!/usr/bin/env node
// poll_public_endpoints.js — 轻量轮询公开端点，缓存到 .cache/http/<host>/<path>.body.txt（只编码文件名，绝不编码目录）
// 兼容 robots 由 weekly_health_check 负责，本脚本只拉 endpoints.csv 指定的 URL
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const IN = path.join(__dirname, '..', 'data', 'endpoints.csv');
const CACHE_ROOT = path.join(__dirname, '..', '.cache', 'http');
const MAX = Number(process.env.POLL_MAX || 32);

if (!fs.existsSync(IN)) { console.log('[poll] no endpoints.csv → skip'); process.exit(0); }

function fetchURL(u){
  return new Promise((resolve) => {
    const lib = u.startsWith('https') ? https : http;
    const req = lib.get(u, { timeout: 12000, headers: { 'User-Agent': 'cg-alert/health' }}, (res) => {
      let data=''; res.setEncoding('utf8');
      res.on('data', c => data += c); res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', e => resolve({ error: String(e) }));
    req.on('timeout', ()=>{ req.destroy(); resolve({ error: 'timeout' }); });
  });
}

function encodeFileComponent(s){
  // 只对文件名做安全编码：/ -> %2F, ? -> %3F, # -> %23, 其它保持
  return s.replace(/\//g,'%2F').replace(/\?/g,'%3F').replace(/#/g,'%23');
}

(async function(){
  const lines = fs.readFileSync(IN,'utf8').split(/\r?\n/).filter(Boolean);
  const list = [];
  for (const l of lines) {
    const parts = l.split(',');
    if (parts.length < 3) continue;
    const url = parts.slice(1, -1).join(',').trim();
    const type = parts[parts.length-1].trim();
    if (/StatusAPI|Security/.test(type)) continue; // 仅采样可渲染页
    list.push(url);
    if (list.length >= MAX) break;
  }
  let errors=0, changed=0, baselines=0;
  for (const u of list) {
    const res = await fetchURL(u);
    const { hostname, pathname, search } = new URL(u);
    const host = hostname.replace(/^www\./,'').toLowerCase();

    const dir = path.join(CACHE_ROOT, host);
    fs.mkdirSync(dir, { recursive: true });

    const rawKey = (pathname || '/') + (search || '');
    const file = path.join(dir, encodeFileComponent(rawKey) + '.body.txt');

    if (res.error) { console.log(`[poll][err] ${u} ${res.error}`); errors++; continue; }
    const body = res.body || '';
    const old = fs.existsSync(file) ? fs.readFileSync(file,'utf8') : '';
    if (!old) baselines++;
    if (old !== body) changed++;
    fs.writeFileSync(file, body, 'utf8');
  }
  console.log(`[poll] done: batch=${list.length}, changed=${changed}, baselines=${baselines}, errors=${errors}`);
  process.exit(0);
})().catch(e=>{ console.error('[poll][fatal]', e); process.exit(1); });
