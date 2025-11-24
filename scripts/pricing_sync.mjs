// ESM script: scripts/pricing_sync.mjs
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import process from 'process';

const SITE_ROOT = process.cwd();
const INDEX_HTML = path.join(SITE_ROOT, 'index.html');

const STRIPE_LINK_PORTFOLIO = process.env.STRIPE_LINK_PORTFOLIO || '';
const STRIPE_LINK_BUSINESS  = process.env.STRIPE_LINK_BUSINESS  || '';

function updateHrefById(html, id, href) {
  const re = new RegExp(
    `(<a[^>]*id=["']${id}["'][^>]*href=["'])[^"']*(["'][^>]*>)`,
    'i'
  );
  if (re.test(html)) return html.replace(re, `$1${href}$2`);
  return null;
}

function updateHrefByPlanGuess(html, planKeyword, href) {
  const re = new RegExp(
    '(<a[^>]*href=["\'][^"\']*["\'][^>]*>[^<]{0,120}</a>)',
    'ig'
  );

  let m;
  let lastIndex = 0;
  let out = '';
  let changed = false;

  while ((m = re.exec(html)) !== null) {
    const start = Math.max(0, m.index - 300);
    const end = Math.min(html.length, re.lastIndex + 300);
    const context = html.slice(start, end);

    if (new RegExp(planKeyword, 'i').test(context)) {
      const anchor = m[1];
      const anchorRe = /(<a[^>]*href=["'])[^"']*(["'][^>]*>)/i;
      const newAnchor = anchorRe.test(anchor)
        ? anchor.replace(anchorRe, `$1${href}$2`)
        : anchor;

      out += html.slice(lastIndex, m.index) + newAnchor;
      lastIndex = re.lastIndex;
      changed = true;
    }
  }

  out += html.slice(lastIndex);
  return changed ? out : null;
}

async function main() {
  const orig = await readFile(INDEX_HTML, 'utf-8').catch(() => null);
  if (!orig) {
    console.warn(`WARN: ${INDEX_HTML} not found. Pricing sync skipped.`);
    return;
  }

  let html = orig;
  let changed = false;

  // 1) Pro（Portfolio）方案：同步 STRIPE_LINK_PORTFOLIO
  if (STRIPE_LINK_PORTFOLIO) {
    const next =
      updateHrefById(html, 'btn-portfolio', STRIPE_LINK_PORTFOLIO) ||
      updateHrefByPlanGuess(html, 'Pro', STRIPE_LINK_PORTFOLIO);

    if (next) {
      html = next;
      changed = true;
    } else {
      console.warn('WARN: Could not locate Pro/Portfolio CTA to update.');
    }
  } else {
    console.warn('WARN: STRIPE_LINK_PORTFOLIO is empty.');
  }

  // 2) Business 方案：同步 STRIPE_LINK_BUSINESS
  if (STRIPE_LINK_BUSINESS) {
    const next =
      updateHrefById(html, 'btn-business', STRIPE_LINK_BUSINESS) ||
      updateHrefByPlanGuess(html, 'Business', STRIPE_LINK_BUSINESS);

    if (next) {
      html = next;
      changed = true;
    } else {
      console.warn('WARN: Could not locate Business CTA to update.');
    }
  } else {
    console.warn('WARN: STRIPE_LINK_BUSINESS is empty.');
  }

  // Enterprise（18k）保留静态 HTML 指向 intake，不在脚本里动它。

  if (changed) {
    await writeFile(INDEX_HTML, html, 'utf-8');
    console.log('Pricing Sync: updated CTAs in index.html');
  } else {
    console.log('Pricing Sync: no changes applied (selectors not found).');
  }
}

main().catch(err => {
  console.error('Pricing Sync failed:', err);
  process.exit(1);
});
