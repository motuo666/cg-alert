#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate per-customer weekly/daily digests as plain-text artifacts.
- Reads full data from data/events.json or data/events.csv (no filtering for public).
- Reads customers from config/customers.json (if present) or falls back to config/customers.example.json.
- For each customer, selects events from the last 7 days that match the customer's vendors.
- Writes plain text files to artifacts/digests/{customer_id}.txt.
- Does NOT send email or call webhooks. SMTP/Webhook wiring is a TODO for CI.
"""
import os, csv, json, datetime, sys
from html import escape

ROOT = os.path.dirname(os.path.abspath(os.path.join(__file__, "..")))
def p(*xs): print(*xs, file=sys.stderr)

def load_events():
    data_dir = os.path.join(ROOT, "..", "data")
    j = os.path.join(data_dir, "events.json")
    c = os.path.join(data_dir, "events.csv")
    items = []
    if os.path.exists(j):
        try:
            with open(j, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict) and "items" in data:
                items = data["items"]
            elif isinstance(data, list):
                items = data
        except Exception as e:
            p("WARN: failed to read events.json:", e)
    if not items and os.path.exists(c):
        with open(c, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                items.append({
                    "date": row.get("date","").strip(),
                    "vendor": row.get("vendor","").strip(),
                    "url": row.get("url","").strip(),
                    "title": row.get("change","").strip() or row.get("title","").strip(),
                    "summary": row.get("impact","").strip()
                })
    # Normalize
    for it in items:
        it["vendor"] = (it.get("vendor") or "").lower().strip()
    return items

def load_customers():
    cfg = os.path.join(ROOT, "..", "config", "customers.json")
    ex = os.path.join(ROOT, "..", "config", "customers.example.json")
    path = cfg if os.path.exists(cfg) else ex
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

def parse_date(s):
    try:
        if len(s) >= 10:
            return datetime.datetime.strptime(s[:10], "%Y-%m-%d").date()
    except Exception:
        return None
    return None

def filter_recent(items, vendors, days=7):
    vs = set([v.lower().strip() for v in vendors or []])
    today = datetime.date.today()
    out = []
    for it in items:
        if it.get("vendor") not in vs:
            continue
        d = parse_date(it.get("date",""))
        if not d: 
            continue
        if (today - d).days <= days:
            out.append(it)
    # sort newest first
    out.sort(key=lambda x: x.get("date",""), reverse=True)
    return out

def ensure_dir(pth):
    os.makedirs(os.path.dirname(pth), exist_ok=True)

def write_digest(cid, customer, events):
    dst = os.path.join(ROOT, "..", "artifacts", "digests", f"{cid}.txt")
    ensure_dir(dst)
    lines = []
    lines.append(f"CG Alert — Digest for {cid} ({customer.get('plan','')})")
    lines.append("")
    if events:
        for e in events:
            d = e.get("date","")
            v = e.get("vendor","")
            t = e.get("title","")
            u = e.get("url","")
            s = e.get("summary","")
            lines.append(f"- [{d}] {v}: {t}")
            if s:
                lines.append(f"  Impact: {s}")
            if u:
                lines.append(f"  URL: {u}")
    else:
        lines.append("No vendor changes in the last 7 days for this customer.")
    lines.append("")
    lines.append("—")
    lines.append("TODO: wire up SMTP / Webhook in CI, this script only generates digest artifacts.")
    with open(dst, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    p("Wrote", dst)

def main():
    items = load_events()
    customers = load_customers()
    for c in customers:
        cid = c.get("id") or "unknown"
        vendors = c.get("vendors") or []
        ev = filter_recent(items, vendors, days=7)
        write_digest(cid, c, ev)
    p("Done. Customers:", len(customers))

if __name__ == "__main__":
    main()
