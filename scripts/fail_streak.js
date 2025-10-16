#!/usr/bin/env node
/**
 * fail_streak.js — 记录 Auto Acceptance 连续失败天数（持久化在 repo）
 * 用法：
 *   # 失败时（在 workflow 的 if: failure() 步骤调用）
 *   node scripts/fail_streak.js
 *
 *   # 成功时重置（在 workflow 的 if: success() 步骤调用）
 *   node scripts/fail_streak.js --reset
 *
 * 输出（通过 GITHUB_OUTPUT）：
 *   streak=<N>                连续失败天数
 *   last_fail_date=YYYY-MM-DD 最近一次失败日期
 *   last_pass_date=YYYY-MM-DD 最近一次通过日期（reset 时写入）
 *   should_notify=true|false  streak >= NOTIFY_ON_STREAK 时为 true
 *
 * 环境变量（可选）：
 *   NOTIFY_ON_STREAK  触发提醒的门槛（默认 2）
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const STATE_DIR = path.join(ROOT, 'artifacts');
const STATE_FILE = path.join(STATE_DIR, 'ops_state.json');

const todayUTC = new Date().toISOString().slice(0, 10);
const args = process.argv.slice(2);
const isReset = args.includes('--reset') || args.some(a => /^--mode=pass$/i.test(a));
const notifyThreshold = Number(process.env.NOTIFY_ON_STREAK || 2);

function readJSON(fp) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf8')); }
  catch { return null; }
}

function writeJSON(fp, obj) {
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, JSON.stringify(obj, null, 2));
}

function appendStepSummary(md) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n', 'utf8');
  }
}

function setOutput(k, v) {
  if (!process.env.GITHUB_OUTPUT) return;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${String(v)}\n`);
}

(function main() {
  let state = readJSON(STATE_FILE) || {
    streak: 0,
    last_fail_date: null,
    last_pass_date: null
  };

  if (isReset) {
    // 成功通过验收 → 清零失败计数
    state.streak = 0;
    state.last_pass_date = todayUTC;
  } else {
    // 失败：同一天多次失败不重复加一
    if (state.last_fail_date === todayUTC) {
      // no-op
    } else {
      // 如果上次是成功，则从 1 重新计数；否则 +1
      if (state.last_pass_date && (!state.last_fail_date || state.last_pass_date >= state.last_fail_date)) {
        state.streak = 1;
      } else {
        state.streak = (state.streak || 0) + 1;
      }
      state.last_fail_date = todayUTC;
    }
  }

  writeJSON(STATE_FILE, state);

  const shouldNotify = !isReset && state.streak >= notifyThreshold;

  // 控制台输出（便于在 Logs 里查看）
  const mode = isReset ? 'PASS/RESET' : 'FAIL/INCREMENT';
  console.log(`[fail_streak] mode=${mode} date=${todayUTC} streak=${state.streak} last_fail=${state.last_fail_date || '-'} last_pass=${state.last_pass_date || '-'}`);
  if (shouldNotify) console.log(`[fail_streak] threshold reached: streak >= ${notifyThreshold}`);

  // Step Summary（可选）
  appendStepSummary([
    '### Fail Streak',
    `- Mode: **${mode}**`,
    `- Date (UTC): **${todayUTC}**`,
    `- Streak: **${state.streak}**`,
    `- Last fail: **${state.last_fail_date || '-'}**`,
    `- Last pass: **${state.last_pass_date || '-'}**`,
    shouldNotify ? `- 🚨 Reached threshold **${notifyThreshold}** — consider sending alert` : ''
  ].join('\n'));

  // 输出给后续步骤使用
  setOutput('streak', state.streak);
  setOutput('last_fail_date', state.last_fail_date || '');
  setOutput('last_pass_date', state.last_pass_date || '');
  setOutput('should_notify', shouldNotify ? 'true' : 'false');
})();
