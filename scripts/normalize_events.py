import os, sys, csv, json, re, datetime
from pathlib import Path
from xml.sax.saxutils import escape
from events_common import parse_iso, to_iso_utc, norm_vendor, norm_category, fingerprint, clamp

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT/"data"
DATA.mkdir(exist_ok=True, parents=True)

CSV_PATH = DATA/"events.csv"
JSON_PATH = DATA/"events.json"
SNAP_PATH = DATA/"events.normalized.json"
REPORTS_HTML = ROOT/"reports"/"index.html"
RSS_XML = ROOT/"rss"/"index.xml"
SITEMAP = ROOT/"sitemap.xml"

BASE_URL = os.getenv("BASE_URL", "https://www.cg-alert.com")

def read_csv_rows():
    rows = []
    if CSV_PATH.exists():
        with CSV_PATH.open("r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                rows.append({k.strip(): (v or "").strip() for k,v in r.items()})
    return rows

def read_json_rows():
    try:
        if JSON_PATH.exists():
            arr = json.loads(JSON_PATH.read_text(encoding="utf-8"))
            if isinstance(arr, dict) and "events" in arr:
                arr = arr["events"]
            if isinstance(arr, list):
                return arr
    except Exception as e:
        print("JSON read error:", e, file=sys.stderr)
    return []

def normalize(items):
    out = []
    for it in items:
        t = {k: (it.get(k) or "").strip() for k in ["title","url","date","vendor","category","summary","source","tags"]}
        t["vendor"] = norm_vendor(t["vendor"], t["url"])
        try:
            dt = parse_iso(t["date"])
        except Exception:
            dt = datetime.datetime.utcnow().replace(tzinfo=datetime.timezone.utc)
        t["date"] = to_iso_utc(dt)
        t["category"] = norm_category(t["category"], t["url"])
        t["title"] = clamp(t["title"], 120)
        t["summary"] = clamp(t["summary"], 240)
        t["_fp"] = fingerprint(t)
        out.append(t)
    # dedupe
    tmp = {}
    for t in out:
        prev = tmp.get(t["_fp"])
        if (not prev) or (t["date"] > prev["date"]):
            tmp[t["_fp"]] = t
    out = list(tmp.values())
    out.sort(key=lambda x: x["date"], reverse=True)
    return out

def render_rss(items):
    header = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n  <title>CG Alert - Vendor change feed</title>\n  <link>'+BASE_URL+'/rss/</link>\n  <description>Evidence-backed vendor change alerts</description>\n'
    body = []
    for t in items[:100]:
        title = escape(t["title"] or (t["vendor"]+" "+t["category"]+" update"))
        link = escape(t["url"] or (BASE_URL+'/reports/'))
        desc = escape((t["summary"] or "").strip() or (t["vendor"]+" "+t["category"]+" change"))
        pub = t["date"]
        body.append('  <item>\n    <title>'+title+'</title>\n    <link>'+link+'</link>\n    <guid isPermaLink="false">'+t["_fp"]+'</guid>\n    <pubDate>'+pub+'</pubDate>\n    <description>'+desc+'</description>\n  </item>\n')
    footer = "</channel>\n</rss>\n"
    return header + "".join(body) + footer

def render_reports_insert(items):
    lines = []
    for t in items[:200]:
        lines.append('<article class="cg-row">\n  <div class="cg-col"><a href="'+(t["url"] or "#")+'" rel="nofollow">'+((t["title"] or (t["vendor"]+" "+t["category"])).strip())+'</a></div>\n  <div class="cg-col">'+t["vendor"]+'</div>\n  <div class="cg-col">'+t["category"]+'</div>\n  <div class="cg-col">'+t["date"][:10]+'</div>\n</article>')
    return "\n".join(lines)

def patch_reports_html(html, insert_html):
    begin = "<!-- BEGIN:REPORTS -->"
    end = "<!-- END:REPORTS -->"
    if begin in html and end in html:
        pre = html.split(begin)[0]
        post = html.split(end)[1]
        return pre + begin + "\n" + insert_html + "\n" + end + post
    return html

def render_sitemap(items):
    seen = set()
    urls = [BASE_URL+"/", BASE_URL+"/who-uses/", BASE_URL+"/intake/", BASE_URL+"/reports/", BASE_URL+"/rss/"]
    for t in items[:200]:
        if t.get("url"):
            urls.append(t["url"])
    out = ['<?xml version="1.0" encoding="UTF-8"?>','<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
    for u in urls:
        if u in seen: continue
        seen.add(u)
        out.append("  <url><loc>"+u+"</loc></url>")
    out.append("</urlset>\n")
    return "\n".join(out)

def main():
    csv_rows = read_csv_rows()
    json_rows = read_json_rows()
    all_rows = csv_rows + json_rows
    if not all_rows:
        print("No events yet; keeping files intact.")
        return

    items = normalize(all_rows)
    SNAP_PATH.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")

    rss = render_rss(items)
    RSS_XML.parent.mkdir(parents=True, exist_ok=True)
    RSS_XML.write_text(rss, encoding="utf-8")

    if REPORTS_HTML.exists():
        html = REPORTS_HTML.read_text(encoding="utf-8")
    else:
        html = "<!doctype html><html><head><meta charset='utf-8'><title>Reports</title></head><body><!-- BEGIN:REPORTS --><!-- END:REPORTS --></body></html>"
    ins = render_reports_insert(items)
    html2 = patch_reports_html(html, ins)
    REPORTS_HTML.parent.mkdir(parents=True, exist_ok=True)
    REPORTS_HTML.write_text(html2, encoding="utf-8")

    sitemap = render_sitemap(items)
    SITEMAP.write_text(sitemap, encoding="utf-8")

if __name__ == "__main__":
    main()
