#!/usr/bin/env node
/**
 * 统一读取模板 + 变量替换 + Impact/PackUrl 生成
 * 使用：const { composeSubject, composeBody, toImpact, resolvePackUrl, pickTopic } = require('./outreach_templates');
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SITE_ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const SUBJECT_PATH = path.join(ROOT, 'templates', 'outreach_subject.txt');
const BODY_PATH    = path.join(ROOT, 'templates', 'outreach_body.txt');

/** 主题类别英文化（可按需覆盖） */
function pickTopic(type) {
  const map = { Pricing: 'Pricing', ToS: 'Terms of Service', DPA: 'DPA', Subprocessors: 'Subprocessors', Status: 'Status' };
  return map[type] || type;
}

/** 业务影响映射 */
function toImpact(type){
  if (type === 'Pricing') return 'Budget/renewal risk';
  if (type === 'ToS') return 'Legal/arbitration/termination';
  if (type === 'DPA') return 'Privacy/processing terms';
  if (type === 'Subprocessors') return 'Vendor risk/DP addendum';
  if (type === 'Status') return 'SLA/incident history';
  return 'Contract/Compliance';
}

/** 尝试定位 Change Pack 页面；找不到则退化到 /updates/?q= */
function resolvePackUrl(vendor, isoYM /* 'YYYY-MM' */) {
  const ym = isoYM || new Date().toISOString().slice(0,7);
  const localPath = path.join(ROOT, 'reports', ym, vendor, 'index.html');
  if (fs.existsSync(localPath)) {
    return `${SITE_ORIGIN}/reports/${ym}/${vendor}/`;
  }
  return `${SITE_ORIGIN}/updates/?q=${encodeURIComponent(vendor)}`;
}

/** 读取模板文件（若不存在则内置默认） */
function readTpl(filePath, fallback) {
  try {
    return fs.readFileSync(filePath, 'utf8').trim();
  } catch {
    return fallback.trim();
  }
}

const DEFAULT_SUBJECT = '[Evidence] {Vendor} changed {Topic} on {Date}';
const DEFAULT_BODY = [
  'We detected a public change on {Vendor}: {Topic} ({Date}).',
  'Impact: {Impact}. Opt-out anytime.',
  'See verifiable details → {PackUrl}',
].join('\n');

function replaceVars(tpl, vars) {
  return tpl
    .replace(/\{Vendor\}/g, vars.Vendor)
    .replace(/\{Topic\}/g, vars.Topic)
    .replace(/\{Date\}/g, vars.Date)
    .replace(/\{Impact\}/g, vars.Impact)
    .replace(/\{PackUrl\}/g, vars.PackUrl);
}

/** 组装邮件主题 */
function composeSubject({ vendor, topic, dateISO }) {
  const tpl = readTpl(SUBJECT_PATH, DEFAULT_SUBJECT);
  return replaceVars(tpl, {
    Vendor: vendor,
    Topic: pickTopic(topic),
    Date: (dateISO || new Date().toISOString().slice(0,10)),
    Impact: '', // 主题里不用
    PackUrl: '', // 主题里不用
  });
}

/** 组装纯文本正文（三行） */
function composeBody({ vendor, topic, dateISO, impact, packUrl }) {
  const tpl = readTpl(BODY_PATH, DEFAULT_BODY);
  return replaceVars(tpl, {
    Vendor: vendor,
    Topic: pickTopic(topic),
    Date: (dateISO || new Date().toISOString().slice(0,10)),
    Impact: impact || toImpact(topic),
    PackUrl: packUrl || resolvePackUrl(vendor, (dateISO||'').slice(0,7)),
  });
}

module.exports = { composeSubject, composeBody, toImpact, resolvePackUrl, pickTopic };
