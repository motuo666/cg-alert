#!/usr/bin/env python3
import os, re, sys, argparse, pathlib

HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)

def iter_html(root):
    for p in pathlib.Path(root).rglob("*.html"):
        if any(seg in {".git","node_modules"} for seg in p.parts):
            continue
        yield p

def split_href(href: str):
    path = href
    anchor = None
    if "#" in path:
        path, anchor = path.split("#", 1)
    if "?" in path:
        path, _ = path.split("?", 1)
    return path, anchor

def resolve_path(root: pathlib.Path, current_dir: pathlib.Path, href: str):
    if href.startswith(("http://","https://","mailto:","tel:","javascript:","data:")):
        return None, None
    href_path, anchor = split_href(href)
    if href_path.startswith("/"):
        target = root / href_path.lstrip("/")
    elif href_path in ("", ".", "./"):
        idx = current_dir / "index.html"
        target = idx if idx.exists() else current_dir
    else:
        target = current_dir / href_path
    if target.exists() and target.is_dir():
        idx = target / "index.html"
        target = idx if idx.exists() else target
    return target, anchor

def has_anchor(file_path: pathlib.Path, anchor: str | None):
    if not anchor:
        return True
    try:
        if file_path.is_dir():
            return True
        txt = file_path.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return False
    return (re.search(r'id=["\']%s["\']' % re.escape(anchor), txt) or
            re.search(r'name=["\']%s["\']' % re.escape(anchor), txt)) is not None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True, help="Site root")
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    root = pathlib.Path(args.root)

    misses = []
    for html in iter_html(root):
        try:
            text = html.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for href in HREF_RE.findall(text):
            target, anchor = resolve_path(root, html.parent, href)
            if target is None:
                continue
            if not target.exists():
                misses.append((str(html.relative_to(root)), href, str(target)))
                if args.verbose:
                    print(f"[MISS] {html} -> {href} (tried {target})")
                continue
            if not has_anchor(target, anchor):
                show = target / "index.html" if target.is_dir() and (target / "index.html").exists() else target
                misses.append((str(html.relative_to(root)), href+" (anchor)", f"{show}#{anchor}"))
                if args.verbose:
                    print(f"[MISS] {html} -> {href} (missing anchor {anchor})")

    if misses:
        print(f"Broken internal links: {len(misses)}")
        for src, href, tried in misses[:500]:
            print(f"- {src} : '{href}' -> missing '{tried}'")
        sys.exit(2)

    print("OK: link check passed")
    sys.exit(0)

if __name__ == "__main__":
    main()
