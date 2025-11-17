// ESM script: scripts/pricing_sync.mjs
import { readFile, writeFile } from 'fs/promises';
import path from 'path';
import process from 'process';

const SITE_ROOT = process.cwd();
const INDEX_HTML = path.join(SITE_ROOT, 'index.html');

const STRIPE_LINK_PORTFOLIO = process.env.STRIPE_LINK_PORTFOLIO || '';
const STRIPE_LINK_BUSINESS  = process.env.STRIPE_LINK_BUSINESS  || '';

/**
 * Update the href on an <a> tag by element id.
 */
function updateHrefById(html, id, href) {
  const re = new RegExp('(<a[^>]*id=["\']' + id + '["\'][^>]*href=["\'])[^"\']*(["\'][^>]*>)', 'i');
  if (re.test(html)) return html.replace(re, '$1' + href + '$2');
  return null;
}

/**
 * Update the first <a> inside a pricing card whose <h3> matches planName.
 * This is tailored to the cg-pricing cards on index.html.
 */
function updatePlanCardHref(html, planName, href) {
  const re = new RegExp(
    '(<div[^>]*class=\"[^\"]*pcard[^\"]*\"[^>]*>[^<]*<h3>\\s*' + planName +
    '\\s*<\\/h3>[\\s\\S]*?<a[^>]*href=["\'])[^"\']*(["\'][^>]*>[\\s\\S]*?<\\/a>)',
    'i'
  );
  if (!re.test(html)) return null;
  return html.replace(re, '$1' + href + '$2');
}

async function main() {
  let html;
  try {
    html = await readFile(INDEX_HTML, 'utf-8');
  } catch (err) {
    console.error('Pricing Sync: could not read index.html:', err);
    process.exit(1);
  }

  let changed = false;

  // Pro (portfolio) tier
  if (STRIPE_LINK_PORTFOLIO) {
    let next =
      updateHrefById(html, 'btn-portfolio', STRIPE_LINK_PORTFOLIO) ||
      updatePlanCardHref(html, 'Pro', STRIPE_LINK_PORTFOLIO);

    if (next) {
      html = next;
      changed = true;
    } else {
      console.warn('WARN: Could not locate Pro/Portfolio CTA to update.');
    }
  } else {
    console.warn('WARN: STRIPE_LINK_PORTFOLIO is empty.');
  }

  // Business tier
  if (STRIPE_LINK_BUSINESS) {
    let next =
      updateHrefById(html, 'btn-business', STRIPE_LINK_BUSINESS) ||
      updatePlanCardHref(html, 'Business', STRIPE_LINK_BUSINESS);

    if (next) {
      html = next;
      changed = true;
    } else {
      console.warn('WARN: Could not locate Business CTA to update.');
    }
  } else {
    console.warn('WARN: STRIPE_LINK_BUSINESS is empty.');
  }

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
