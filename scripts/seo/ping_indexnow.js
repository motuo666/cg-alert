#!/usr/bin/env node

const https = require('https');
const fs = require('fs');
const path = require('path');

// 站点根，默认用正式域名
const HOST = (process.env.SITE_ORIGIN || 'https://www.cg-alert.com').replace(/\/$/, '');

// IndexNow key 必须存在，否则直接跳过
const KEY = process.env.INDEXNOW_KEY || '';
if (!KEY) {
  console.log('INDEXNOW_KEY missing; skip');
  process.exit(0);
}

// 尝试这两个候选路径：优先用仓库根目录的 sitemap.xml，
// 如果没有，再退回旧的 public/sitemap.xml（兼容历史）
const candidates = [
  path.join('sitemap.xml'),
  path.join('public', 'sitemap.xml'),
];

let sitemapPath = null;
let sitemapXml = null;

for (const p of candidates) {
  if (fs.existsSync(p)) {
    sitemapPath = p;
    sitemapXml = fs.readFileSync(p, 'utf8');
    break;
  }
}

if (!sitemapXml) {
  console.log('No sitemap.xml found in ./ or ./public. Skip IndexNow ping.');
  process.exit(0);
}

// 从 sitemap 里提取所有 <loc> URL，最多 1000 条
const urls = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).slice(0, 1000);

if (!urls.length) {
  console.log(`No <loc> entries found in ${sitemapPath}; skip IndexNow ping.`);
  process.exit(0);
}

const payload = JSON.stringify({
  host: HOST.replace(/^https?:\/\//, ''),
  key: KEY,
  keyLocation: `${HOST}/indexnow-${KEY}.txt`,
  urlList: urls,
});

const req = https.request(
  'https://api.indexnow.org/indexnow',
  {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    },
  },
  (res) => {
    let body = '';
    res.on('data', (d) => {
      body += d.toString();
    });
    res.on('end', () => {
      console.log('indexnow', res.statusCode, body || '');
    });
  },
);

req.on('error', (e) => {
  console.error('indexnow error', e);
});

req.write(payload);
req.end();
