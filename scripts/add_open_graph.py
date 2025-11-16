#!/usr/bin/env python3
import sys, pathlib, re, argparse
from bs4 import BeautifulSoup

def ensure_og(path: pathlib.Path, site_origin: str):
    html = path.read_text(encoding="utf-8", errors="ignore")
    soup = BeautifulSoup(html, "html.parser")
    head = soup.head or soup.new_tag("head")
    if not soup.head:
        soup.html.insert(0, head)

    title = (soup.title.string.strip() if soup.title and soup.title.string else path.stem.title())
    desc = ""
    for m in soup.find_all("meta"):
        if m.get("name","").lower()=="description":
            desc = m.get("content","").strip()
            break

    # canonical
    canonical = None
    for l in soup.find_all("link"):
        rel = l.get("rel") or []
        if any(r.lower()=="canonical" for r in rel):
            canonical = l.get("href"); break
    if not canonical:
        # best-effort canonical
        rel = path.as_posix().split("/",1)[-1]
        canonical = site_origin.rstrip("/")+"/"+rel.strip("./")

    def upsert_meta(prop, content, attr="property"):
        if not content: return
        el = soup.find("meta", attrs={attr: prop})
        if el: el["content"]=content
        else:
            tag = soup.new_tag("meta")
            tag[attr]=prop
            tag["content"]=content
            head.append(tag)

    # Open Graph
    upsert_meta("og:title", title)
    upsert_meta("og:description", desc or title)
    upsert_meta("og:type", "website")
    upsert_meta("og:url", canonical)
    # Twitter
    upsert_meta("twitter:card", "summary_large_image", attr="name")
    upsert_meta("twitter:title", title, attr="name")
    upsert_meta("twitter:description", desc or title, attr="name")

    path.write_text(str(soup), encoding="utf-8")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--site-origin", default="https://example.com")
    args = ap.parse_args()
    root = pathlib.Path(args.root)
    for p in root.rglob("*.html"):
        if any(seg in {".git","node_modules",".github",".well-known"} for seg in p.parts):
            continue
        ensure_og(p, args.site_origin)

if __name__=="__main__":
    main()
