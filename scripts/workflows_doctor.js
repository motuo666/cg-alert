#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const YAML = require('yaml');

const ROOT = process.cwd();
const WF_DIR = path.join(ROOT, '.github', 'workflows');

function* eachWorkflow() {
  if (!fs.existsSync(WF_DIR)) return;
  for (const name of fs.readdirSync(WF_DIR)) {
    if (!/\.(ya?ml)$/i.test(name)) continue;
    yield path.join(WF_DIR, name);
  }
}

function sanitize(text) {
  let s = text.replace(/\r\n/g, '\n').replace(/\t/g, '  ');
  s = s.replace(/^\uFEFF/, '');
  s = s.replace(/^((\s*['"]?(?:true|false)['"]?\s*\n)+)/i, '');
  s = s.replace(/^\s*git add public reports \|\| true\s*\n/gm, '');
  return s;
}

let scanned=0, fixed=0, failed=[];

for (const file of eachWorkflow()) {
  scanned++;
  const orig = fs.readFileSync(file, 'utf8');
  let s = sanitize(orig);
  let doc;
  try {
    doc = YAML.parseDocument(s);
    if (doc.errors && doc.errors.length) throw doc.errors[0];
  } catch (e) {
    s = s.replace(/^(\s*['"]?(?:true|false)['"]?\s*\n)+/i, '');
    try {
      doc = YAML.parseDocument(s);
      if (doc.errors && doc.errors.length) throw doc.errors[0];
    } catch (e2) {
      failed.push(path.basename(file)+': '+(e2.message||e2.toString()));
      continue;
    }
  }

  let on = doc.get('on');
  if (!on) {
    doc.set('on', { workflow_dispatch: null });
  } else if (Array.isArray(on)) {
    if (!on.includes('workflow_dispatch')) on.push('workflow_dispatch');
  } else if (typeof on === 'object') {
    if (!('workflow_dispatch' in on)) {
      let cur = doc.get('on');
      if (cur && typeof cur === 'object') cur['workflow_dispatch'] = null;
      else doc.set('on', { workflow_dispatch: null });
    }
  } else {
    doc.set('on', { workflow_dispatch: null });
  }

  if (!doc.get('name')) {
    const base = path.basename(file).replace(/\.(ya?ml)$/i, '');
    const human = base.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    doc.set('name', human);
  }

  const out = doc.toString();
  if (out !== orig) {
    fs.writeFileSync(file, out, 'utf8');
    fixed++;
  }
}

console.log(`workflows-doctor: scanned=${scanned} fixed=${fixed} failed=${failed.length}`);
if (failed.length) {
  console.log('Unfixed:');
  for (const f of failed) console.log(' -', f);
