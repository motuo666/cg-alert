#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import os, re, sys, json, pathlib, datetime, time
from typing import List, Dict, Optional
try:
    import yaml
except Exception:
    yaml = None

ROOT = pathlib.Path(__file__).resolve().parents[1]
REPORTS = ROOT / "reports"
RSS_DIR = ROOT / "rss"
SITEMAP = ROOT / "sitemap.xml"
INDEX_HTML = REPORTS / "index.html"

BASE = os.getenv("SITE_BASE_URL", "https://www.cg-alert.com").rstrip("/")

# Templates for reports index (simple server-side build to keep runtime JS minimal)
T_HEAD = (ROOT / "templates" / "reports_index_head.html").read_text(encoding="utf-8")
T_FOOT = (ROOT / "templates" / "reports_index_foot.html").read_text(encoding="utf-8")

def slugify(path: pathlib.Path) -> str:
    rel = path.relative_to(ROOT).as_posix()
    if rel.endswith("index.html"):
        return "/" + rel[:-10]  # drop 'index.html'
    return "/" + rel

def parse_front_matter(text: str) -> (Dict, str):
    if text.startswith("---"):
        m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.S)
        if m:
            front = m.group(1)
            body = m.group(2)
            meta = {}
            if yaml:
                try:
                    meta = yaml.safe_load(front) or {}
                except Exception:
                    meta = {}
            return meta, body
    return {}, text

def extract_summary(text: str, maxlen: int = 180) -> str:
    # remove HTML tags and markdown headers
    t = re.sub(r"<[^>]+>", " ", text)
    t = re.sub(r"^\s*#.*$", " ", t, flags=re.M)
    t = re.sub(r"`{1,3}.*?`{1,3}", " ", t, flags=re.S)
    t = re.sub(r"\s+", " ", t).strip()
    return (t[:maxlen] + "…") if len(t) > maxlen else t

def list_reports() -> List[Dict]:
    items: List[Dict] = []
    if not REPORTS.exists():
        return items
    for p in sorted(REPORTS.rglob("*"), key=lambda x: x.stat().st_mtime, reverse=True):
        if p.is_dir():
            continue
        if p.suffix.lower() not in (".html", ".md"):
            continue
        try:
            raw = p.read_text(encoding="utf-8")
        except Exception:
            continue
        meta, body = parse_front_matter(raw)
        title = meta.get("title") or p.stem.replace("-", " ").title()
        date_str = meta.get("date")
        if date_str:
            try:
                dt = datetime.datetime.fromisoformat(date_str.replace("Z","+00:00")).astimezone(datetime.timezone.utc)
            except Exception:
                dt = datetime.datetime.utcfromtimestamp(p.stat().st_mtime).replace(tzinfo=datetime.timezone.utc)
        else:
            dt = datetime.datetime.utcfromtimestamp(p.stat().st_mtime).replace(tzinfo=datetime.timezone.utc)
        summary = meta.get("summary") or extract_summary(body)
        url = BASE + slugify(p)
        items.append({
            "title": title,
            "date": dt,
            "summary": summary,
            "url": url,
            "path": p,
        })
    # keep latest 50 in feeds
    return items

def ensure_dirs():
    RSS_DIR.mkdir(parents=True, exist_ok=True)

def iso(dt: datetime.datetime) -> str:
    return dt.astimezone(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def build_rss(items: List[Dict]):
    now = datetime.datetime.now(datetime.timezone.utc)
    channel = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>CG Alert — Vendor Change Reports</title>
    <link>{BASE}/reports/</link>
    <description>Evidence-backed vendor change alerts.</description>
    <lastBuildDate>{iso(now)}</lastBuildDate>
    <ttl>30</ttl>
"""
    body = []
    for it in items[:50]:
        body.append(f"""    <item>
      <title>{it['title']}</title>
      <link>{it['url']}</link>
      <pubDate>{iso(it['date'])}</pubDate>
      <guid>{it['url']}</guid>
      <description>{escape_xml(it['summary'])}</description>
    </item>""")
    tail = """  </channel>
</rss>
"""
    content = channel + "\n".join(body) + tail
    (RSS_DIR / "index.xml").write_text(content, encoding="utf-8")

def escape_xml(s: str) -> str:
    return (s.replace("&","&amp;")
             .replace("<","&lt;")
             .replace(">","&gt;")
             .replace('"',"&quot;")
             .replace("'","&apos;"))

def build_sitemap(items: List[Dict]):
    now = datetime.datetime.now(datetime.timezone.utc).date().isoformat()
    # Base pages
    urls = [
        (f"{BASE}/", now, "1.0"),
        (f"{BASE}/who-uses/", now, "0.8"),
        (f"{BASE}/intake/", now, "0.6"),
        (f"{BASE}/reports/", now, "0.7"),
        (f"{BASE}/rss/index.xml", now, "0.3"),
    ]
    # Report pages
    for it in items:
        urls.append((it["url"], it["date"].date().isoformat(), "0.5"))
    head = """<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
"""
    body = []
    for loc, d, pr in urls:
        body.append(f"  <url><loc>{loc}</loc><lastmod>{d}</lastmod><priority>{pr}</priority></url>")
    tail = """</urlset>
"""
    SITEMAP.write_text(head + "\n".join(body) + tail, encoding="utf-8")

def build_reports_index(items: List[Dict]):
    lis = []
    for it in items[:200]:
        lis.append(f"""<li class="cg-report-item">
  <a href="{it['url']}"><h3>{it['title']}</h3></a>
  <time datetime="{iso(it['date'])}">{it['date'].date().isoformat()}</time>
  <p>{escape_xml(it['summary'])}</p>
</li>""" )
    content = T_HEAD + "\n".join(lis) + T_FOOT
    INDEX_HTML.write_text(content, encoding="utf-8")

def main():
    ensure_dirs()
    items = list_reports()
    build_rss(items)
    build_sitemap(items)
    build_reports_index(items)
    print(f"Generated: {RSS_DIR/'index.xml'}, {SITEMAP}, {INDEX_HTML}")

if __name__ == "__main__":
    main()
