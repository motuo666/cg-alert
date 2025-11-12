#!/usr/bin/env python3
import os, re, sys, argparse, pathlib

def iter_html(root):
    for p in pathlib.Path(root).rglob("*.html"):
        if any(seg in {".git","node_modules"} for seg in p.parts):
            continue
        yield p

_href_re = re.compile(r'href=[\"\']([^\"\']+)[\"\']', re.I)

def resolve(root, current_dir, href):
    if href.startswith(("http://", "https://", "mailto:", "tel:", "javascript:", "data:")):
        return None
    if href.startswith("/"):
        path = pathlib.Path(root) / href.lstrip("/")
    else:
        path = pathlib.Path(current_dir) / href

    path_str = str(path)
    anchor = None
    if "#" in path_str:
        path_str, anchor = path_str.split("#", 1)
    if "?" in path_str:
        path_str, _ = path_str.split("?", 1)
    return pathlib.Path(path_str), anchor

def has_anchor(file_path, anchor):
    try:
        txt = pathlib.Path(file_path).read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return False
    if not anchor:
        return True
    return (re.search(r'id=[\"\']%s[\"\']' % re.escape(anchor), txt) or
            re.search(r'name=[\"\']%s[\"\']' % re.escape(anchor), txt)) is not None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="Site root")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    missing = []
    for html in iter_html(args.root):
        try:
            text = html.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for href in _href_re.findall(text):
            resolved = resolve(args.root, html.parent, href)
            if resolved is None:
                continue
            file_path, anchor = resolved
            if not file_path.exists():
                missing.append((str(html), href, str(file_path)))
                if args.verbose:
                    print(f"[MISS] {html} -> {href} (tried {file_path})")
                continue
            if not has_anchor(file_path, anchor):
                missing.append((str(html), href + " (anchor)", f"{file_path}#{anchor}"))
                if args.verbose:
                    print(f"[MISS] {html} -> {href} (missing anchor {anchor})")

    if missing:
        print(f"Broken internal links: {len(missing)}")
        for src, href, tried in missing[:500]:
            print(f"- {src} : '{href}' -> missing '{tried}'")
        print("FAIL: link check")
        sys.exit(2)

    print("OK: link check passed")
    sys.exit(0)

if __name__ == "__main__":
    main()
