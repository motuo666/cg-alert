#!/usr/bin/env node
/**
 * 扫描 evidence/<slug>/<YYYY-MM-DD>-<Type>-<hash>.json（也兼容下划线及更宽类型写法）
 * 生成 data/evidence.ndx（TSV）：date \t slug \t type \t hash \t path
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EVD  = path.join(ROOT, 'evidence');
const OUT  = path.join(ROOT, 'data', 'evidence.ndx');

// 更宽松的文件名匹配：分隔符支持 - 或 _；type 放宽为非斜杠的任意字符（最短匹配）；hash 16 进制 6+ 位
const RE = /^evidence\/([^/]+)\/(\d{4}-\d{2}-\d{2})[-_]([^\/]+?)[-_]([a-f0-9]{6,})\.json$/i;

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) yield* walk(p);
    else yield p;
  }
}

function fallbackParse(fullPath) {
  try {
    const j = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
    // 尝试从 JSON 里取字段
    const date = j.date || j.detected_at || j.when || '';
    const type = j.type || j.kind || '';
    const hash = j.hash || j.digest || '';
    return { date: String(date).slice(0,10), type, hash };
  } catch {
    return { date: '', type: '', hash: '' };
  }
}

(function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const lines = [];

  for (const f of walk(EVD)) {
    if (!/\.json$/i.test(f)) continue;
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');

    let slug, date, type, hash;
    const m = rel.match(RE);
    if (m) {
      [, slug, date, type, hash] = m;
    } else {
      // 读 JSON 兜底
      const fb = fallbackParse(path.join(ROOT, rel));
      // slug = 上级目录名
      slug = rel.split('/')[1] || '';
      date = fb.date || '';
      type = fb.type || 'Change';
      hash = fb.hash || '';
    }

    if (!date) continue; // 没日期就不索引
    lines.push([date, slug, type, hash, rel].join('\t'));
  }

  lines.sort(); // 按日期排序
  fs.writeFileSync(OUT, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  console.log(`indexed: ${lines.length} records -> ${path.relative(ROOT, OUT)}`);
})();
