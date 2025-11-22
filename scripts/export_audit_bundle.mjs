import fs from 'fs/promises';
import path from 'path';

/**
 * Build a manifest of evidence entries for a given vendor and date range.
 *
 * This does NOT talk to R2 or external services. It only:
 *  - walks the evidence/ directory
 *  - filters JSON files by vendor and confirmed_at/first_seen_at
 *  - writes a manifest file under data/audit_exports/{id}.json
 *
 * Usage (CI or local):
 *   AUDIT_VENDOR=okta.com AUDIT_FROM=2023-01-01 AUDIT_TO=2023-12-31 AUDIT_ID=okta-2023 \
 *     node scripts/export_audit_bundle.mjs
 */

const EVIDENCE_ROOT = process.env.EVIDENCE_ROOT || 'evidence';
const OUT_DIR = path.join('data', 'audit_exports');

function parseArgsFromEnv() {
  const vendor = (process.env.AUDIT_VENDOR || '').trim();
  const from = (process.env.AUDIT_FROM || '').trim();
  const to = (process.env.AUDIT_TO || '').trim();
  let id = (process.env.AUDIT_ID || '').trim();

  if (!vendor) {
    throw new Error('AUDIT_VENDOR is required');
  }
  if (!from || !to) {
    throw new Error('AUDIT_FROM and AUDIT_TO are required (YYYY-MM-DD)');
  }
  if (!id) {
    id = `${vendor.replace(/[^a-zA-Z0-9.-]/g, '_')}-${from}-${to}`;
  }
  return { vendor, from, to, id };
}

function inRange(isoString, from, to) {
  if (!isoString) return false;
  const d = isoString.slice(0, 10); // YYYY-MM-DD
  return d >= from && d <= to;
}

async function walkVendorEvidence(vendor) {
  const base = path.join(EVIDENCE_ROOT, vendor);
  const items = [];
  async function walkDir(d, pageKey) {
    let ents;
    try {
      ents = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) {
        const nextKey = pageKey || ent.name;
        await walkDir(full, nextKey);
      } else if (ent.isFile() && ent.name.endsWith('.json')) {
        items.push({ full, pageKey });
      }
    }
  }
  await walkDir(base, '');
  return items;
}

async function main() {
  const { vendor, from, to, id } = parseArgsFromEnv();
  const all = await walkVendorEvidence(vendor);
  const manifestItems = [];

  for (const item of all) {
    let raw;
    try {
      raw = await fs.readFile(item.full, 'utf-8');
    } catch {
      continue;
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const confirmed = data.confirmed_at || data.first_seen_at || null;
    if (!inRange(confirmed, from, to)) continue;

    manifestItems.push({
      vendor: data.vendor || vendor,
      page: data.page || item.pageKey || null,
      url: data.url || null,
      confirmed_at: confirmed,
      json_path: path.relative('.', item.full),
      snapshot_key: data.r2_key || null,
    });
  }

  await fs.mkdir(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, `${id}.json`);
  const payload = {
    vendor,
    from,
    to,
    id,
    generated_at: new Date().toISOString(),
    count: manifestItems.length,
    items: manifestItems,
  };
  await fs.writeFile(outPath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`Wrote audit manifest: ${outPath} (${manifestItems.length} items)`);
}

main().catch((e) => {
  console.error('export_audit_bundle.mjs failed:', e);
  process.exit(1);
});
