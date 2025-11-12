#!/usr/bin/env python3
import argparse, pathlib, re, urllib.parse

CANON_RE = re.compile(r'(<link\s+rel=[\"\']canonical[\"\']\s+href=)[\"\']([^\"\']+)[\"\']', re.I)

def read(p):
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""

def write(p, t):
    p.write_text(t, encoding="utf-8")

def path_from_href(href):
    # accept absolute or relative, return a normalized path with trailing slash, no .html
    if href.startswith(("http://","https://")):
        parsed = urllib.parse.urlparse(href)
        path = parsed.path
    else:
        path = href
    # strip .html
    if path.endswith("index.html"):
        path = path[:-10]
    if path.endswith(".html"):
        path = path[:-5]
    if not path.endswith("/"):
        path += "/"
    return path

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    ap.add_argument("--site-origin", required=True)
    args = ap.parse_args()

    root = pathlib.Path(args.root)
    origin = args.site_origin.rstrip("/")

    for html in root.rglob("*.html"):
        if any(seg in {".git","node_modules"} for seg in html.parts):
            continue
        txt = read(html)
        if not txt:
            continue
        def repl(m):
            before, href = m.group(1), m.group(2)
            norm = origin + path_from_href(href)
            return before + '"' + norm + '"'
        new = CANON_RE.sub(repl, txt)
        if new != txt:
            write(html, new)
    print("OK: normalize_canonical complete")

if __name__ == "__main__":
    main()
