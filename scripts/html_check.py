import os, json
from bs4 import BeautifulSoup

BASE = "."
REPORTS_DIR = "reports/qa"
os.makedirs(REPORTS_DIR, exist_ok=True)


def read(path):
    with open(path, "rb") as f:
        return f.read().decode("utf-8", errors="replace")


def norm_url(u: str) -> str:
    u = (u or "").split("#", 1)[0].split("?", 1)[0].strip()
    return u


rows = []
html_files = []
for root, _, files in os.walk(BASE):
    for fn in files:
        ext = os.path.splitext(fn)[1].lower()
        if ext in (".html", ".htm"):
            html_files.append(os.path.join(root, fn))

for path in html_files:
    rel = os.path.relpath(path, BASE)
    text = read(path)
    soup = BeautifulSoup(text, "html.parser")

    title_ok = bool(soup.title and (soup.title.get_text() or "").strip())
    h1_tag = soup.find("h1")
    h1_ok = bool(h1_tag and (h1_tag.get_text() or "").strip())
    desc_ok = bool(soup.find("meta", attrs={"name": "description"}))

    empty_links = missing_rel = broken_imgs = missing_alt = 0

    # Check anchors
    for a in soup.find_all("a"):
        href = (a.get("href") or "").strip()
        if not href:
            empty_links += 1
            continue
        if href in ("#", "javascript:void(0)", "javascript:;"):
            continue
        if href.startswith(("http://", "https://", "mailto:", "tel:")):
            continue
        if href.startswith("#"):
            # internal fragment; html validity is enforced elsewhere
            continue

        base = norm_url(href)
        if not base:
            continue

        exists = True
        if base.startswith("/"):
            # Site-absolute link. Try a few common patterns relative to repo root.
            cand = base.lstrip("/")
            candidates = [
                cand,
                os.path.join(cand, "index.html"),
                cand + ".html",
            ]
            exists = any(os.path.exists(os.path.join(BASE, c)) for c in candidates)
        else:
            target = os.path.normpath(os.path.join(os.path.dirname(rel), base))
            exists = os.path.exists(target)

        if not exists:
            missing_rel += 1

    # Check images
    for img in soup.find_all("img"):
        alt = (img.get("alt") or "").strip()
        if not alt:
            missing_alt += 1

        src = (img.get("src") or "").strip()
        if not src or src.startswith(("http://", "https://", "data:")):
            continue

        base = norm_url(src)
        if not base:
            continue

        if base.startswith("/"):
            target = os.path.join(BASE, base.lstrip("/"))
        else:
            target = os.path.normpath(os.path.join(os.path.dirname(rel), base))

        if not os.path.exists(target):
            broken_imgs += 1

    rows.append(
        {
            "file": rel,
            "title_ok": title_ok,
            "h1_ok": h1_ok,
            "desc_ok": desc_ok,
            "empty_links": empty_links,
            "missing_rel": missing_rel,
            "broken_imgs": broken_imgs,
            "missing_alt": missing_alt,
        }
    )

# Write JSON report
out_path = os.path.join(REPORTS_DIR, "html_check.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(rows, f, ensure_ascii=False, indent=2)

# Decide pass/fail. We only enforce semantic checks on real pages,
# not on templates / includes / generated evidence snapshots.
bad = []
for r in rows:
    rel = r["file"]
    in_templates = rel.startswith(("config/", "templates/", "includes/"))
    in_data = rel.startswith(("evidence/", "reports/", "artifacts/", "ops/"))
    semantics_needed = not in_templates and not in_data
    link_checks_needed = not (in_templates or in_data)

    fail = False
    if semantics_needed and not (r["title_ok"] and r["h1_ok"] and r["desc_ok"]):
        fail = True
    if link_checks_needed and (r["empty_links"] or r["missing_rel"] or r["broken_imgs"]):
        fail = True

    if fail:
        bad.append(r)

exit(0 if not bad else 1)
