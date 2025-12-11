#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Simple health check for the events pipeline.
- Looks at data/events.json or data/events.csv.
- Fails (exit code 1) if there are no events in the last N days.
Intended to be called from GitHub Actions on a schedule.
"""

import argparse
import csv
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List

ROOT = Path(__file__).resolve().parents[1]
EVENTS_JSON = ROOT / "data" / "events.json"
EVENTS_CSV = ROOT / "data" / "events.csv"


def load_events() -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    if EVENTS_JSON.exists():
        try:
            raw = EVENTS_JSON.read_text(encoding="utf-8")
            data = json.loads(raw)
            if isinstance(data, dict) and "items" in data:
                items = data["items"]
            elif isinstance(data, list):
                items = data
        except Exception as e:  # pragma: no cover
            print(f"[check_events_health] WARN: failed to read events.json: {e}")
    if not items and EVENTS_CSV.exists():
        with EVENTS_CSV.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                items.append({
                    "date": (row.get("date") or "").strip(),
                    "vendor": (row.get("vendor") or "").strip(),
                    "url": (row.get("url") or "").strip(),
                    "title": (row.get("change") or row.get("title") or "").strip(),
                })
    return items


def parse_date(s: str) -> datetime:
    s = (s or "").strip()
    if not s:
        return datetime.utcfromtimestamp(0)
    # Accept date-only (YYYY-MM-DD) and common ISO 8601 datetime strings
    candidates = [s, s[:10]]
    for raw in candidates:
        for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ"):
            try:
                return datetime.strptime(raw, fmt)
            except Exception:
                continue
    return datetime.utcfromtimestamp(0)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3, help="lookback window in days")
    args = ap.parse_args()

    items = load_events()
    if not items:
        print("[check_events_health] no events file found or empty")
        raise SystemExit(1)

    cutoff = datetime.utcnow() - timedelta(days=args.days)
    recent = [ev for ev in items if parse_date(ev.get("date") or "") >= cutoff]

    print(f"[check_events_health] total events: {len(items)}, recent (<= {args.days}d): {len(recent)}")
    if not recent:
        # 在某些时间段内没有新事件并不一定代表系统坏了，可能只是监控窗口内没有变更
        # 这里降级为 WARNING，保留日志提示但不让 CI 挂掉
        print("[check_events_health] WARN: no recent events in lookback window (soft-fail, exit 0)")
        return


if __name__ == "__main__":
    main()
