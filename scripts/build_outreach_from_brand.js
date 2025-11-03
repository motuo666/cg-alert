// scripts/build_outreach_from_brand.js
/**
 * Build outreach templates (A/B) from config/brand.json and set active template.
 * Safe to run on CI. Outputs:
 *   - config/templates/outreach_A.html / .txt
 *   - config/templates/outreach_B.html / .txt
 *   - config/outreach_active.html / .txt (sync with outreach_ab.json.active)
 */
const fs = require('fs'); const path = require('path');

function loadJSON(p, fallback){ try{ return JSON.parse(fs.readFileSync(p,'utf8')); }catch{ return fallback; } }

const brand = loadJSON('config/brand.json', {
  sender_name: 'Jason',
  brand_name: 'CG Alert',
  opener_A: '我们把你关心的供应商 Pricing/ToS/DPA/Subprocessors/SLA 改动做成证据卡（URL · 时间戳 · SHA256），续约时可直接粘贴到邮件里。',
  opener_B: '{{company}} 的续约筹码，不要凭感觉要凭证据。我们检测供应商改动并附上可审计字段（URL/时间戳/SHA256）与可直接粘贴的谈判措辞。',
  cta_A: '要不要我发你最近 3 个证据示例？直接回这封即可。',
  cta_B: '回这封列 2–3 个你最关心的供应商，我发你定制样例。',
  signoff: '— Jason @ CG Alert',
  subject: 'Evidence-backed vendor change alerts'
});

const ab = loadJSON('config/outreach_ab.json', { active: 'A', last_switch: 0 });
const active = ab.active || 'A';

function make(t){ return {
  html: `<p>${t.opener}</p><p><b>${t.cta}</b></p><p style="color:#666;font-size:12px">${brand.signoff}</p>`,
  txt:  `${t.opener}\n${t.cta}\n${brand.signoff}`
};}

function writeFile(p, s){ fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, s); }

(function main(){
  const A = make({ opener: brand.opener_A, cta: brand.cta_A });
  const B = make({ opener: brand.opener_B, cta: brand.cta_B });
  writeFile('config/templates/outreach_A.html', A.html);
  writeFile('config/templates/outreach_A.txt',  A.txt);
  writeFile('config/templates/outreach_B.html', B.html);
  writeFile('config/templates/outreach_B.txt',  B.txt);

  const activeTpl = active === 'B' ? B : A;
  writeFile('config/outreach_active.html', activeTpl.html);
  writeFile('config/outreach_active.txt',  activeTpl.txt);

  console.log(`[brand] built A/B, active=${active}`);
})();