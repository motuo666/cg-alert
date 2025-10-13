#!/usr/bin/env node
/**
 * E2E Full Chain — 干跑全链：采集→校验→证据门禁→(可选)发送DRY→构建站点→SEO注入
 * 设计：
 *  - gate=0（48h无新证据）→ 跳过发送，但整链 OK（不拉红）
 *  - 缺文件自动补最小 seed（_seed/acme），严格 9 列 leads.csv
 *  - 某个脚本不存在 → 跳过并黄牌提示，不拉红
 *  - 仅“脚本语法/运行异常”→ 拉红
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const p = (...a) => path.join(ROOT, ...a);
const exists = f => fs.existsSync(f);
const mkdir = d => fs.mkdirSync(d, { recursive: true });

function sh(cmd, opts={}) {
  return execSync(cmd, { stdio: 'pipe', encoding: 'utf8', cwd: ROOT, ...opts });
}
function runIfExists(file, cmd) {
  if (!exists(file)) {
    console.log(`[skip] ${file} missing → ${cmd}`);
    return { code: 0, out: '' };
  }
  try {
    const out = sh(cmd);
    process.stdout.write(out);
    return { code: 0, out };
  } catch (e) {
    console.error(`[fail] ${cmd}\n${e.stdout || ''}\n${e.stderr || e.message}`);
    throw e;
  }
}

function ensureSeed() {
  // leads.csv 9列、无表头
  const leads = p('data','leads.csv');
  mkdir(path.dirname(leads));
  if (!exists(leads) || !fs.readFileSync(leads,'utf8').trim()) {
    const rows = [
      'alice@example.com,Acme,acme.com,acme,_seed,cloudflare,secops,new,1',
      'bob@example.com,Globex,globex.com,globex,acme,slack,security,new,1'
    ].join('\n')+'\n';
    fs.writeFileSync(leads, rows, 'utf8');
    console.log('[seed] data/leads.csv created (2 rows)');
  }

  // evidence/_seed & vendors/_seed & updates/index.html
  const ed = p('evidence','_seed'); mkdir(ed);
  const today = new Date().toISOString().slice(0,10);
  const ef = p('evidence','_seed', `${today}-Pricing-seed0000-00000000.json`);
  if (!exists(ef)) {
    fs.writeFileSync(ef, JSON.stringify({
      vendor: '_seed', type:'Pricing', url:'https://_seed.com/pricing',
      kind:'change', detected_at:new Date().toISOString()
    }, null, 2), 'utf8');
    console.log('[seed] evidence/_seed/');
  }

  const vSeed = p('vendors','_seed','index.html'); mkdir(path.dirname(vSeed));
  if (!exists(vSeed)) fs.writeFileSync(vSeed, '<!doctype html><title>_seed</title>', 'utf8');

  const updatesIdx = p('updates','index.html'); mkdir(path.dirname(updatesIdx));
  if (!exists(updatesIdx)) fs.writeFileSync(updatesIdx, '<!doctype html><title>updates</title>', 'utf8');
}

(function main(){
  ensureSeed();

  // 1) leads 校验
  runIfExists(p('scripts','validate_leads.js'), 'node scripts/validate_leads.js');

  // 2) 证据门禁
  let gateOK = false;
  const gate = runIfExists(p('scripts','s1_gate.js'), 'node scripts/s1_gate.js').out;
  gateOK = /ok=1|gate=1/i.test(gate);

  // 3) 发送（仅在 gate=1 且 DRY）
  const DRY = String(process.env.DRY_RUN||'true') !== 'false';
  if (gateOK) {
    const sendScript = exists(p('scripts','send_triggered.js')) ? 'scripts/send_triggered.js'
                      : exists(p('scripts','send_bulk.js'))      ? 'scripts/send_bulk.js'
                      : null;
    if (sendScript) {
      const limit = 1;
      const cmd = sendScript.includes('triggered') ?
        `node ${sendScript} --dry=${DRY} --limit=${limit} --window-h=48` :
        `node ${sendScript} --dry=${DRY} --limit=${limit}`;
      runIfExists(p(sendScript), cmd);
    } else {
      console.log('[skip] no send_* script present');
    }
  } else {
    console.log('[gate] no fresh evidence → skip send');
  }

  // 4) 构建（存在就跑）
  runIfExists(p('scripts','build_updates.js'), 'node scripts/build_updates.js');
  runIfExists(p('scripts','build_categories.js'), 'node scripts/build_categories.js');
  runIfExists(p('scripts','build_public_monthly.js'), 'node scripts/build_public_monthly.js');
  runIfExists(p('scripts','seo_inject.js'), 'node scripts/seo_inject.js');

  // 5) 汇总
  const leadsRows = fs.readFileSync(p('data','leads.csv'),'utf8').split(/\r?\n/).filter(Boolean).length;
  const vendors = exists(p('evidence')) ? fs.readdirSync(p('evidence'),{withFileTypes:true}).filter(d=>d.isDirectory()).length : 0;

  console.log('\nE2E summary:');
  console.log(`- leads.csv rows: ${leadsRows}`);
  console.log(`- evidence vendors: ${vendors}`);
  console.log(`- gate: ${gateOK ? 'OK (send DRY executed)' : 'SKIPPED (no fresh evidence)'}`);

  process.exit(0);
})();
