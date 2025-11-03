// scripts/ab_rotate.js
const fs = require('fs'); const path = require('path');
const today = new Date();

const cfgPath = 'config/outreach_ab.json';
const activeHtml = 'config/outreach_active.html';
const activeTxt  = 'config/outreach_active.txt';

function pickVariant(cfg){
  // Rotate every 14 days
  const last = new Date(cfg.last_switch || 0);
  const days = (today - last) / (1000*3600*24);
  if (days >= 14) return cfg.active === 'A' ? 'B' : 'A';
  return cfg.active || 'A';
}

function loadTpl(variant){
  const base = `config/templates/outreach_${variant}`;
  return {
    html: fs.existsSync(`${base}.html`) ? fs.readFileSync(`${base}.html`,'utf8') : '<p>Hi {{name}}, …</p>',
    txt:  fs.existsSync(`${base}.txt`) ? fs.readFileSync(`${base}.txt`,'utf8') : 'Hi {{name}}, …'
  };
}

(function main(){
  let cfg = { active:'A', last_switch:0 };
  if (fs.existsSync(cfgPath)) {
    try { cfg = JSON.parse(fs.readFileSync(cfgPath,'utf8')); } catch {}
  }
  const next = pickVariant(cfg);
  const tpl = loadTpl(next);
  fs.mkdirSync('config', {recursive:true});
  fs.writeFileSync(activeHtml, tpl.html);
  fs.writeFileSync(activeTxt, tpl.txt);
  cfg.active = next; cfg.last_switch = today.toISOString();
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  console.log(`[ab] active=${next}`);
})();
