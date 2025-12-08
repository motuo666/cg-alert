#!/usr/bin/env python3
"""Build canonical data/events.csv from events.raw/backlog using simple materiality and lead-gen heuristics.

- Inputs:
  - data/events.raw.csv      (high-signal events from promote_evidence_events.py)
  - data/events.backlog.csv  (mid-signal events)
  - data/vendor_priority.csv (vendor-level scores)
  - config/materiality_rules.json

- Output:
  - data/events.csv          (canonical event list for reports/RSS/etc.)

This script is intentionally simple and deterministic so it can be run safely from CI.
"""

import argparse
import csv
import json
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG = ROOT / "config"

RAW_CSV = DATA / "events.raw.csv"
BACKLOG_CSV = DATA / "events.backlog.csv"
VENDOR_PRIORITY_CSV = DATA / "vendor_priority.csv"
MATERIALITY_JSON = CONFIG / "materiality_rules.json"
EVENTS_CSV = DATA / "events.csv"


def load_csv(path: Path) -> List[Dict[str, str]]:
    if not path.exists():
        return []
    rows: List[Dict[str, str]] = []
    with path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append({k: (v or "").strip() for k, v in row.items()})
    return rows


def load_vendor_priority(path: Path) -> Dict[str, float]:
    rows = load_csv(path)
    out: Dict[str, float] = {}
    for r in rows:
        vendor = (r.get("vendor") or "").strip().lower()
        if not vendor:
            continue
        try:
            score = float(r.get("score") or "0")
        except ValueError:
            score = 0.0
        out[vendor] = score
    return out


def load_materiality(path: Path) -> Dict:
    if not path.exists():
        # Reasonable defaults
        return {
            "weights": {
                "Pricing": 3,
                "DPA": 3,
                "ToS": 2,
                "Privacy": 2,
                "Subprocessors": 2,
                "Status": 1,
                "Other": 1,
            },
            "recent_days": 90,
            "thresholds": {"high": 8, "medium": 4},
        }
    return json.loads(path.read_text(encoding="utf-8"))


def classify_category(url: str, change: str) -> str:
    text = f"{url} {change}".lower()
    if any(k in text for k in ("pricing", "/plans", "/plan", "billing")):
        return "Pricing"
    if any(k in text for k in ("dpa", "data-processing", "data_processing", "data processing")):
        return "DPA"
    if any(k in text for k in ("terms-of-service", "/terms", "legal-terms")):
        return "ToS"
    if "privacy" in text:
        return "Privacy"
    if any(k in text for k in ("subprocessor", "sub-processors", "sub-processors", "subprocessors")):
        return "Subprocessors"
    if any(k in text for k in ("/status", "status.", "sla")):
        return "Status"
    return "Other"


def parse_date(s: str) -> datetime:
    s = (s or "").strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    # Fallback: try first 10 chars
    if len(s) >= 10:
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d")
        except Exception:
            pass
    # Default to very old
    return datetime(1970, 1, 1)


def compute_score(row: Dict[str, str], source: str, vendor_scores: Dict[str, float], mat: Dict) -> float:
    """Compute a simple materiality / lead-gen score for an event."""
    url = row.get("url") or ""
    change = row.get("change") or ""
    tier = (row.get("tier") or "").strip().lower()
    vendor_key = (row.get("vendor") or "").strip().lower()

    category = classify_category(url, change)
    weights = mat.get("weights", {})
    base = float(weights.get(category, 1))

    # Source bonus: HIGH candidates > backlog
    if source == "raw":
        base += 2.0
    elif source == "backlog":
        base += 1.0

    # Tier bonus: business/enterprise more interesting for revenue teams
    if tier in ("business", "enterprise"):
        base += 1.0

    # Vendor priority: normalise roughly to 0..4
    v_score = vendor_scores.get(vendor_key, 0.0)
    base += (v_score / 25.0)  # 100 -> +4, 50 -> +2, etc.

    # Recency decay: prefer recent changes, but don't fully drop older ones inside window
    recent_days = int(mat.get("recent_days", 90) or 90)
    decay_cfg = mat.get("decay", {})
    half_life = float(decay_cfg.get("half_life_days", recent_days)) or float(recent_days)
    dt = parse_date(row.get("date") or "")
    days_ago = (datetime.utcnow() - dt).days
    if days_ago > recent_days:
        # Outside recency window; treat as very low score
        return 0.0

    if decay_cfg.get("enabled", True):
        # Simple exponential decay with half-life
        factor = 0.5 ** max(0.0, days_ago / half_life)
        base *= factor

    return base


def build_events() -> List[Dict[str, str]]:
    raw_rows = load_csv(RAW_CSV)
    backlog_rows = load_csv(BACKLOG_CSV)
    vendor_scores = load_vendor_priority(VENDOR_PRIORITY_CSV)
    mat = load_materiality(MATERIALITY_JSON)
    medium_threshold = float(mat.get("thresholds", {}).get("medium", 4))

    candidates: List[Tuple[float, Dict[str, str]]] = []
    seen_keys = set()

    def add_rows(rows: List[Dict[str, str]], source: str) -> None:
        nonlocal candidates
        for r in rows:
            date = (r.get("date") or "").strip()
            vendor = (r.get("vendor") or "").strip()
            url = (r.get("url") or "").strip()
            if not date or not vendor or not url:
                continue
            key = (date, vendor.lower(), url)
            score = compute_score(r, source, vendor_scores, mat)
            if score <= 0:
                continue
            # De-duplicate by (date, vendor, url), keep highest score/source
            if key in seen_keys:
                # Keep the higher score version
                for i, (s_old, row_old) in enumerate(candidates):
                    if (
                        (row_old.get("date") or "").strip() == date
                        and (row_old.get("vendor") or "").strip().lower() == vendor.lower()
                        and (row_old.get("url") or "").strip() == url
                    ):
                        if score > s_old:
                            candidates[i] = (score, r)
                        break
                continue
            seen_keys.add(key)
            candidates.append((score, r))

    add_rows(raw_rows, "raw")
    add_rows(backlog_rows, "backlog")

    # Filter to medium+ score
    filtered = [(s, r) for (s, r) in candidates if s >= medium_threshold]
    # Sort by score desc, then date desc
    filtered.sort(key=lambda t: (t[0], t[1].get("date") or ""), reverse=True)

    # Limit per vendor and global max to avoid overwhelming the public feed
    max_per_vendor = 10
    max_total = 200
    counts: Dict[str, int] = {}
    final_rows: List[Dict[str, str]] = []

    for score, r in filtered:
        vendor = (r.get("vendor") or "").strip().lower()
        if not vendor:
            continue
        if counts.get(vendor, 0) >= max_per_vendor:
            continue
        final_rows.append(r)
        counts[vendor] = counts.get(vendor, 0) + 1
        if len(final_rows) >= max_total:
            break

    return final_rows


def ensure_headers(existing: List[str]) -> List[str]:
    # Respect existing header ordering if possible; otherwise use a sane default.
    wanted = [
        "change",
        "impact",
        "tier",
        "date",
        "vendor",
        "id",
        "title",
        "captured_at",
        "fingerprint",
        "url",
        "severity",
    ]
    if existing:
        # Make sure all wanted fields are present, preserving any extra fields at the end
        out = list(existing)
        for w in wanted:
            if w not in out:
                out.append(w)
        return out
    return wanted


def write_events(rows: List[Dict[str, str]]) -> None:
    # Load existing header if events.csv exists
    header: List[str] = []
    if EVENTS_CSV.exists():
        with EVENTS_CSV.open(newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            header = reader.fieldnames or []
    header = ensure_headers(header)

    with EVENTS_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=header)
        writer.writeheader()
        for r in rows:
            out = {k: "" for k in header}
            for k, v in r.items():
                if k in out:
                    out[k] = v
            # Best-effort defaults so normalize_events.py has something to work with
            out["title"] = out.get("title") or out.get("change") or ""
            out["captured_at"] = out.get("captured_at") or out.get("date") or ""
            out["url"] = out.get("url") or ""
            out["vendor"] = out.get("vendor") or ""
            writer.writerow(out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=str(ROOT), help="repository root (optional)")
    _ = ap.parse_args()  # kept for CLI compatibility; ROOT is derived from script location

    rows = build_events()
    write_events(rows)
    print(f"[build_events_canonical] wrote {len(rows)} events to {EVENTS_CSV}")


if __name__ == "__main__":
    main()
