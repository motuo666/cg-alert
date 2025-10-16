#!/usr/bin/env node
/**
 * materiality_score.js
 * 从 data/evidence.ndx 计算近 N 天（默认90）材料性评分：
 * - 评分 = Σ(权重 * 时间衰减)
 * - 输出 data/materiality.csv ： vendor,score,impact
 *
 * 依赖：config/materiality_rules.json
 * ndx 格式：制表符分隔，约定列：[0]=date(YYYY-MM-DD), [1]=vendor, [2]=type, [3]=hash, [4]=relpath(可选)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NDX = path.join(ROOT, 'data', 'evidence.ndx');
const OUT = path.join(ROOT, 'data', 'materiality.csv');
const RULE = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'materiality_rules.json'), 'utf8'));

function readLines(fp){ return fs.existsSync(fp)?fs.readFileSync(fp,'utf8').split(/\r?\n/).filter(Boolean):[]; }
function daysBetween(a,b){ return Math.floor((b - a)/(24*3600*1000)); }

function impactOf(score, thr){
  if (score >= (thr.high||8)) return 'High';
  if (score >= (thr.medium||4)) return 'Medium';
  return 'Low';
}

function typeWeight(t){
  const w = RULE.weights[t] ?? RULE.weights['Other'] ?? 1;
  return w;
}

function decayFactor(dDays){
  if (!RULE.decay || !RULE.decay.enabled) return 1;
  const hl = RULE.decay.half_life_days || 45;
  // 指数衰减：0.5^(d/hl)
  return Math.pow(0.5, dDays / hl);
}

function run(){
  const now = new Date();
  const lines = readLines(NDX).map(l=>l.split('\t'));
  const cutoffDays = RULE.recent_days || 90;

  const byVendor = new Map();

  for (const r of lines){
    const dstr = r[0]||'';
    const vendor = r[1]||'';
    const type = r[2]||'Other';

    if (!dstr || !vendor) continue;

    const d = new Date(dstr + 'T00:00:00Z');
    if (isNaN(+d)) continue;

    const age = daysBetween(d, now);
    if (age > cutoffDays) continue;

    const w = typeWeight(type);
    const f = decayFactor(age);

    const s = (byVendor.get(vendor) || 0) + w * f;
    byVendor.set(vendor, s);
  }

  // 输出 CSV
  const rows = [['vendor','score','impact']];
  for (const [vendor, scoreRaw] of byVendor){
    const score = Math.round(scoreRaw * 100) / 100;
    const impact = impactOf(score, RULE.thresholds || {});
    rows.push([vendor, String(score), impact]);
  }
  rows.sort((a,b)=> (b[1]||0) - (a[1]||0)); // 按分数降序（跳过表头）

  const out = rows.map(r=>r.join(',')).join('\n');
  fs.writeFileSync(OUT, out, 'utf8');

  console.log(`materiality: vendors=${rows.length-1}, out=${path.relative(ROOT, OUT)}`);
}

run();
