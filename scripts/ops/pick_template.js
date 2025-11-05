// scripts/ops/pick_template.js
// AB template picker with persona & channel outputs
// Usage:
//   node scripts/ops/pick_template.js --channel email|slack --theme default --persona security --date 2025-11-05
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');

function read(p){ try { return fs.readFileSync(p,'utf8'); } catch { return ''; } }
function ensureDir(p){ fs.mkdirSync(p, { recursive: true }); }
function hashInt(s){ return parseInt(crypto.createHash('sha1').update(s).digest('hex').slice(0,8),16); }
function interpolate(tpl, map){ return tpl.replace(/\{\{(\w+)\}\}/g, (_,k)=> (map[k] ?? '')); }

const args = process.argv.slice(2);
const arg = (k, d='') => { const i = args.indexOf(`--${k}`); return i>=0 ? (args[i+1] || d) : d; };

const today   = arg('date', new Date().toISOString().slice(0,10));
const ym      = today.slice(0,7);
const theme   = arg('theme', 'default');
const channel = arg('channel', 'email'); // email|slack
const persona = arg('persona', 'default');

const seed = `${today}|${process.env.GITHUB_WORKFLOW||''}|${process.env.GITHUB_RUN_ID||''}|${process.env.GITHUB_JOB||''}|${channel}|${theme}|${persona}`;

function findVariants(base) {
  try {
    return fs.readdirSync(base).filter(v => {
      const subj = path.join(base, v, 'subject.txt');
      const body = path.join(base, v, 'body.md');
      return fs.existsSync(subj) || fs.existsExists?.(body) || fs.existsSync(body);
    });
  } catch { return []; }
}

// directory priority: monthly > default; persona > fallback
const monthlyBase = path.join('config','templates', ym, theme, channel, persona);
const monthlyPersonaParent = path.join('config','templates', ym, theme, channel);
const defaultBase = path.join('config','templates', 'default', theme, channel, persona);
const defaultPersonaParent = path.join('config','templates', 'default', theme, channel);

let basesTried = [];
function collectVariants() {
  let bases = [
    monthlyBase,
    defaultBase
  ];
  // if persona dir empty, fallback to parent (non-persona) directory
  return bases.flatMap(base => {
    basesTried.push(base);
    try {
      let variants = fs.readdirSync(base).filter(v => {
        const subj = path.join(base, v, 'subject.txt');
        const body = path.join(base, v, 'body.md');
        return fs.existsSync(subj) || fs.existsSync(body);
      });
      return variants.map(v => ({base, v}));
    } catch {
      // try parent without persona
      const parent = base.split(path.sep).slice(0,-1).join(path.sep);
      try {
        let variants = fs.readdirSync(parent).filter(v => {
          const subj = path.join(parent, v, 'subject.txt');
          const body = path.join(parent, v, 'body.md');
          return fs.existsSync(subj) || fs.existsSync(body);
        });
        basesTried.push(parent);
        return variants.map(v => ({base: parent, v}));
      } catch { return []; }
    }
  });
}

const candidates = collectVariants();
if (candidates.length === 0) {
  console.log(`[pick_template] no variants under any: ${basesTried.join(', ')}`);
  process.exit(0);
}

const idx = hashInt(seed) % candidates.length;
const sel = candidates[idx];
const chosenDir = path.join(sel.base, sel.v);

const subjPath = path.join(chosenDir, 'subject.txt');
const bodyPath = path.join(chosenDir, 'body.md');
const subject  = read(subjPath);
const body     = read(bodyPath);

// Interpolate
const map = {
  DATE: today,
  THEME: theme,
  PERSONA: persona,
  BRAND: process.env.BRAND || 'CG Alert',
  COMPANY: process.env.COMPANY || '',
  WINDOW: process.env.WINDOW || '',
  EVIDENCE: process.env.EVIDENCE || '',
};
const outDir = path.join('out','templates'); ensureDir(outDir);
let subjectOut = '', bodyOut = '';
if (channel === 'email') {
  subjectOut = path.join(outDir, 'email_subject.txt');
  bodyOut    = path.join(outDir, 'email_body.md');
  fs.writeFileSync(subjectOut, interpolate(subject, map));
  fs.writeFileSync(bodyOut, interpolate(body, map));
} else {
  bodyOut    = path.join(outDir, 'slack_body.md');
  fs.writeFileSync(bodyOut, interpolate(body, map));
}

// Update stats
const statDir = path.join('reports','ops'); ensureDir(statDir);
const statFile = path.join(statDir, 'template_stats.json');
let stats={}; try { stats = JSON.parse(read(statFile)); } catch { stats = {}; }
const key = `${ym}/${theme}/${channel}/${persona}/${sel.v}`;
stats[key] = stats[key] || { uses: 0, last_at: null };
stats[key].uses += 1;
stats[key].last_at = new Date().toISOString();
fs.writeFileSync(statFile, JSON.stringify(stats, null, 2));

// Emit outputs
const out = process.env.GITHUB_OUTPUT;
if (out) {
  if (channel === 'email') {
    fs.appendFileSync(out, `subject_path=${subjectOut}\n`);
    fs.appendFileSync(out, `body_path=${bodyOut}\n`);
  } else {
    fs.appendFileSync(out, `slack_body_path=${bodyOut}\n`);
  }
  fs.appendFileSync(out, `template_key=${key}\n`);
}
console.log(`[pick_template] ${key} -> ${subjectOut || '(no-subject)'} ${bodyOut}`);
