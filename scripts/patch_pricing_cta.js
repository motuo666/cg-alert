// Deprecated CTA patch script. Kept as a no-op so workflows calling it still succeed.
const fs = require('node:fs/promises');
const path = require('node:path');

(async () => {
  try {
    const PUB_DIR = path.join(process.cwd(), process.env.PUBLISH_DIR || 'public');
    const OUT = path.join(PUB_DIR, 'pricing', 'index.html');
    // Read once to ensure file exists, but do not modify it.
    try {
      await fs.readFile(OUT, 'utf8');
      console.log('patch_pricing_cta.js: no-op (CTA disabled, pricing page left unchanged)');
    } catch {
      console.log('patch_pricing_cta.js: pricing page not found, no-op');
    }
    process.exit(0);
  } catch (e) {
    console.error('patch_pricing_cta.js: unexpected error, but not modifying pricing page', e);
    process.exit(0);
  }
})();
