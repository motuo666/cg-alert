#!/usr/bin/env python3
# coding: utf-8

"""
CG Alert content generator
- 从 data/events.json 或 data/events.csv 聚合内容；否则保持现状（不报错）
- 产出 rss/index.xml（标准 RSS 2.0）
- 可选：增量更新 sitemap.xml 里 /reports/ 与 /rss/index.xml 的 <lastmod>
- 若检测到 reports/index.html 中存在 <!-- BEGIN:REPORTS --> ... <!-- END:REPORTS --> 标记，则替换中间 HTML 列表；否则不动页面风格。
不依赖第三方包。
"""

import os, sys, json, csv, datetime, html, re
from pathlib import Path
from email.utils import format_datetime
from xml.sax.saxutils import escape as xml_escape

SITE="https://www.cg-alert.com"
ROOT=Path(".")
DATA_DIR=ROOT/"data"
RSS_DIR=ROOT/"rss"
REPORTS_DIR=ROOT/"reports"
SITEMAP=ROOT/"sitemap.xml"

def rfc2822(dt: datetime.datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=datetime.timezone.utc)
    return format_datetime(dt)

def load_events():
    items=[]
    # 1) JSON
    j = DATA_DIR/"events.json"
    if j.exists():
        try:
            data=json.loads(j.read_text(encoding="utf-8"))
            if isinstance(data, list):
                for x in data:
                    items.append({
                        "title": str(x.get("title","")).strip() or "Untitled",
                        "url": str(x.get("url","")).strip(),
                        "date": str(x.get("date","")).strip(),
                        "vendor": str(x.get("vendor","")).strip(),
                        "category": str(x.get("category","")).strip(),
                        "summary": str(x.get("summary","")).strip(),
                    })
        except Exception as e:
            print("WARN: events.json parse failed:", e, file=sys.stderr)

    # 2) CSV
    c = DATA_DIR/"events.csv"
    if c.exists():
        try:
            with c.open("r",encoding="utf-8") as f:
                rdr=csv.DictReader(f)
                for x in rdr:
                    items.append({
                        "title": (x.get("title") or "Untitled").strip(),
                        "url": (x.get("url") or "").strip(),
                        "date": (x.get("date") or "").strip(),
                        "vendor": (x.get("vendor") or "").strip(),
                        "category": (x.get("category") or "").strip(),
                        "summary": (x.get("summary") or "").strip(),
                    })
        except Exception as e:
            print("WARN: events.csv parse failed:", e, file=sys.stderr)

    # 去重 + 合法性
    seen=set()
    norm=[]
    for it in items:
        key=(it.get("title"), it.get("date"), it.get("url"))
        if key in seen: 
            continue
        seen.add(key)
        # 解析日期
        dt_txt=it.get("date") or ""
        try:
            # 允许 2025-11-11 或 2025-11-11T08:00:00Z
            if "T" in dt_txt:
                dt = datetime.datetime.fromisoformat(dt_txt.replace("Z","+00:00"))
            else:
                y,m,d = map(int, dt_txt.split("-"))
                dt = datetime.datetime(y,m,d,tzinfo=datetime.timezone.utc)
        except Exception:
            dt = datetime.datetime.now(datetime.timezone.utc)
        it["_dt"]=dt
        norm.append(it)
    # 按时间倒序
    norm.sort(key=lambda x:x["_dt"], reverse=True)
    return norm

def ensure_dirs():
    RSS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

def build_rss(items):
    now = datetime.datetime.now(datetime.timezone.utc)
    last_build = rfc2822(items[0]["_dt"] if items else now)
    title = "CG Alert — Evidence-backed vendor change alerts"
    link  = f"{SITE}/rss/index.xml"
    desc  = "Automated, human-readable change alerts for SaaS vendor pricing / terms / security / subprocessors / status."
    parts=[]
    parts.append('<?xml version="1.0" encoding="UTF-8"?>')
    parts.append('<rss version="2.0">')
    parts.append("<channel>")
    parts.append(f"<title>{xml_escape(title)}</title>")
    parts.append(f"<link>{xml_escape(SITE)}</link>")
    parts.append(f"<description>{xml_escape(desc)}</description>")
    parts.append(f"<lastBuildDate>{xml_escape(last_build)}</lastBuildDate>")
    parts.append("<generator>cg-alert/content-gen</generator>")

    for it in items[:200]:
        t = it.get("title") or "Update"
        url = it.get("url") or SITE+"/reports/"
        d = rfc2822(it["_dt"])
        summary = it.get("summary") or f"{it.get('vendor','')} {it.get('category','update')}"
        parts.append("<item>")
        parts.append(f"<title>{xml_escape(t)}</title>")
        parts.append(f"<link>{xml_escape(url)}</link>")
        parts.append(f"<guid isPermaLink=\"false\">{xml_escape(url)}#{int(it['_dt'].timestamp())}</guid>")
        parts.append(f"<pubDate>{xml_escape(d)}</pubDate>")
        parts.append(f"<description>{xml_escape(summary)}</description>")
        parts.append("</item>")

    parts.append("</channel></rss>")
    out = "\n".join(parts) + "\n"
    (RSS_DIR/"index.xml").write_text(out, encoding="utf-8")
    print("Wrote rss/index.xml")

def update_reports_html(items):
    # 仅当存在显式标记时替换，避免破坏现有风格
    p = REPORTS_DIR/"index.html"
    if not p.exists():
        return
    html = p.read_text(encoding="utf-8")
    m = re.search(r"<!--\s*BEGIN:REPORTS\s*-->(?P<body>.*)<!--\s*END:REPORTS\s*-->", html, flags=re.S)
    if not m:
        # 不动
        return
    # 生成无样式 UL（继承你的现有 CSS）
    lines=["<!-- BEGIN:REPORTS -->", "<ul class=\"cg-reports\">"]
    for it in items[:200]:
        dt_txt = it["_dt"].date().isoformat()
        title = html_escape(it.get("title") or "Update")
        url = html_escape(it.get("url") or (SITE+"/reports/"))
        summary = html_escape(it.get("summary") or "")
        lines.append(f'<li><article><h3><a href="{url}">{title}</a></h3><p>{summary}</p><time datetime="{dt_txt}">{dt_txt}</time></article></li>')
    lines.append("</ul>")
    lines.append("<!-- END:REPORTS -->")
    new_block="\n".join(lines)
    new_html = html[:m.start()] + new_block + html[m.end():]
    if new_html != html:
        p.write_text(new_html, encoding="utf-8")
        print("Updated reports/index.html (between markers).")

def html_escape(s:str)->str:
    s = s or ""
    return (s.replace("&","&amp;")
             .replace("<","&lt;")
             .replace(">","&gt;")
             .replace('"',"&quot;"))

def update_sitemap_lastmod():
    if not SITEMAP.exists():
        return
    try:
        txt=SITEMAP.read_text(encoding="utf-8")
        now_iso=datetime.datetime.utcnow().replace(microsecond=0).isoformat()+"Z"
        def repl(loc_path, text):
            # 替换对应 <url> 的 <lastmod>，若无则插入
            pat = re.compile(rf"(<url>\s*<loc>\s*{re.escape(SITE+loc_path)}\s*</loc>)(?P<rest>.*?)</url>", re.S)
            def _fn(m):
                rest=m.group("rest")
                if "<lastmod>" in rest:
                    rest=re.sub(r"<lastmod>.*?</lastmod>", f"<lastmod>{now_iso}</lastmod>", rest)
                else:
                    rest = f"{rest}\n  <lastmod>{now_iso}</lastmod>\n"
                return m.group(1)+rest+"</url>"
            return pat.sub(_fn, text)

        for path in ("/reports/", "/rss/index.xml"):
            txt=repl(path, txt)
        if txt:
            SITEMAP.write_text(txt, encoding="utf-8")
            print("Updated sitemap.xml lastmod for /reports/ and /rss/index.xml")
    except Exception as e:
        print("WARN: sitemap.xml update skipped:", e, file=sys.stderr)

def maybe_seed_example():
    # 若没有任何数据输入，写入一个最小示例 CSV（不覆盖已有）
    j = DATA_DIR/"events.json"
    c = DATA_DIR/"events.csv"
    if not j.exists() and not c.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        today=datetime.date.today().isoformat()
        with c.open("w",encoding="utf-8",newline="") as f:
            w=csv.writer(f)
            w.writerow(["title","url","date","vendor","category","summary"])
            w.writerow([
                "Okta updated subprocessors",
                SITE+"/reports/#okta-subprocessors-"+today,
                today,"Okta","subprocessors","Subprocessor list change detected."
            ])
        print("Seeded data/events.csv")

def main():
    ensure_dirs()
    maybe_seed_example()
    items=load_events()
    # 允许空 — 也要可订阅
    build_rss(items)
    update_reports_html(items)
    update_sitemap_lastmod()
    print("Done. items:", len(items))

if __name__=="__main__":
    main()
