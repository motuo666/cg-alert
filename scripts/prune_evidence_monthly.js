#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * 月归档 & 清理
 * 1) 将“上月”的 evidence 压缩为 artifacts/evidence-YYYY-MM.zip
 * 2) 删除 >90 天的 evidence 明细（索引仍保留）
 * 3) 不中断：无文件时不报错；zip 不可用时回退 tar.gz
 *
 * 约定的证据文件名：
 *   evidence/<slug>/<YYYY-MM-DD>-<Type>-<hash>.json
 */

"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const EVD_DIR = path.join(ROOT, "evidence");
const ART_DIR = path.join(ROOT, "artifacts");

function ym(d) {
  return d.toISOString().slice(0, 7); // YYYY-MM
}

function getTargetMonth() {
  const envMonth = (process.env.REPORT_MONTH || "").trim(); // 可为空
  if (/^\d{4}-\d{2}$/.test(envMonth)) return envMonth;

  const now = new Date();
  // 默认取“上一个月”
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return ym(last);
}

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, acc);
    else acc.push(p);
  }
  return acc;
}

function selectMonthFiles(files, month) {
  // 选出 baseName 以 `${YYYY-MM}-` 开头且匹配证据格式的
  return files.filter((f) => {
    const bn = path.basename(f);
    return (
      /^\d{4}-\d{2}-\d{2}-[A-Za-z]+-[a-f0-9]{6,}\.json$/.test(bn) &&
      bn.startsWith(month + "-")
    );
  });
}

function mkp(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function zipOrTar(paths, outZipPath) {
  if (!paths.length) return false;
  mkp(path.dirname(outZipPath));

  // 尝试 zip（Runner 上通常可用）
  try {
    const quoted = paths.map((p) => `"${p}"`).join(" ");
    execSync(`bash -lc "zip -q -9 -r '${outZipPath}' ${quoted}"`, { stdio: "inherit" });
    return true;
  } catch (_) {
    // 回退 tar.gz
    const tgz = outZipPath.replace(/\.zip$/, ".tar.gz");
    const quoted = paths.map((p) => `"${p}"`).join(" ");
    execSync(`bash -lc "tar -czf '${tgz}' ${quoted}"`, { stdio: "inherit" });
    console.log(`zip not available, used tar.gz -> ${path.relative(ROOT, tgz)}`);
    return true;
  }
}

function pruneOlderThan(days) {
  if (!fs.existsSync(EVD_DIR)) return 0;
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);

  let removed = 0;
  const files = walkFiles(EVD_DIR);
  for (const f of files) {
    const bn = path.basename(f);
    const m = bn.match(/^(\d{4}-\d{2}-\d{2})-/);
    if (!m) continue;
    const d = new Date(m[1] + "T00:00:00Z");
    if (d < cutoff) {
      try {
        fs.unlinkSync(f);
        removed++;
      } catch {}
    }
  }
  return removed;
}

function main() {
  const targetMonth = getTargetMonth();
  console.log(`target month: ${targetMonth}`);

  // 1) 打包上月证据
  const all = walkFiles(EVD_DIR);
  const monthFiles = selectMonthFiles(all, targetMonth);
  if (monthFiles.length) {
    const outZip = path.join(ART_DIR, `evidence-${targetMonth}.zip`);
    const ok = zipOrTar(monthFiles, outZip);
    if (ok) {
      console.log(`artifact: ${path.relative(ROOT, outZip)}`);
    }
  } else {
    console.log("no evidence files for target month; skip archive");
  }

  // 2) 清理 >90天
  const removed = pruneOlderThan(90);
  console.log(`prune: removed ${removed} files older than 90d (if any)`);

  console.log("done.");
}

main();
