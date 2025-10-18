#!/usr/bin/env node
// scripts/fix_sent_today.js — v2.0（覆盖版）
// 目的：
// - 同步 sent_today（顶层 >0 优先，否则用 kpi.sent_today）；两边保持一致
// - 从 kpi.hash_ratio（0..1 或 0..100）生成友好的顶层 hash_coverage（如 "42.5%"）
//   * 若缺失，则尝试解析顶层 hash_coverage 的百分数字符串回写 kpi.hash_ratio_pct
// - 仅重建与“当日发送量低于门槛”相关的 WARN（默认门槛 8，可用 DAILY_SEND_TARGET 覆盖）
// - 容错、幂等、不影响其它 PASS/WARN/FAIL 项

"use strict";

const fs = require("fs");
const PATH = "artifacts/daily_ops.json";
const DAILY_TARGET = Number(process.env.DAILY_SEND_TARGET || 8);

if (!fs.existsSync(PATH)) {
  console.log("fix_sent_today: no daily_ops.json, skip");
  process.exit(0);
}

let data;
try {
  const raw = fs.readFileSync(PATH, "utf8");
  data = JSON.parse(raw);
} catch (e) {
  console.error("fix_sent_today: invalid JSON, skip");
  process.exit(0);
}

const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
data.kpi = isObj(data.kpi) ? data.kpi : {};

// ---------- 数值/格式工具 ----------
const toNum = (v) => {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim().replace(/[%\s,]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};
const round1 = (n) => Math.round(n * 10) / 10;

// ---------- 1) sent_today 同步 ----------
const sentTop = toNum(data.sent_today);
const sentKpi = toNum(data.kpi.sent_today);
let fixedSent = sentTop > 0 ? sentTop : sentKpi;
if (fixedSent < 0) fixedSent = 0;

if (fixedSent > 0) {
  data.sent_today = fixedSent;
  data.kpi.sent_today = fixedSent;
}

// ---------- 2) 生成友好的 hash_coverage ----------
let pct = undefined;

// 优先从 kpi.hash_ratio 推导
if (data.kpi.hash_ratio !== undefined) {
  pct = toNum(data.kpi.hash_ratio);
  if (pct <= 1) pct *= 100; // 支持 0..1 输入
  pct = round1(pct);
} else if (data.hash_coverage) {
  // 其次从顶层 hash_coverage（如 "42.5%"）回推
  const hc = toNum(data.hash_coverage);
  if (hc >= 0) pct = round1(hc);
}

if (pct !== undefined) {
  data.kpi.hash_ratio_pct = pct;      // 例如 42.5
  data.hash_coverage = `${pct}%`;     // 顶层展示
}

// ---------- 3) 仅重建“发送量不足”相关 WARN ----------
const warnArr = Array.isArray(data.WARN) ? data.WARN : [];

// 清除既有“发送量低于目标”的中英提示，避免重复
const isSendWarn = (w = "") =>
  /发送量.*低于.*目标/i.test(w) ||
  /sent.*below.*target/i.test(w) ||
  /daily\s*send.*below/i.test(w);

const cleanedWarn = warnArr.filter((w) => !isSendWarn(w));

// 低于门槛则重建条目
if (fixedSent < DAILY_TARGET) {
  cleanedWarn.push(`今日发送量低于目标 ${fixedSent}/${DAILY_TARGET}`);
}
data.WARN = cleanedWarn;

// 兜底数组
if (!Array.isArray(data.PASS)) data.PASS = [];
if (!Array.isArray(data.FAIL)) data.FAIL = [];

// ---------- 4) 写回 ----------
try {
  fs.writeFileSync(PATH, JSON.stringify(data, null, 2));
  console.log(
    `fix_sent_today: date=${data.date || "n/a"} sent_today=${fixedSent} ` +
    `hash_coverage=${data.hash_coverage || "n/a"} target=${DAILY_TARGET}`
  );
} catch (e) {
  console.error("fix_sent_today: write failed:", e.message);
  process.exit(1);
}
