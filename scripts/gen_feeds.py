#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate RSS and optional reports list; update sitemap lastmod.
Idempotent; zero external deps; safe for CI.
"""
import os, csv, json, sys, re, datetime
from html import escape

def load_feeds_config():
    """Read public feed filtering rules from config/feeds.json (repo-relative)."""
    cfg_path = os.path.join(ROOT, "..", "config", "feeds.json")
    try:
        with open(cfg_path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        # Safe defaults: no vendors (=empty), 14 days
        return {"public_vendors": [], "public_min_age_days": 14}

def _parse_date(s):
    # Accept YYYY-MM-DD or ISO 8601 strings
    try:
        if len(s) == 10:
            return datetime.datetime.strptime(s, "%Y-%m-%d").date()
        # Fallback: attempt fromisoformat without timezone
        return datetime.date.fromisoformat(s[:10])
    except Exception:
        return None

def filter_public_items(items, cfg):
    """Keep only items where vendor in public_vendors and date <= today - min_age."""
    vendors = set((cfg or {}).get("public_vendors", []))
    min_age = int((cfg or {}).get("public_min_age_days", 14))
    today = datetime.date.today()
    out = []
    for it in items:
        v = (it.get("vendor") or "").lower().strip()
        d = _parse_date(it.get("date") or "")
        if not v or not d:
            continue
        age = (today - d).days
        if (not vendors or v in vendors) and age >= min_age:
            out.append(it)
    # Sort by date desc if available
    try:
        out.sort(key=lambda x: x.get("date") or "", reverse=True)
    except Exception:
        pass
    return out

ROOT = os.path.dirname(os.path.abspath(os.path.join(__file__, "..")))
def p(*xs): print(*xs, file=sys.stderr)

def load_items():
    data_dir = os.path.join(ROOT, "..", "data")
    json_path = os.path.join(data_dir, "events.json")
    csv_path = os.path.join(data_dir, "events.csv")
    items = []
    if os.path.exists(json_path):
        try:
            with open(json_path, "r", encoding="utf-8") as f:
                items = json.load(f)
        except Exception as e:
            p("JSON load fail:", e)
    if not items and os.path.exists(csv_path):
        with open(csv_path, newline="", encoding="utf-8") as f:
            r = csv.DictReader(f)
            for row in r:
                items.append({k: (row.get(k,"") or "").strip() for k in r.fieldnames})
    # normalize
    norm = []
    for it in items:
        if not it: 
            continue
        t = it.get("title") or it.get("name")
        u = it.get("url")
        d = it.get("date") or it.get("published") or it.get("time")
        v = (it.get("vendor") or "").strip()
        c = (it.get("category") or "").strip()
        s = (it.get("summary") or "").strip()
        if not (t and u and d):
            continue
        norm.append({
            "title": str(t).strip(),
            "url": str(u).strip(),
            "date": str(d).strip(),
            "vendor": v,
            "category": c,
            "summary": s
        })
    # sort by date desc (best effort)
    def keyd(x):
        try:
            return datetime.datetime.fromisoformat(x["date"])
        except Exception:
            return datetime.datetime.min
    norm.sort(key=keyd, reverse=True)
    return norm

def write(path, content):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    cur = None
    if os.path.exists(path):
        try: 
            with open(path,"r",encoding="utf-8") as f:
                cur = f.read()
        except: 
            cur = None
    if cur != content:
        with open(path,"w",encoding="utf-8") as f:
            f.write(content)
        p("Updated:", path)
    else:
        p("No change:", path)

def gen_rss(items):
    site = os.environ.get("SITE_ORIGIN","https://www.cg-alert.com").rstrip("/")
    now = datetime.datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S +0000")
    lines = []
    lines.append('<?xml version="1.0" encoding="UTF-8"?>')
    lines.append('<rss version="2.0">')
    lines.append("<channel>")
    lines.append("<title>CG Alert — vendor change feed</title>")
    lines.append(f"<link>{site}</link>")
    lines.append("<description>Evidence-backed vendor change alerts.</description>")
    lines.append(f"<lastBuildDate>{now}</lastBuildDate>")
    for it in items:
        title = escape(it["title"])
        url = escape(it["url"])
        desc = escape((it.get("summary") or "").strip() or f"Vendor: {it.get('vendor','')} · Category: {it.get('category','')}")
        pub = it["date"]
        lines.append("<item>")
        lines.append(f"<title>{title}</title>")
        lines.append(f"<link>{url}</link>")
        lines.append(f"<guid isPermaLink='true'>{url}</guid>")
        lines.append(f"<pubDate>{pub}</pubDate>")
        lines.append(f"<description>{desc}</description>")
        lines.append("</item>")
    lines.append("</channel></rss>")
    return "\n".join(lines)

def update_reports(items):
    # only replace content between markers if present
    rpt_path = os.path.join(ROOT, "..", "reports", "index.html")
    if not os.path.exists(rpt_path):
        return
    with open(rpt_path,"r",encoding="utf-8") as f:
        html = f.read()
    if "<!-- BEGIN:REPORTS -->" not in html or "<!-- END:REPORTS -->" not in html:
        return
    parts = ["<ul class=\"cg-reports\">"]
    for it in items[:50]:
        title = escape(it["title"])
        url = escape(it["url"])
        v = escape(it.get("vendor",""))
        c = escape(it.get("category",""))
        d = escape(it["date"])
        s = escape(it.get("summary",""))
        parts.append(f'<li><h3><a href="{url}" rel="noopener">{title}</a></h3><p><time datetime="{d}">{d}</time> · {v} · {c}</p><p class="muted">{s}</p></li>')
    parts.append("</ul>")
    block = "\n".join(parts)
    new = re.sub(r"(?s)<!-- BEGIN:REPORTS -->.*?<!-- END:REPORTS -->","<!-- BEGIN:REPORTS -->\n"+block+"\n<!-- END:REPORTS -->", html)
    if new != html:
        write(rpt_path, new)

def touch_sitemap():
    path = os.path.join(ROOT, "..", "sitemap.xml")
    if not os.path.exists(path): 
        return
    with open(path,"r",encoding="utf-8") as f:
        txt = f.read()
    site = os.environ.get("SITE_ORIGIN","https://www.cg-alert.com").rstrip("/")
    now = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    def upd(url, t):
        pattern = r'(<url>\s*<loc>'+re.escape(site+url)+r'</loc>\s*<lastmod>)([^<]*)(</lastmod>)'
        return re.sub(pattern, r'\1'+now+r'\3', t)
    new = upd("/reports/", txt)
    new = upd("/rss/index.xml", new)
    if new != txt:
        write(path, new)

def main():
    items = load_items()
    cfg = load_feeds_config()
    public_items = filter_public_items(items, cfg)
    rss_out = gen_rss(public_items)
    write(os.path.join(ROOT,"..","rss","index.xml"), rss_out)
    update_reports(public_items)
    touch_sitemap()
    p("Done. Items (public):", len(public_items))

if __name__ == "__main__":
    main()
