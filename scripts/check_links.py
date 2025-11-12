#!/usr/bin/env python3
import os, re, sys, argparse, pathlib

def iter_html(root):
    for p in pathlib.Path(root).rglob("*.html"):
        yield p

_href_re = re.compile(rhref=["\']([^"\']+)["\'], re.I)

def resolve(root, current_dir, href):
    # ignore external and anchors/mail
    if href.startswith(("http://", "https://", "mailto:", "tel:", "#", "javascript:")):
        return None
    # site-absolute
    if href.startswith("/"):
        path = pathlib.Path(root) / href.lstrip("/")
    else:
        path = pathlib.Path(current_dir) / href

    candidates = []
    if path.suffix:
        candidates.append(path)
    else:
        candidates.append(path / "index.html")
        candidates.append(path.with_suffix(".html"))
    for c in candidates:
        if c.exists():
            return c
    return candidates[0]  # first attempted path, for error display

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()

    root = pathlib.Path(args.root).resolve()
    missing = []

    for html in iter_html(root):
        text = html.read_text(encoding="utf-8", errors="ignore")
        for href in _href_re.findall(text):
            resolved = resolve(root, html.parent, href)
            if resolved is None:
                continue
            if not resolved.exists():
                missing.append((str(html.relative_to(root)), href, str(resolved.relative_to(root))))
                if args.verbose:
                    print(f"[MISS] {html} -> {href} (tried {resolved})")

    if missing:
        print("Broken internal links:", len(missing))
        for src, href, tried in missing[:200]:
            print(f"- {src} : '{href}' -> missing '{tried}'")
        print("FAIL: link check")
        sys.exit(2)
    print("OK: link check passed")
    sys.exit(0)

if __name__ == "__main__":
    main()
