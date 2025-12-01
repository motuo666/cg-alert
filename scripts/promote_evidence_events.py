#!/usr/bin/env python3
import argparse, pathlib, csv, json, re, datetime, sys
from typing import List, Dict

HIGH_THRESHOLD = 0.85
MID_THRESHOLD = 0.55

RAW_HEADERS = ["date","vendor","url","change","impact","tier"]

def log(msg: str) -> None:
    print(f"[promote_evidence_events] {msg}")

def load_csv(path: pathlib.Path) -> List[Dict[str,str]]:
    if not path.exists():
        return []
    rows: List[Dict[str,str]] = []
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for r in reader:
            clean = { (k or "").strip(): (v or "").strip() for k,v in r.items() }
            rows.append(clean)
    return rows

def write_csv(path: pathlib.Path, rows: List[Dict[str,str]]) -> None:
    if not rows:
        # still write header so downstream tools stay happy
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=RAW_HEADERS)
            w.writeheader()
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=RAW_HEADERS)
        w.writeheader()
        for r in rows:
            w.writerow({ h: r.get(h,"") for h in RAW_HEADERS })

def fingerprint(row: Dict[str,str]) -> str:
    return "|".join([
        (row.get("date") or "").strip(),
        (row.get("vendor") or "").strip().lower(),
        (row.get("url") or "").strip(),
        (row.get("change") or "").strip(),
        (row.get("tier") or "").strip().lower(),
    ])

HIGH_PAGES = {
    "security","dpa","subprocessors","sub-processor","subprocessor",
    "terms-of-service","legal-terms","terms","privacy","sla","data-processing"
}
PRICING_PAGES = {"pricing","plans","plan","billing"}

def compute_score(ev: Dict[str,object], snippet: str) -> float:
    key = str(ev.get("key") or "").lower()
    page = str(ev.get("page") or "").lower()
    url = str(ev.get("url") or "").lower()
    text = " ".join([snippet or "", key, page, url]).lower()

    base = 0.5
    if key in HIGH_PAGES or any(k in page for k in HIGH_PAGES):
        base = 0.75
    elif key in PRICING_PAGES or "pricing" in page:
        base = 0.65

    def has(words):
        return any(w in text for w in words)

    if has(["security breach","data breach","breach","compromise"]):
        base += 0.2
    if has(["personal data","pii","data processing","data protection","dpa","sub-processor","subprocessor","sub processor"]):
        base += 0.15
    if has(["price","pricing","per seat","per-user","per user","discount","increase","billing"]):
        base += 0.1
    if has(["typo","spelling","copy only","layout","css only","visual only"]):
        base -= 0.2
    if has(["cookie","tracking","analytics"]):
        base += 0.05
    if has(["beta","experiment","test only"]):
        base -= 0.05

    if base < 0.0: 
        base = 0.0
    if base > 1.0:
        base = 1.0
    return base

def build_change_summary(vendor: str, key: str, page: str) -> str:
    v = (vendor or "").strip()
    k = (key or "").strip().lower()
    p = (page or "").strip()
    if k in HIGH_PAGES:
        return f"{v} {k.replace('-', ' ')} updated"
    if k in PRICING_PAGES or "pricing" in p.lower():
        return f"{v} pricing/plan page changed"
    if k:
        return f"{v} {k} page changed"
    return f"{v} content changed"

def build_impact_summary(key: str) -> str:
    k = (key or "").strip().lower()
    if k in {"security","dpa","privacy","terms","terms-of-service","legal-terms","data-processing"}:
        return "High-impact legal/security change (auto-detected)"
    if k in {"subprocessors","sub-processor","subprocessor"}:
        return "Subprocessor list changed (auto-detected)"
    if k in PRICING_PAGES or k == "pricing":
        return "Potential pricing/packaging change (auto-detected)"
    if k in {"status","sla"}:
        return "Service status / SLA change (auto-detected)"
    return "Content change detected (auto-detected)"

def safe_load_json(path: pathlib.Path):
    try:
        return json.loads(path.read_text(encoding="utf-8", errors="ignore") or "{}")
    except Exception:
        return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".", help="Repository root (defaults to current directory)")
    args = ap.parse_args()
    root = pathlib.Path(args.root).resolve()

    # Allow running from parent of cg-alert-main when zipped
    if (root / "cg-alert-main" / "data").exists() and not (root / "data").exists():
        root = root / "cg-alert-main"

    data_dir = root / "data"
    ev_dir = root / "evidence" / ".pending"

    if not ev_dir.exists():
        log("no evidence/.pending directory, nothing to do")
        return

    raw_path = data_dir / "events.raw.csv"
    rejects_path = data_dir / "events.rejects.csv"
    backlog_path = data_dir / "events.backlog.csv"

    existing_raw = load_csv(raw_path) if raw_path.exists() else []
    existing_rejects = load_csv(rejects_path) if rejects_path.exists() else []
    existing_backlog = load_csv(backlog_path) if backlog_path.exists() else []

    existing_fp = set()
    for row in existing_raw + existing_rejects + existing_backlog:
        existing_fp.add(fingerprint(row))

    new_high: List[Dict[str,str]] = []
    new_mid: List[Dict[str,str]] = []

    pending_files = sorted(ev_dir.rglob("*.json"))
    if not pending_files:
        log("no pending evidence JSON files found")
        # still ensure headers exist
        if not raw_path.exists() and not existing_raw:
            write_csv(raw_path, [])
        return

    today = datetime.date.today().isoformat()
    considered = 0
    for p in pending_files:
        data = safe_load_json(p)
        if not isinstance(data, dict):
            continue
        status = str(data.get("status_code") or "")
        if status and not status.startswith("2"):
            continue

        old_h = (data.get("old_hash") or "").strip()
        new_h = (data.get("new_hash") or "").strip()
        if not new_h:
            continue
        if old_h and old_h == new_h:
            continue  # no actual change

        vendor = (data.get("vendor") or "").strip()
        url = (data.get("url") or "").strip()
        page = (data.get("page") or "").strip()
        key = (data.get("key") or "").strip()
        snippet = str(data.get("snippet") or "")

        first_seen = (data.get("first_seen_at") or data.get("ts") or "").strip()
        if re.match(r"^\d{4}-\d{2}-\d{2}", first_seen):
            date = first_seen[:10]
        else:
            date = today

        change = build_change_summary(vendor, key, page)
        impact = build_impact_summary(key)

        k_lower = key.lower()
        if k_lower in HIGH_PAGES:
            tier = "business"
        elif k_lower in PRICING_PAGES or "pricing" in page.lower():
            tier = "pro"
        else:
            tier = "pro"

        row = {
            "date": date,
            "vendor": vendor,
            "url": url,
            "change": change,
            "impact": impact,
            "tier": tier,
        }
        fp = fingerprint(row)
        if fp in existing_fp:
            continue

        score = compute_score(data, snippet)
        considered += 1
        if score >= HIGH_THRESHOLD:
            new_high.append(row)
            existing_fp.add(fp)
        elif score >= MID_THRESHOLD:
            new_mid.append(row)
            existing_fp.add(fp)
        # else: silently dropped

    if not new_high and not new_mid:
        log(f"no new high/medium score events (considered={considered})")
        # still ensure headers
        if not raw_path.exists() and not existing_raw:
            write_csv(raw_path, [])
        if new_mid and not backlog_path.exists():
            write_csv(backlog_path, existing_backlog)
        return

    # Merge & sort RAW (existing + high-score newcomers)
    merged_raw = list(existing_raw)
    merged_raw.extend(new_high)
    # Sort by date ascending, then vendor, then url
    def sort_key(r):
        return (r.get("date",""), r.get("vendor",""), r.get("url",""))
    merged_raw.sort(key=sort_key)

    # Merge backlog with medium-score candidates
    merged_backlog = list(existing_backlog)
    merged_backlog.extend(new_mid)

    write_csv(raw_path, merged_raw)
    if merged_backlog:
        write_csv(backlog_path, merged_backlog)

    log(f"considered={considered}, promoted={len(new_high)}, backlog={len(new_mid)}")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
