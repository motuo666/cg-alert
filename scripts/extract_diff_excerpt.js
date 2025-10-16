#!/usr/bin/env node
/**
 * extract_diff_excerpt.js
 * 为 evidence JSON 生成“变化片段摘要”：
 *   diff_excerpt_before / diff_excerpt_after （各10~30字）
 *
 * 查找策略（尽量稳健，找不到就跳过）：
 * - 从 .cache/http/<host>/ 目录中，按目标 URL 的编码文件名，取最近两版 body.txt
 * - 若无法定位缓存文件，跳过该 evidence
 *
 * 仅写入不存在的字段，不覆盖已有内容。
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVD = path.join(ROOT, 'evidence');
const CACHE = path.join(ROOT, '.cache', 'http');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.isFile() && ent.name.endsWith('.json')) acc.push(p);
  }
  return acc;
}

function readBodyCandidates(hostDir, hint) {
  if (!fs.existsSync(hostDir)) return [];
  const files = fs.readdirSync(hostDir)
    .filter(n => n.endsWith('.body.txt'))
    .map(n => ({ n, p: path.join(hostDir, n), mtime: fs.statSync(path.join(hostDir, n)).mtimeMs }));
  // 若有 hint，优先匹配包含 hint 的文件名
  const prefer = [];
  const others = [];
  for (const f of files) {
    (hint && f.n.includes(hint) ? prefer : others).push(f);
  }
  prefer.sort((a,b)=>b.mtime-a.mtime);
  others.sort((a,b)=>b.mtime-a.mtime);
  return prefer.concat(others);
}

function shortestDiff(a, b, ctx = 30) {
  if (!a || !b) return null;
  const A = a.slice(0, 10000);
  const B = b.slice(0, 10000);

  let i = 0;
  const minLen = Math.min(A.length, B.length);
  while (i < minLen && A[i] === B[i]) i++;

  let j = 0;
  while (j < minLen - i && A[A.length - 1 - j] === B[B.length - 1 - j]) j++;

  const aMid = A.slice(i, A.length - j);
  const bMid = B.slice(i, B.length - j);

  const before = A.slice(Math.max(0, i - ctx), i + Math.min(aMid.length, ctx));
  const after  = B.slice(Math.max(0, i - ctx), i + Math.min(bMid.length, ctx));

  return {
    before: before.replace(/\s+/g, ' ').trim().slice(-ctx),
    after:  after.replace(/\s+/g, ' ').trim().slice(0, ctx)
  };
}

function safeURL(u) { try { return new URL(u); } catch { return null; } }

function run() {
  const files = walk(EVD);
  let updated = 0;

  for (const fp of files) {
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      const j = JSON.parse(raw);

      // 仅对非 baseline 的证据尝试生成摘要
      const kind = String(j.kind || '').toLowerCase();
      const hash = String(j.hash || '');
      if (kind === 'baseline' || !hash || /^0+$/i.test(hash)) continue;

      if (j.diff_excerpt_before && j.diff_excerpt_after) continue;

      const url = j.url || j.target || j.page || '';
      const U = safeURL(url);
      if (!U) continue;

      const hostDir = path.join(CACHE, U.host);
      // 根据路径名给个简易 hint（仅编码文件名策略可能不同，做“包含”匹配）
      const hint = encodeURIComponent(U.pathname + (U.search || '')).slice(0, 80);
      const cands = readBodyCandidates(hostDir, hint);
      if (cands.length < 2) continue;

      // 最近两版 body
      const bodyNew = fs.readFileSync(cands[0].p, 'utf8');
      const bodyOld = fs.readFileSync(cands[1].p, 'utf8');

      const ex = shortestDiff(bodyOld, bodyNew, 40);
      if (!ex) continue;

      j.diff_excerpt_before = ex.before;
      j.diff_excerpt_after  = ex.after;

      fs.writeFileSync(fp, JSON.stringify(j, null, 2));
      updated++;
    } catch (e) {
      // 忽略坏 JSON
    }
  }

  console.log(`diff excerpts: files=${files.length}, updated=${updated}`);
}

run();
