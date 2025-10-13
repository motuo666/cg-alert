#!/usr/bin/env node
// endpoint_inventory.js — 基于 data/domains.csv 生成 data/endpoints.csv（三列：host,url,type）
// 幂等：合并已有 endpoints.csv；去重；忽略明显的种子/示例域。
const fs = require('fs');
const path = require('path');

const DOMAINS = path.join(__dirname, '..', 'data', 'domains.csv');
const OUT = path.join(__dirname, '..', 'data', 'endpoints.csv');

if (!fs.existsSync(DOMAINS)) { process.stdout.write('[inventory] no domains.csv → skip\n'); process.exit(0); }

const normHost = (s) => {
  s = String(s || '').trim().replace(/^"|"$/g,'');
  s = s.split(/[\s,]+/)[0].trim();
  s = s.replace(/^https?:\/\//,'').replace(/\/.*/,'').replace(/^www\./,'').toLowerCase();
  s = s.replace(/[^a-z0-9._-]/g,'');
  return s;
};
const badHost = (h) => !h || /^(_seed|acme|example)\./i.test(h) || /^(_seed|example)$/.test(h);

const raw = fs.readFileSync(DOMAINS, 'utf8').replace(/^\uFEFF/, '');
const domains = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(normHost).filter(h => !badHost(h));
const uniq = Array.from(new Set(domains));

function urlsForHost(host){
  const h = host.toLowerCase();
  const base = `https://${h}`;
  const statusHost = `https://status.${h}`;
  const list = [
    [ `${base}/pricing`, 'Pricing' ],
    [ `${base}/plans`, 'Pricing' ],
    [ `${base}/terms`, 'ToS' ],
    [ `${base}/tos`, 'ToS' ],
    [ `${base}/legal/terms`, 'ToS' ],
    [ `${base}/privacy`, 'Privacy' ],
    [ `${base}/legal/privacy`, 'Privacy' ],
    [ `${base}/privacy-policy`, 'Privacy' ],
    [ `${base}/dpa`, 'DPA' ],
    [ `${base}/legal/dpa`, 'DPA' ],
    [ `${base}/data-processing-addendum`, 'DPA' ],
    [ `${base}/subprocessors`, 'Subprocessors' ],
    [ `${base}/sub-processors`, 'Subprocessors' ],
    [ `${base}/.well-known/security.txt`, 'Security' ],
    [ `${statusHost}/`, 'Status' ],
    [ `${statusHost}/api/v2/summary.json`, 'StatusAPI' ],
  ];
  return list.map(([u,t]) => `${h},${u},${t}`);
}

let existing = [];
if (fs.existsSync(OUT)) {
  existing = fs.readFileSync(OUT,'utf8').split(/\r?\n/).filter(Boolean).filter(l => (l.match(/,/g)||[]).length >= 2);
}

const generated = new Set(existing);
for (const h of uniq) for (const line of urlsForHost(h)) generated.add(line);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Array.from(generated).join('\n')+'\n', 'utf8');
process.stdout.write(`[inventory] endpoints=${generated.size}, domains=${uniq.length}\n`);
