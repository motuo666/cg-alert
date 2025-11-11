        #!/usr/bin/env python3
        import os, re, sys, time, html, hashlib, datetime as dt
        from pathlib import Path
        try:
            import yaml
        except Exception:
            yaml=None
        ROOT=Path(__file__).resolve().parents[1]
        BASE=os.getenv("SITE_BASE_URL","https://www.cg-alert.com").rstrip("/")
        REPORTS=ROOT/"reports"
        RSS=ROOT/"rss"
        TPLH=ROOT/"templates"/"reports_index_head.html"
        TPLF=ROOT/"templates"/"reports_index_foot.html"
        RSS.mkdir(parents=True, exist_ok=True)
        # Collect entries
        items=[]
        for p in sorted(REPORTS.rglob("*"), key=lambda x:x.stat().st_mtime, reverse=True):
            if not p.is_file(): continue
            if p.suffix.lower() not in (".md",".html",".htm"): continue
            txt=p.read_text("utf-8", errors="ignore")
            meta={"title":None,"date":None,"summary":None}
            if txt.startswith("---"):
                try:
                    end=txt.find("
---",3)
                    if end!=-1 and yaml:
                        meta.update(yaml.safe_load(txt[3:end]) or {})
                        txt=txt[end+4:]
                except Exception: pass
            title=meta["title"] or p.stem.replace("-"," ").title()
            # crude text extract
            body=re.sub(r"<script[\s\S]*?</script>|<style[\s\S]*?</style>", "", txt, flags=re.I)
            body=re.sub(r"<[^>]+>"," ", body)
            body=re.sub(r"\s+"," ", body).strip()
            summary=(meta["summary"] or body[:300]).strip()
            mtime=dt.datetime.utcfromtimestamp(p.stat().st_mtime).strftime("%Y-%m-%dT%H:%M:%SZ")
            date=meta["date"] or mtime
            url=f"{BASE}/reports/{p.name.replace(' ', '%20')}"
            items.append({"title":title,"date":date,"summary":summary,"url":url})
        # RSS
        def x(s): return html.escape(s or "")
        rss_items=items[:50]
        rss=["<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
             "<rss version=\"2.0\"><channel>",
             f"<title>CG Alert — Reports</title>",
             f"<link>{BASE}/reports/</link>",
             f"<description>Evidence-backed vendor change alerts</description>"]
        for it in rss_items:
            rss += [ "<item>",
                     f"<title>{x(it['title'])}</title>",
                     f"<link>{x(it['url'])}</link>",
                     f"<pubDate>{x(it['date'])}</pubDate>",
                     f"<description>{x(it['summary'])}</description>",
                     "</item>" ]
        rss.append("</channel></rss>")
        (ROOT/"rss"/"index.xml").write_text("\n".join(rss), "utf-8")
        # reports index
        head=TPLH.read_text("utf-8") if TPLH.exists() else "<!doctype html><html><head><meta charset=\"utf-8\"><title>Reports — CG Alert</title></head><body><section>"
        foot=TPLF.read_text("utf-8") if TPLF.exists() else "</section></body></html>"
        lis=["<ul class=\"cg-list\">"]
        for it in items[:200]:
            lis.append(f"<li><a href='{x(it['url'])}'>{x(it['title'])}</a> <time>{x(it['date'][:10])}</time><p>{x(it['summary'])}</p></li>")
        lis.append("</ul>")
        (ROOT/"reports"/"index.html").write_text(head+"\n".join(lis)+foot, "utf-8")
        # sitemap
        urlset=[
            f"<url><loc>{BASE}/</loc></url>",
            f"<url><loc>{BASE}/who-uses/</loc></url>",
            f"<url><loc>{BASE}/intake/</loc></url>",
            f"<url><loc>{BASE}/reports/</loc></url>",
            f"<url><loc>{BASE}/rss/index.xml</loc></url>"
        ]
        for it in items[:1000]:
            urlset.append(f"<url><loc>{it['url']}</loc></url>")
        sm = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">" + "".join(urlset) + "</urlset>"
        (ROOT/"sitemap.xml").write_text(sm, "utf-8")
        print(f"Generated: {len(rss_items)} rss items, {len(items[:200])} report links, sitemap urls={len(urlset)}")
