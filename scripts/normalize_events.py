
import os, csv, json, datetime, re, html
from pathlib import Path
from events_common import normalize_event, event_fingerprint

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
RSS_DIR = ROOT / "rss"
REPORTS = ROOT / "reports" / "index.html"
SITEMAP = ROOT / "sitemap.xml"

DATA.mkdir(exist_ok=True, parents=True)
RSS_DIR.mkdir(exist_ok=True, parents=True)

def load_csv(p):
    rows = []
    with open(p, newline='', encoding='utf-8') as f:
        r = csv.DictReader(f)
        for row in r:
            rows.append({k.strip(): (v or "").strip() for k,v in row.items()})
    return rows

def load_json(p):
    with open(p, encoding='utf-8') as f:
        obj = json.load(f)
        if isinstance(obj, dict): obj = [obj]
        return obj

def collect_events():
    items = []
    if (DATA/"events.csv").exists():
        items += load_csv(DATA/"events.csv")
    if (DATA/"events.json").exists():
        items += load_json(DATA/"events.json")
    norm = []
    seen = set()
    for it in items:
        e = normalize_event(it)
        fp = event_fingerprint(e)
        if fp in seen: 
            continue
        seen.add(fp)
        norm.append(e)
    # sort by date desc
    norm.sort(key=lambda x: x["date"], reverse=True)
    return norm

def write_rss(items):
    now = datetime.datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S +0000")
    xml = []
    xml.append('<?xml version="1.0" encoding="UTF-8"?>')
    xml.append('<rss version="2.0"><channel>')
    xml.append('<title>CG Alert — Vendor change feed</title>')
    xml.append('<link>https://www.cg-alert.com/reports/</link>')
    xml.append('<description>Evidence-backed vendor change alerts.</description>')
    xml.append(f'<lastBuildDate>{now}</lastBuildDate>')
    for e in items[:200]:
        xml.append("<item>")
        xml.append(f"<title>{html.escape(e['title'])}</title>")
        xml.append(f"<link>{html.escape(e['url'])}</link>")
        xml.append(f"<guid isPermaLink=\"false\">{html.escape(e['id'])}</guid>")
        xml.append(f"<pubDate>{e['date'].replace('T',' ').replace('Z',' +0000')}</pubDate>")
        desc = f"[{e['vendor']}] ({e['category']}) {html.escape(e['summary'])}"
        xml.append(f"<description>{desc}</description>")
        xml.append("</item>")
    xml.append("</channel></rss>")
    out = RSS_DIR / "index.xml"
    old = out.read_text(encoding='utf-8') if out.exists() else ""
    new = "\n".join(xml)
    if new != old:
        out.write_text(new, encoding='utf-8')
        return True
    return False

def write_reports(items):
    lst = []
    lst.append("<ul class='cg-report-list'>")
    for e in items[:300]:
        lst.append(
            f"<li><a href='{html.escape(e['url'])}' target='_blank' rel='noopener'>{html.escape(e['title'])}</a>"
            f" <span class='meta'>[{e['date'][:10]} · {html.escape(e['vendor'])} · {html.escape(e['category'])}]</span>"
            f"<br><span class='sum'>{html.escape(e['summary'])}</span></li>"
        )
    lst.append("</ul>")
    block = "\n".join(lst)

    if REPORTS.exists():
        html_in = REPORTS.read_text(encoding='utf-8')
    else:
        html_in = "<!-- BEGIN:REPORTS --><!-- END:REPORTS -->"
    new_html = re.sub(r"<!-- BEGIN:REPORTS -->(.|\n|\r)*?<!-- END:REPORTS -->",
                      f"<!-- BEGIN:REPORTS -->\n{block}\n<!-- END:REPORTS -->",
                      html_in, flags=re.MULTILINE)
    changed = new_html != html_in
    if changed:
        REPORTS.parent.mkdir(parents=True, exist_ok=True)
        REPORTS.write_text(new_html, encoding='utf-8')
    return changed

def write_sitemap(items):
    urls = [
        "/", "/who-uses/", "/intake/", "/reports/", "/rss/index.xml",
        "/terms/", "/privacy/"
    ]
    now = datetime.datetime.utcnow().strftime("%Y-%m-%d")
    xml = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        xml += [f"<url><loc>https://www.cg-alert.com{u}</loc><lastmod>{now}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>"]
    xml.append("</urlset>")
    new = "\n".join(xml)
    old = SITEMAP.read_text(encoding='utf-8') if SITEMAP.exists() else ""
    if new != old:
        SITEMAP.write_text(new, encoding='utf-8')
        return True
    return False

def main():
    items = collect_events()
    c1 = write_rss(items)
    c2 = write_reports(items)
    c3 = write_sitemap(items)
    changed = c1 or c2 or c3
    print("normalized items:", len(items), "changed:", changed)
    if changed:
        # also write a normalized snapshot
        (DATA/"events.normalized.json").write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding='utf-8')

if __name__ == "__main__":
    main()
