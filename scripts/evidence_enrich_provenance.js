#!/usr/bin/env node
/**
 * evidence_enrich_provenance.js
 * 为每条 evidence JSON 补充可核证“来源链”字段：
 * - commit: 本次运行关联的 git 短哈（7位）
 * - run_url: 触发本次构建的 GitHub Actions run 链接
 * - sha256: 若 evidence.hash 存在且非全0，则镜像到 sha256 字段（作为可核证指纹）
 *
 * 说明：
 * - 不联网；只读写仓库内文件
 * - 与 normalize_evidence.js 互补：该脚本不重新计算 http body 指纹，避免重复成本
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVD = path.join(ROOT, 'evidence');

const RUN_URL = process.env.RUN_URL || '';
const GIT_COMMIT = (process.env.GIT_COMMIT || '').slice(0, 7);

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, acc);
    else if (ent.isFile() && ent.name.endsWith('.json')) acc.push(p);
  }
  return acc;
}

function isZeros(s) { return /^0+$/i.test(String(s || '')); }

function run() {
  if (!fs.existsSync(EVD)) {
    console.error('evidence/ not found');
    process.exit(0);
  }
  const files = walk(EVD);
  let touched = 0;

  for (const fp of files) {
    try {
      const raw = fs.readFileSync(fp, 'utf8');
      const j = JSON.parse(raw);

      let changed = false;

      // 补充 sha256（仅映射已有 hash；真实计算由 normalize_evidence.js 负责）
      if (!j.sha256 && j.hash && !isZeros(j.hash)) {
        j.sha256 = j.hash;
        changed = true;
      }

      // 统一写入 commit / run_url
      if (GIT_COMMIT && j.commit !== GIT_COMMIT) { j.commit = GIT_COMMIT; changed = true; }
      if (RUN_URL && j.run_url !== RUN_URL) { j.run_url = RUN_URL; changed = true; }

      if (changed) {
        fs.writeFileSync(fp, JSON.stringify(j, null, 2));
        touched++;
      }
    } catch (e) {
      console.warn('skip bad json:', fp, String(e).slice(0, 120));
    }
  }

  console.log(`provenance enrich: files=${files.length}, updated=${touched}, commit=${GIT_COMMIT||'-'}`);
}

run();
