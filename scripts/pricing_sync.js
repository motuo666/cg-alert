// scripts/pricing_sync.js
// 统一 CTA 到三挡：Portfolio($2,988) / Business($6,000) / Enterprise($18,000+, 表单)
// 读取 pricing/config.json，优先使用环境变量：STRIPE_LINK_PORTFOLIO / STRIPE_LINK_BUSINESS；
// Enterprise 走 contact_redirect（无则回退 INTAKE_FORM_URL）。不会因缺链接而退出，只降级为表单。

const fs = require('fs');
const path = require('path');

const ROOTS = ['.', 'seo', 'who-uses', 'enterprise', 'dashboard', 'pricing'];

const cfgPath = path.join(__dirname, '..', 'pricing', 'config.json');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

const INTAKE = process.env.INTAKE_FORM_URL || '/intake/';
const STRIPE_PORTFOLIO = process.env.STRIPE_LINK_PORTFOLIO || '';
const STRIPE_BUSINESS  = process.env.STRIPE_LINK_BUSINESS  || '';

function isHttp(s) { return typeof s === 'string' && /^https?:\/\//i.test(s); }
function resolveVar(str, ctx) {
  if (!str) return '';
  return String(str).replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => ctx[k] || '');
}

// 计算三挡目标链接
const plans = {};
for (const p of cfg.plans || []) {
  if (p.id === 'portfolio') {
    const fromCfg = resolveVar(p.checkout_redirect || '', { STRIPE_LINK_PORTFOLIO: STRIPE_PORTFOLIO });
    plans.portfolio = { title: p.name || 'Portfolio', href: isHttp(STRIPE_PORTFOLIO) ? STRIPE_PORTFOLIO : (isHttp(fromCfg) ? fromCfg : INTAKE) };
  } else if (p.id === 'business') {
    const fromCfg = resolveVar(p.checkout_redirect || '', { STRIPE_LINK_BUSINESS: STRIPE_BUSINESS });
    plans.business  = { title: p.name || 'Business',  href: isHttp(STRIPE_BUSINESS)  ? STRIPE_BUSINESS  : (isHttp(fromCfg) ? fromCfg : INTAKE) };
  } else if (p.id === 'enterprise') {
    plans.enterprise = { title: p.name || 'Enterprise', href: p.contact_redirect || INTAKE };
  }
}

// 替换器：优先按 id 定位（cta-portfolio / cta-business / cta-enterprise）；次之按常见文案与路径回写 href
function replaceInFile(file) {
  let s = fs.readFileSync(file, 'utf8');
  const withHref = (id, url) =>
    s = s.replace(new RegExp(`(<a[^>]+id=["']${id}["'][^>]*href=["'])[^"']+(["'])`, 'i'), `$1${url}$2`);

  if (plans.portfolio?.href) withHref('cta-portfolio', plans.portfolio.href);
  if (plans.business?.href)  withHref('cta-business',  plans.business.href);
  if (plans.enterprise?.href)withHref('cta-enterprise',plans.enterprise.href);

  // 针对历史页面兜底：把已存在的 Stripe/表单 href 统一为当前三挡
  // Portfolio：任意 stripe 链接若靠近“Portfolio”文案则替换为新链接
  s = s.replace(/(<a[^>]+>(?:[^<]*Portfolio[^<]*)<\/a>)/gi, m =>
    m.replace(/href=["'][^"']+["']/i, `href="${plans.portfolio?.href || INTAKE}"`));

  // Business
  s = s.replace(/(<a[^>]+>(?:[^<]*Business[^<]*)<\/a>)/gi, m =>
    m.replace(/href=["'][^"']+["']/i, `href="${plans.business?.href || INTAKE}"`));

  // Enterprise → 一律表单
  s = s.replace(/(<a[^>]+>(?:[^<]*Enterprise[^<]*)<\/a>)/gi, m =>
    m.replace(/href=["'][^"']+["']/i, `href="${plans.enterprise?.href || INTAKE}"`));

  fs.writeFileSync(file, s);
}

function walkAndPatch(rel) {
  const dir = path.resolve(process.cwd(), rel);
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) continue;
    if (e.endsWith('.html')) replaceInFile(p);
  }
}

for (const r of ROOTS) walkAndPatch(r);
console.log('CTA normalized: Portfolio/Business → Stripe, Enterprise → Intake (config-driven, no hard fail).');
