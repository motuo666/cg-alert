
// Helper utilities for resource/event/snapshot IDs and slugs
export function normalizeVendor(v) {
  return String(v || '').trim().toLowerCase().replace(/\s+/g, '-');
}
export function normalizePath(p) {
  const s = String(p || '').strip ? ('' + p).trim() : String(p || '');
  return s.replace(/^\s+|\s+$/g, '').replace(/^\/+|\/+$/g, '');
}
export function slugTimestamp(iso) {
  // Expect ISO8601 UTC; fallback to now
  try {
    const d = new Date(iso || Date.now());
    // YYYY-MM-DD-HH-mm-ssZ (Z literal for UTC)
    const pad = n => String(n).padStart(2, '0');
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth()+1) + '-' + pad(d.getUTCDate())
      + '-' + pad(d.getUTCHours()) + '-' + pad(d.getUTCMinutes()) + '-' + pad(d.getUTCSeconds()) + 'z';
  } catch {
    return 'unknown';
  }
}
export function isoNowUTC() {
  const d = new Date();
  return d.toISOString();
}
export function buildResourceId(vendor, path) {
  return normalizeVendor(vendor) + '/' + normalizePath(path);
}
export function buildSnapshotId(vendor, path, hash) {
  const rid = buildResourceId(vendor, path);
  const h = String(hash || '').slice(0, 12);
  return rid + '#' + h;
}
export function buildEventId(vendor, path, observed_at_iso) {
  const rid = buildResourceId(vendor, path);
  const slug = slugTimestamp(observed_at_iso);
  return rid + '@' + slug;
}
