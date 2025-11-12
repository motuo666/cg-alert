#!/usr/bin/env python3
import argparse, pathlib, re

# Minimal, style-safe auto fixer:
# - If href is internal and points to '.../index.html', rewrite to '/.../'
# - If href is internal *.html but a sibling directory exists with index.html, rewrite to that directory slash URL
# - If href contains '#anchor' and target exists but anchor missing, inject invisible anchor before </body>

HREF_RE = re.compile(r'href=[\"\']([^\"\']+)[\"\']', re.I)

def read_text(p):
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return ""

def write_text(p, text):
    p.write_text(text, encoding="utf-8")

def is_external(href):
    return href.startswith(("http://","https://","mailto:","tel:","javascript:","data:"))

def scan_html(root):
    for p in pathlib.Path(root).rglob("*.html"):
        if any(seg in {".git","node_modules"} for seg in p.parts):
            continue
        yield p

def inject_anchor(target_file, anchor):
    text = read_text(target_file)
    if not text:
        return False
    if re.search(r'id=[\"\']%s[\"\']' % re.escape(anchor), text) or re.search(r'name=[\"\']%s[\"\']' % re.escape(anchor), text):
        return False
    # invisible anchor before </body>
    inj = f'<a id="{anchor}" style="position:absolute;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden"></a>'
    new = re.sub(r'</body\s*>', inj + r'</body>', text, flags=re.I)
    if new != text:
        write_text(target_file, new)
        return True
    # if no </body>, append
    write_text(target_file, text + inj)
    return True

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", required=True)
    args = ap.parse_args()

    root = pathlib.Path(args.root)

    for html in scan_html(root):
        text = read_text(html)
        changed = False
        def replacer(m):
            nonlocal changed
            href = m.group(1)
            if is_external(href):
                return m.group(0)

            # normalize windows backslashes
            href_norm = href.replace("\\\\", "/")

            # resolve path
            base = html.parent
            anchor = None
            if "#" in href_norm:
                href_path, anchor = href_norm.split("#", 1)
            else:
                href_path = href_norm

            # absolute vs relative
            if href_path.startswith("/"):
                target = root / href_path.lstrip("/")
            else:
                target = (base / href_path).resolve()

            # rewrite .../index.html -> /.../
            if href_path.endswith("index.html"):
                new_href = href_path[:-10]  # remove index.html
                if not new_href.endswith("/"):
                    new_href += "/"
                if anchor:
                    new_href += "#" + anchor
                changed = True
                return f'href="{new_href}"'

            # if *.html missing but directory exists with index.html
            if href_path.endswith(".html") and not target.exists():
                # try directory variant
                guess_dir = target.with_suffix("")
                if guess_dir.is_dir() and (guess_dir / "index.html").exists():
                    new_href = href_path[:-5]  # drop .html
                    if not new_href.endswith("/"):
                        new_href += "/"
                    if anchor:
                        new_href += "#" + anchor
                    changed = True
                    return f'href="{new_href}"'

            # anchor injection if target file exists but anchor missing
            if anchor:
                # compute target file for anchor lookup
                tfile = None
                if href_path == "" or href_path == ".":
                    tfile = html
                else:
                    tf = target
                    if tf.is_dir():
                        tf = tf / "index.html"
                    tfile = tf
                if tfile.exists():
                    if inject_anchor(tfile, anchor):
                        changed = True
                        return m.group(0)

            return m.group(0)

        new_text = HREF_RE.sub(replacer, text)
        if changed and new_text != text:
            write_text(html, new_text)

    print("OK: auto_fix_links complete")

if __name__ == "__main__":
    main()
