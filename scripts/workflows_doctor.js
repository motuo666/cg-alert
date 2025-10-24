#!/usr/bin/env node
// Fixed version: robust YAML doctor for .github/workflows/*.yml
const fs = require('fs');
const path = require('path');
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

function stripBOMTabsAndBooleans(text) {
  let s = text.replace(/\r\n/g, '\n').replace(/\t/g, '  ');
  // strip BOM
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
  // drop leading true/false lines
  s = s.replace(/^(\s*['"]?(?:true|false)['"]?\s*\n)+/i, '');
  return s;
}

function dropTopLevelStrays(text) {
  // Remove obvious stray shell lines that are not indented under a run block
  let s = text;
  s = s.replace(/^\s*git add public reports \|\| true\s*$(\r?\n)?/gmi, '');
  s = s.replace(/^\s*echo\s+["']?.*["']?\s*$(\r?\n)?/gmi, s => {
    // keep echo lines inside run blocks only (naive: if starts with 0-1 indentation, drop)
    const indent = s.match(/^\s*/)[0].length;
    return indent <= 1 ? '' : s;
  });
  return s;
}

function cutUntilFirstKey(text) {
  // If the beginning still has garbage, cut everything until the first YAML key (xxx:)
  const lines = text.split('\n');
  let start = 0;
  const keyRe = /^[A-Za-z_][\w\-]*\s*:/;
  for (let i = 0; i < lines.length; i++) {
    if (keyRe.test(lines[i])) { start = i; break; }
  }
  return lines.slice(start).join('\n');
}

function ensureOnAndName(doc, filename) {
  // Ensure on.workflow_dispatch
  let onVal = doc.get('on');
  if (!onVal) {
    doc.set('on', { workflow_dispatch: null });
  } else if (Array.isArray(onVal)) {
    if (!onVal.includes('workflow_dispatch')) onVal.push('workflow_dispatch');
  } else if (typeof onVal === 'object') {
    const m = doc.get('on') || {};
    if (!('workflow_dispatch' in m)) m['workflow_dispatch'] = null;
    doc.set('on', m);
  } else {
    doc.set('on', { workflow_dispatch: null });
  }
  // Ensure name
  if (!doc.get('name')) {
    const base = path.basename(filename).replace(/\.(ya?ml)$/i, '');
    const human = base.replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    doc.set('name', human);
  }
}

let scanned = 0, fixed = 0, failed = [];

for (const file of eachWorkflow()) {
  scanned++;
  const orig = fs.readFileSync(file, 'utf8');
  let s = stripBOMTabsAndBooleans(orig);
  s = dropTopLevelStrays(s);

  let doc;
  try {
    doc = YAML.parseDocument(s);
    if (doc.errors && doc.errors.length) throw doc.errors[0];
  } catch (e1) {
    // aggressive: cut junk before first key and retry
    try {
      const cut = cutUntilFirstKey(s);
      doc = YAML.parseDocument(cut);
      if (doc.errors && doc.errors.length) throw doc.errors[0];
      s = cut;
    } catch (e2) {
      failed.push(path.basename(file) + ': ' + (e2.message || e2.toString()));
      continue;
    }
  }

  ensureOnAndName(doc, file);
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
}
process.exit(0);
