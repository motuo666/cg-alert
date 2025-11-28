#!/usr/bin/env python3
import argparse, pathlib, csv, json, hashlib, re, datetime

REQ = ["id","title","captured_at","fingerprint"]

def slugify(s):
    s = re.sub(r'[^a-zA-Z0-9]+','-', (s or "").strip()).strip('-')
    return s[:80] or "evt"

def ensure_captured_at(v):
    if not v: 
        return datetime.date.today().isoformat()
    # accept 'YYYY-MM-DD', 'YYYY/MM/DD', 'YYYY.MM.DD'
    v2 = re.sub(r'[/.]', '-', v.strip())
    if re.match(r'^\d{4}-\d{2}-\d{2}$', v2):
        return v2
    # fallback: only year-month
    m = re.match(r'^(\d{4})-(\d{1,2})$', v2)
    if m:
        return f"{m.group(1)}-{int(m.group(2)):02d}-01"
    return datetime.date.today().isoformat()

def mk_fingerprint(url, captured_at, title):
    basis = (url or "") + "|" + (captured_at or "") + "|" + (title or "")
    return hashlib.sha256(basis.encode("utf-8")).hexdigest()

def compute_severity(r):
    text = " ".join([
        str(r.get("title") or ""),
        str(r.get("notes") or ""),
        str(r.get("section") or ""),
        str(r.get("url") or ""),
        str(r.get("path") or ""),
    ]).lower()
    high_kw = [
        "security breach","breach","security incident",
        "personal data","personal information","pii",
        "data processing","data protection","dpa",
        "sub-processor","subprocessor","sub processor",
        "liability","indemn","warranty","limitation of liability",
        "suspend","suspension","terminate","termination",
        "credit card","payment card","authentication","encryption",
        "availability","uptime","sla","service level"
    ]
    med_kw = [
        "price","pricing","fee","fees","charge","billing",
        "renew","renewal","term","commitment",
        "data","processor","controller","controller-processor",
        "cookie","tracking","analytics"
    ]
    low_kw = [
        "typo","spelling","copy","cosmetic",
        "example","demo"
    ]
    if any(k in text for k in high_kw):
        return "high"
    if any(k in text for k in med_kw):
        return "medium"
    if any(k in text for k in low_kw):
        return "low"
    # default: medium so most events are treated as worth a look
    return "medium"

def normalize_rows(rows):
    out = []
    for r in rows:
        title = r.get("title") or r.get("change") or r.get("event") or ""
        url = r.get("url") or r.get("source") or ""
        captured_at = ensure_captured_at(r.get("captured_at") or r.get("date") or r.get("captured") or "")
        rid = r.get("id") or slugify(title) + "-" + captured_at.replace("-","")
        fp = r.get("fingerprint") or mk_fingerprint(url, captured_at, title)
        nr = dict(r)
        nr.update({"id": rid, "title": title, "captured_at": captured_at, "fingerprint": fp})
        # attach a simple severity classification if not already provided
        if not nr.get("severity"):
            nr["severity"] = compute_severity(nr)
        out.append(nr)
    return out

def write_csv(p, rows):
    if not rows:
        return
    headers = list({k for r in rows for k in r.keys()})
    with open(p, "w", encoding="utf-8", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=headers)
        wr.writeheader()
        wr.writerows(rows)

def write_json(p, rows):
    p.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    args = ap.parse_args()
    root = pathlib.Path(args.root)

    candidates = [root/"data"/"events.csv", root/"data"/"events.json"]
    any_found = False
    for p in candidates:
        if not p.exists():
            continue
        any_found = True
        if p.suffix == ".csv":
            import csv
            with open(p, encoding="utf-8") as f:
                dr = csv.DictReader(f)
                rows = list(dr)
            rows = normalize_rows(rows)
            write_csv(p, rows)
        else:
            arr = json.loads(p.read_text(encoding="utf-8", errors="ignore") or "[]")
            if not isinstance(arr, list):
                continue
            rows = normalize_rows(arr)
            write_json(p, rows)
    if not any_found:
        print("WARN: no events.csv or events.json found")
    print("OK: normalize_events complete")

if __name__ == "__main__":
    main()
