// CJS; injects unified CTA into pricing page under PUBLISH_DIR
const fs = require('node:fs/promises');
const path = require('node:path');

const PUB_DIR = path.join(process.cwd(), process.env.PUBLISH_DIR || 'public');
const ORIGIN = process.env.SITE_ORIGIN || 'https://www.cg-alert.com';
const PL_PORT = process.env.STRIPE_LINK_PORTFOLIO || '';
const PL_BUS  = process.env.STRIPE_LINK_BUSINESS  || '';
const OUT = path.join(PUB_DIR,'pricing','index.html');

const SNIPPET = (variant)=>`<!-- CTA-PATCH VARIANT:${variant} -->
<section id="cta-${variant}" style="max-width:960px;margin:32px auto;padding:16px;border:1px solid #e5e7eb;border-radius:16px">
  <h2 style="margin:0 0 8px">Start with verifiable vendor-change evidence</h2>
  <p style="margin:0 0 12px;color:#475569">Portfolio $2,988/yr · Business $6,000/yr · Enterprise $18,000+/yr</p>
  <div style="display:flex;gap:12px;flex-wrap:wrap">
    <a href="${PL_PORT}" style="padding:12px 16px;border-radius:12px;border:1px solid #0b62f2;text-decoration:none">Buy Portfolio</a>
    <a href="${PL_BUS}"  style="padding:12px 16px;border-radius:12px;border:1px solid #0b62f2;text-decoration:none">Buy Business</a>
    <a href="/intake/"   style="padding:12px 16px;border-radius:12px;border:1px solid #334155;text-decoration:none">Enterprise contact</a>
  </div>
  <p style="margin-top:12px;color:#475569">Includes email & Slack alerts, timestamped evidence cards (SHA-256), and renewal escalation language.</p>
</section>`;

(async function(){
  try{
    await fs.mkdir(path.dirname(OUT),{recursive:true});
    let html = '';
    try{ html = await fs.readFile(OUT,'utf8'); } catch {}
    const variant = (process.env.PRICING_CTA_VARIANT || 'A').toUpperCase();
    const snippet = SNIPPET(variant);
    if(html.includes('CTA-PATCH')){
      console.log('pricing cta already patched');
    }else{
      if(html.includes('</body>')) html = html.replace('</body>', snippet + '\n</body>');
      else html = (html||'') + '\n' + snippet + '\n';
      await fs.writeFile(OUT, html || `<!doctype html><meta charset="utf-8"><title>Pricing — CG Alert</title>${snippet}`, 'utf8');
      console.log('pricing cta patched variant', variant, '->', OUT);
    }
  }catch(e){
    console.error(e); process.exit(1);
  }
})();
