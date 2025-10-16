#!/usr/bin/env node
// CTA Injector (idempotent)
// - 在 reports/.../index.html、vendors/.../index.html、updates/index.html 注入双入口 CTA：
//   [Enable alerts] -> INTAKE_FORM_URL
//   [Buy Portfolio] -> STRIPE_LINK_PORTFOLIO
// - 保留 UTM：把当前页面的 utm_* 参数追加到按钮外链
// - 幂等：带标记，不重复注入
// - 不改页面主题配色（极简内联样式）

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGETS = [
  path.join(ROOT, 'updates', 'index.html'),
  path.join(ROOT, 'vendors'),
  path.join(ROOT, 'reports'),
];
const MARK_START = '<!-- CG-CTA-INJECT START -->';
const MARK_END = '<!-- CG-CTA-INJECT END -->';

const INTAKE = process.env.INTAKE_FORM_URL || '';      // e.g. Google Form
const STRIPE = process.env.STRIPE_LINK_PORTFOLIO || ''; // e.g. Stripe Payment Link

if (!INTAKE && !STRIPE) {
  console.log('cta_inject: no INTAKE_FORM_URL / STRIPE_LINK_PORTFOLIO provided, skip.');
  process.exit(0);
}

function walkHtmlFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const st = fs.statSync(dir);
  if (st.isFile() && dir.endsWith('index.html')) {
    out.push(dir);
    return out;
  }
  if (st.isDirectory()) {
    for (const name of fs.readdirSync(dir)) {
      const p = path.join(dir, name);
      const s = fs.statSync(p);
      if (s.isDirectory()) {
        walkHtmlFiles(p, out);
      } else if (s.isFile() && name === 'index.html') {
        out.push(p);
      }
    }
  }
  return out;
}

function escapeAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

function buildBlock() {
  const btns = [];
  if (INTAKE) {
    btns.push(`<a class="cg-btn cg-primary" id="btn-enable-alerts" data-utm-prop="1" href="${escapeAttr(INTAKE)}" target="_blank" rel="noopener noreferrer">Enable alerts</a>`);
  }
  if (STRIPE) {
    btns.push(`<a class="cg-btn cg-outline" id="btn-buy-portfolio" data-utm-prop="1" href="${escapeAttr(STRIPE)}" target="_blank" rel="noopener noreferrer">Buy Portfolio</a>`);
  }
  if (!btns.length) return '';

  const html = `
${MARK_START}
<div class="cg-cta" data-cg-cta>
  ${btns.join('\n  ')}
</div>
<script>
(function(){
  // 把当前 URL 的 utm_* 传递给 CTA 链接
  try{
    var src = new URL(window.location.href);
    var keys=['utm_source','utm_medium','utm_campaign','utm_term','utm_content'];
    function copyUtm(href){
      try{
        var u = new URL(href);
        keys.forEach(function(k){ if(src.searchParams.has(k)) u.searchParams.set(k, src.searchParams.get(k)); });
        return u.toString();
      }catch(e){ return href; }
    }
    var links = document.querySelectorAll('[data-utm-prop="1"]');
    links.forEach(function(a){ a.href = copyUtm(a.href); });
  }catch(e){}
})();
</script>
<style>
  .cg-cta{margin:16px 0;display:flex;gap:12px;flex-wrap:wrap}
  .cg-btn{display:inline-block;padding:10px 14px;border-radius:12px;border:1px solid #e5e7eb;text-decoration:none;font-size:14px}
  .cg-primary{background:#111827;color:#fff;border-color:#111827}
  .cg-outline{background:#fff;color:#111827}
  @media (prefers-color-scheme:dark){
    .cg-primary{background:#e5e7eb;color:#111827;border-color:#e5e7eb}
    .cg-outline{background:transparent;color:#e5e7eb;border-color:#374151}
  }
</style>
${MARK_END}`.trim();

  return html;
}

function injectInto(html, block) {
  if (!block) return html;
  if (html.includes(MARK_START)) return html; // 已注入

  // 优先放在第一个 </h1> 之后；否则作为 <body> 的第一个子元素
  const h1Close = html.indexOf('</h1>');
  if (h1Close !== -1) {
    const pos = h1Close + '</h1>'.length;
    return html.slice(0,pos) + '\n' + block + '\n' + html.slice(pos);
  }
  const bodyOpen = html.indexOf('<body');
  if (bodyOpen !== -1) {
    const gt = html.indexOf('>', bodyOpen);
    if (gt !== -1) {
      const pos = gt + 1;
      return html.slice(0,pos) + '\n' + block + '\n' + html.slice(pos);
    }
  }
  // 否则加到末尾
  return html + '\n' + block + '\n';
}

function main(){
  const files = [];
  for (const t of TARGETS) {
    if (!fs.existsSync(t)) continue;
    const st = fs.statSync(t);
    if (st.isFile()) files.push(t);
    else files.push(...walkHtmlFiles(t));
  }
  const block = buildBlock();
  if (!block) {
    console.log('cta_inject: no buttons to inject (missing envs).');
    return;
  }
  let injected = 0;
  for (const fp of files) {
    try{
      let html = fs.readFileSync(fp,'utf8');
      const newHtml = injectInto(html, block);
      if (newHtml !== html) {
        fs.writeFileSync(fp, newHtml, 'utf8');
        injected++;
      }
    }catch(e){
      console.warn('cta_inject: fail', fp, e && e.message);
    }
  }
  console.log(`cta_inject: files=${files.length}, injected=${injected}`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### CTA Inject\n- files: ${files.length}\n- injected: ${injected}\n`, 'utf8');
  }
}
main();
