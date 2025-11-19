
// Generate data/events.json from the best available sources:
// Preferred: reports/index.json (rich, internal)
// Fallback:  reports/rss/index.xml (coarser)
// Output schema uses event_id/resource_id/snapshot_id.
import fs from 'node:fs';
import path from 'node:path';
import { buildResourceId, buildSnapshotId, buildEventId, isoNowUTC } from './lib/event_ids.mjs';

const ROOT = process.cwd();
const REPORTS = path.join(ROOT, 'reports');
const DATA = path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });

function safeReadJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch { return null; }
}

function parseRSS(rssPath) {
  // naive parser: read <item> blocks with <title> <link> <pubDate> <guid> <description>
  if (!fs.existsSync(rssPath)) return [];
  const xml = fs.readFileSync(rssPath, 'utf8');
  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const get = tag => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
      return r ? r[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };
    const title = get('title');
    const link = get('link');
    const pubDate = get('pubDate') || get('dc:date') || '';
    const guid = get('guid') || link;
    // Heuristic for vendor/path from title or link
    let vendor = '';
    let pathPart = '';
    const linkPath = (link || '').replace(/^https?:\/\/[^/]+/i, '');
    if (linkPath.includes('/reports/')) {
      const parts = linkPath.split('/reports/')[1].split('/');
      vendor = parts[0] || '';
      pathPart = parts[1] || '';
    }
    const observed_at = pubDate ? new Date(pubDate).toISOString() : isoNowUTC();
    const resource_id = buildResourceId(vendor, pathPart);
    const snapshot_id = buildSnapshotId(vendor, pathPart, guid || title);
    const event_id = buildEventId(vendor, pathPart, observed_at);
    items.push({
      event_id, resource_id, snapshot_id,
      observed_at, vendor, path: '/' + pathPart,
      title, url: link, summary: get('description') || ''
    });
  }
  return items;
}

function fromIndexJSON(idxPath) {
  const data = safeReadJSON(idxPath);
  if (!data) return [];
  const arr = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
  return arr.map(it => {
    const vendor = it.vendor || it.vendor_name || '';
    const pathPart = (it.path || it.slug || '').replace(/^\/+|\/+$/g, '');
    const observed_at = (it.observed_at || it.date || it.updated_at || it.timestamp || new Date().toISOString());
    const resource_id = buildResourceId(vendor, pathPart);
    const snapshot_id = buildSnapshotId(vendor, pathPart, it.hash || it.guid || it.id || it.title);
    const event_id = buildEventId(vendor, pathPart, observed_at);
    return {
      event_id, resource_id, snapshot_id,
      observed_at, vendor, path: '/' + pathPart,
      title: it.title || (vendor + ' ' + pathPart),
      url: it.url || it.permalink || '',
      summary: it.summary || it.snippet || ''
    };
  });
}

function dedupeByEventId(list) {
  const seen = new Set();
  const out = [];
  for (const it of list.sort((a,b)=>String(a.observed_at).localeCompare(String(b.observed_at)))) {
    if (seen.has(it.event_id)) continue;
    seen.add(it.event_id);
    out.push(it);
  }
  return out;
}

function main() {
  const idx1 = path.join(REPORTS, 'index.json');
  const rss1 = path.join(REPORTS, 'rss', 'index.xml');
  let events = [];
  if (fs.existsSync(idx1)) {
    events = fromIndexJSON(idx1);
  } else if (fs.existsSync(rss1)) {
    events = parseRSS(rss1);
  } else {
    console.log('[events] no source found; writing empty list');
  }
  events = dedupeByEventId(events);
  const out = path.join(DATA, 'events.json');
  fs.writeFileSync(out, JSON.stringify({ items: events }, null, 2));
  console.log('[events] wrote', out, 'with', events.length, 'items');
}

main();
