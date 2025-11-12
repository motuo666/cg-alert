#!/usr/bin/env python3
import pathlib, re, sys, argparse

A_RE = re.compile(r'<a\b([^>]+)>', re.I)
TARGET_RE = re.compile(r'\btarget=["\']?_blank["\']?', re.I)
REL_RE = re.compile(r'\brel=["\']([^"\']*)["\']', re.I)

def process_html(path: pathlib.Path):
    txt = path.read_text(encoding="utf-8", errors="ignore")
    def repl(m):
        attrs = m.group(1)
        if TARGET_RE.search(attrs):
            rel_m = REL_RE.search(attrs)
            if rel_m:
                rel_val = rel_m.group(1)
                parts = set(p.strip().lower() for p in rel_val.split())
                parts.update({"noopener","noreferrer"})
                new_rel = 'rel="%s"' % " ".join(sorted(parts))
                attrs2 = REL_RE.sub(new_rel, attrs, count=1)
            else:
                attrs2 = attrs + ' rel="noopener noreferrer"'
            return f"<a{attrs2}>"
        return m.group(0)
    new = A_RE.sub(repl, txt)
    if new != txt:
        path.write_text(new, encoding="utf-8")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    args = ap.parse_args()
    root = pathlib.Path(args.root)
    for p in root.rglob("*.html"):
        if any(seg in {".git","node_modules"} for seg in p.parts):
            continue
        process_html(p)
    print("OK: harden_html complete")

if __name__ == "__main__":
    main()
