#!/usr/bin/env node
/**
 * poll_public_endpoints.js — 公开端点轻量采样抓取
 *
 * 目标（一次到位，兼容你现有 normalize/hash 逻辑）：
 * - 始终保存 **正文** 到 .cache/http/<host>/<encoded-key>.body.txt（只编码“文件名”，不创建子目录）
 * - 兼容历史/他处可能使用的键编码：写 **两个别名文件**（v1: 仅编码 / ? #；v2: encodeURIComponent 全量编码）
 * - 支持 GET/HEAD（默认 GET），自动跟随最多 5 次重定向，支持 gzip/deflate/br 解压
 * - 并发可控（默认 8），采样比例可控（POLL_SAMPLE，默认 1.0）
 * - 过滤不可渲染页面（StatusAPI / Security），遵循你“robots 由 weekly_health_check 统一处理”的前置约定
 *
 * 环境变量：
 *   POLL_MAX=32            // 本次最多抓取的端点数（采样后上限）
 *   POLL_SAMPLE=1.0        // 0~1，按比例随机抽样端点
 *   POLL_CONCURRENCY=8     // 并发抓取数
 *   POLL_FETCH_MODE=GET    // GET | HEAD | AUTO（AUTO: 优先 GET）
 *   REQ_TIMEOUT_MS=12000   // 单请求超时
 *   USER_AGENT=cg-alert/health
 *
 * 输出统计：
 *   [poll] done: batch=?, changed=?, baselines=?, errors=?
 *
 * 注意：
 *   - 我们把正文保存到两个别名（v1/v2）文件名，便于下游任何一种路径映射都能命中缓存。
 *   - 仅在“主别名”（v1）上计算 baselines/changed 指标，以免重复统计。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const IN = path.join(ROOT, 'data', 'endpoints.csv');
const CACHE_ROOT = path.join(ROOT, '.cache', 'http');

const MAX = Math.max(1, Number(process.env.POLL_MAX || 32));
const SAMPLE = Math.min(1, Math.max(0, Number(process.env.POLL_SAMPLE || 1.0)));
const CONC = Math.max(1, Number(process.env.POLL_CONCURRENCY || 8));
const MODE = String(process.env.POLL_FETCH_MODE || 'GET').toUpperCase(); // GET|HEAD|AUTO
const TIMEOUT = Math.max(1000, Number(process.env.REQ_TIMEOUT_MS || 12000));
const UA = process.env.USER_AGENT || 'cg-alert/health';

if (!fs.existsSync(IN)) { console.log('[poll] no endpoints.csv → skip'); process.exit(0); }
fs.mkdirSync(CACHE_ROOT, { recursive: true });

// --- 小型 CSV 读取（容忍逗号/引号） ---
function parseCSVLines(fp) {
  const raw = fs.readFileSync(fp, 'utf8').split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of raw) {
    const out = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && (i === 0 || line[i - 1] !== '\\')) {
        inQ = !inQ; continue;
      }
      if (ch === ',' && !inQ) {
        out.push(cur); cur = ''; continue;
      }
      cur += ch;
    }
    out.push(cur);
    rows.push(out.map(s => s.trim()));
  }
  return rows;
}

// 只编码“文件名”，不动目录：把 / ? # 转义成安全字符，其他原样
function encodeFileComponent_v1(s) {
  return s.replace(/\//g, '%2F').replace(/\?/g, '%3F').replace(/#/g, '%23');
}
// 兼容别名：对整段做 encodeURIComponent（normalize_evidence 若用这种规则也能命中）
function encodeFileComponent_v2(s) {
  return encodeURIComponent(s);
}

function keyFromURL(u) {
  const url = new URL(u);
  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const rawKey = (url.pathname || '/') + (url.search || '');
  const fileV1 = path.join(CACHE_ROOT, host, encodeFileComponent_v1(rawKey) + '.body.txt');
  const fileV2 = path.join(CACHE_ROOT, host, encodeFileComponent_v2(rawKey) + '.body.txt');
  return { host, rawKey, fileV1, fileV2 };
}

// 支持最多 5 次重定向，支持压缩
function fetchWithRedirect(u, method = 'GET', maxRedirect = 5) {
  return new Promise((resolve) => {
    const url = new URL(u);
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + (url.search || ''),
      method,
      timeout: TIMEOUT,
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'close'
      }
    }, (res) => {
      const status = res.statusCode || 0;
      const loc = res.headers.location;

      // 重定向
      if (status >= 300 && status < 400 && loc && maxRedirect > 0) {
        const next = new URL(loc, u).toString();
        req.destroy();
        return fetchWithRedirect(next, method, maxRedirect - 1).then(r => {
          // 保留最终内容，同时带上最终 URL
          r.finalUrl = r.finalUrl || next;
          resolve(r);
        });
      }

      // 读取并解压
      const chunks = [];
      let stream = res;
      const enc = String(res.headers['content-encoding'] || '').toLowerCase();
      if (enc.includes('gzip')) stream = res.pipe(zlib.createGunzip());
      else if (enc.includes('deflate')) stream = res.pipe(zlib.createInflate());
      else if (enc.includes('br')) stream = res.pipe(zlib.createBrotliDecompress());

      stream.on('data', (c) => chunks.push(Buffer.from(c)));
      stream.on('end', () => {
        let body = Buffer.concat(chunks);
        // 限制单体大小（1.5MB），避免异常页面拖垮内存
        if (body.length > 1_500_000) body = body.slice(0, 1_500_000);
        resolve({ status, body: body.toString('utf8'), finalUrl: u });
      });
    });

    req.on('error', (e) => resolve({ error: String(e) }));
    req.on('timeout', () => { try { req.destroy(); } catch(_){} resolve({ error: 'timeout' }); });
    req.end();
  });
}

// 抽样/去重/过滤
function loadTargets() {
  const rows = parseCSVLines(IN);
  const urls = [];
  for (const r of rows) {
    // 取第一个像 URL 的字段
    const url = r.find(x => /^https?:\/\//i.test(x));
    const type = (r[r.length - 1] || '');
    if (!url) continue;
    if (/StatusAPI|Security/i.test(type)) continue; // 只抓可渲染页
    urls.push(url);
  }
  // 去重
  const uniq = Array.from(new Set(urls));
  // 随机化
  for (let i = uniq.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [uniq[i], uniq[j]] = [uniq[j], uniq[i]];
  }
  // 采样
  const take = Math.min(MAX, Math.ceil(uniq.length * SAMPLE));
  return uniq.slice(0, take);
}

// 并发执行（简单 worker 池）
async function runPool(urls, workerN) {
  let i = 0, baselines = 0, changed = 0, errors = 0, batch = urls.length;
  const workers = Array.from({ length: Math.min(workerN, urls.length) }, async () => {
    while (true) {
      const idx = i++; if (idx >= urls.length) break;
      const u = urls[idx];

      // 选择方法
      const method = (MODE === 'HEAD') ? 'HEAD' : 'GET';

      const res = await fetchWithRedirect(u, method, 5);
      if (res.error) { console.log(`[poll][err] ${u} ${res.error}`); errors++; continue; }

      // 只在 GET 时保存正文；HEAD 不保存
      if (method === 'GET') {
        const { fileV1, fileV2 } = keyFromURL(u);

        // 读取旧内容（主别名）
        const existed = fs.existsSync(fileV1);
        const old = existed ? fs.readFileSync(fileV1, 'utf8') : '';

        // 写两个别名，保证兼容
        fs.mkdirSync(path.dirname(fileV1), { recursive: true });
        try { fs.writeFileSync(fileV1, res.body || '', 'utf8'); } catch {}
        try { fs.writeFileSync(fileV2, res.body || '', 'utf8'); } catch {}

        if (!existed) baselines++;
        if ((res.body || '') !== old) changed++;
      }
    }
  });
  await Promise.all(workers);
  return { batch, changed, baselines, errors };
}

(async function main(){
  const targets = loadTargets();
  if (!targets.length) { console.log('[poll] no targets'); process.exit(0); }

  const { batch, changed, baselines, errors } = await runPool(targets, CONC);
  console.log(`[poll] done: batch=${batch}, changed=${changed}, baselines=${baselines}, errors=${errors}`);
  process.exit(0);
})().catch(e => { console.error('[poll][fatal]', e); process.exit(1); });
