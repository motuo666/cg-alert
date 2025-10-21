// utils.js (覆盖版，CommonJS)
const fs = require('fs');
const fse = require('fs-extra');
const path = require('path');
const dayjs = require('dayjs');

// 尝试启用 dayjs UTC 插件（可选，有则用）
try {
  const utc = require('dayjs/plugin/utc');
  dayjs.extend(utc);
} catch (_) {}

function asDay(d) {
  // 若已加载 utc 插件则走 UTC，否则走本地时间
  return typeof dayjs.utc === 'function' ? dayjs.utc(d) : dayjs(d);
}

function loadJSON(p, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return fallback;
  }
}

function ensureDir(p) {
  fse.ensureDirSync(p);
}

function writeText(p, s) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, s, 'utf-8');
}

function fmtDate(d) {
  return asDay(d).format('YYYY-MM-DD');
}

function yyyymm(d = new Date()) {
  return asDay(d).format('YYYY-MM');
}

module.exports = {
  loadJSON,
  ensureDir,
  writeText,
  fmtDate,
  yyyymm,
};
