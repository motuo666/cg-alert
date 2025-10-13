#!/usr/bin/env node
// poll_public_endpoints.js — 轻量轮询公开端点，缓存到 .cache/http/<host>/<path>.body.txt
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
  fs.mkdirSync(CACHE_ROOT, { recursive: true });
  let errors=0, changed=0, baselines=0;
  for (const u of list) {
    const res = await fetchURL(u);
    const host = new URL(u).hostname.replace(/^www\./,'');
    const key = u.replace(/^https?:\/\//,'');
    const dir = path.join(CACHE_ROOT, host);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, '/'+key).replace(/\/+/g,'/').replace(/\//g,'%2F') + '.body.txt';
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
