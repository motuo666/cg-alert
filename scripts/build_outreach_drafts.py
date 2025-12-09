#!/usr/bin/env python3
"""scripts/build_outreach_drafts.py

Generate semi-automatic outreach email drafts from events.csv and a small
hand-curated outreach_targets.csv file.

This is intentionally low-volume and high-specificity: it prepares drafts for
humans to review and send, and does NOT send any email itself.

Input:
  - data/events.csv
      Canonical public event feed (same as used for reports/events).
  - data/outreach_targets.csv
      UTF-8 CSV with header:

          company,email,contact_name,vendors

      where `vendors` is a semicolon-separated list of vendor domains, e.g.:

          acme-corp,owner@acme.com,Alex Owner,okta.com;github.com

Output:
  - artifacts/outreach_drafts/<sanitized-company>.txt
      One text file per target with a ready-to-edit email draft.

Usage:
  python scripts/build_outreach_drafts.py

This script is safe to run in CI (it only writes local artifacts).
"""

import csv
import datetime as _dt
import os
from pathlib import Path
from typing import List, Dict

ROOT = Path(__file__).resolve().parents[1]
EVENTS_CSV = ROOT / "data" / "events.csv"
TARGETS_CSV = ROOT / "data" / "outreach_targets.csv"
OUT_DIR = ROOT / "artifacts" / "outreach_drafts"

TODAY = _dt.date.today()

def _parse_date(raw: str):
    raw = (raw or "").strip()
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%fZ"):
        try:
            return _dt.datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None

def load_events() -> List[Dict[str, str]]:
    if not EVENTS_CSV.exists():
        print("[outreach] events.csv not found, skipping")
        return []
    out: List[Dict[str, str]] = []
    with EVENTS_CSV.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            vendor = (row.get("vendor") or row.get("domain") or "").strip()
            if not vendor:
                continue
            date = _parse_date(row.get("date") or row.get("detected_at") or "")
            if not date:
                continue
            # Focus on roughly last 12 months of activity
            if (TODAY - date).days > 365:
                continue
            row["_date"] = date
            row["_vendor_norm"] = vendor.lower()
            out.append(row)
    return out

def load_targets() -> List[Dict[str, str]]:
    if not TARGETS_CSV.exists():
        print("[outreach] outreach_targets.csv not found, nothing to do")
        return []
    out: List[Dict[str, str]] = []
    with TARGETS_CSV.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            company = (row.get("company") or "").strip()
            email = (row.get("email") or "").strip()
            if not company or not email:
                continue
            vendors_raw = (row.get("vendors") or "").strip()
            vendors = [v.strip().lower() for v in vendors_raw.split(";") if v.strip()]
            row["_vendors"] = vendors
            out.append(row)
    return out

def _sanitize_slug(text: str) -> str:
    keep = []
    for ch in text.lower():
        if ch.isalnum():
            keep.append(ch)
        elif ch in (" ", "-", "_", "."):
            keep.append("-")
    slug = "".join(keep).strip("-")
    return slug or "company"

def build_draft(company: str, contact_name: str, email: str, vendors: List[str], events: List[Dict[str, str]]) -> str:
    if not vendors:
        vendor_line = "your key SaaS vendors"
    elif len(vendors) == 1:
        vendor_line = vendors[0]
    elif len(vendors) == 2:
        vendor_line = f"{vendors[0]} and {vendors[1]}"
    else:
        vendor_line = ", ".join(vendors[:2]) + f" and {len(vendors) - 2} others"

    relevant = [
        ev for ev in events
        if any(v in (ev.get("_vendor_norm") or "") for v in vendors)
    ]
    # Sort newest first and keep a small, readable sample
    relevant.sort(key=lambda ev: ev["_date"], reverse=True)
    sample = relevant[:5]

    lines: List[str] = []
    greeting_name = contact_name or "there"
    lines.append(f"Hi {greeting_name},")
    lines.append("")
    lines.append(f"I’m reaching out because it looks like your team relies on {vendor_line}.")
    if sample:
        lines.append("Over the last 12 months we’ve seen a number of public changes across pricing, DPAs and terms for these vendors. A few examples:")
        lines.append("")
        for ev in sample:
            date = ev["_date"].isoformat()
            vendor = ev.get("vendor") or ev.get("domain") or ""
            change = ev.get("change") or ev.get("title") or ev.get("summary") or ""
            impact = ev.get("impact") or ev.get("why_it_matters") or ""
            parts = [p for p in [change.strip(), impact.strip()] if p]
            bullet = " — ".join(parts) if parts else change.strip()
            if not bullet:
                bullet = "Public change detected on a key policy or pricing page."
            lines.append(f"- {date} — {vendor}: {bullet}")
    else:
        lines.append("We track public pricing, DPA, terms and privacy changes for the SaaS vendors you rely on.")
    lines.append("")
    lines.append("CG Alert turns those raw changes into renewal-ready evidence for security, legal and procurement teams — with a strict 14‑day delay before anything is made public.")
    lines.append("")
    lines.append("If you’d like to pressure-test your upcoming renewals, you can:")
    lines.append("- Start a self-serve subscription via Stripe: https://www.cg-alert.com/pricing/")
    lines.append("- Browse the latest sample evidence board: https://www.cg-alert.com/reports/latest.html")
    lines.append("")
    lines.append("No demos or sales calls are required; everything is designed to be self-serve.")
    lines.append("")
    lines.append("Best regards,")
    lines.append("{{YOUR_NAME_HERE}}")
    lines.append("")
    lines.append(f"(Prepared for {company} — target contact {email})")
    return "\n".join(lines)

def main():
    events = load_events()
    targets = load_targets()
    if not targets:
        return
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"[outreach] Loaded {len(events)} recent events and {len(targets)} outreach targets")

    for row in targets:
        company = (row.get("company") or "").strip()
        email = (row.get("email") or "").strip()
        contact_name = (row.get("contact_name") or "").strip()
        vendors = row.get("_vendors") or []
        slug = _sanitize_slug(company)
        draft_path = OUT_DIR / f"{slug}.txt"
        draft = build_draft(company, contact_name, email, vendors, events)
        draft_path.write_text(draft, encoding="utf-8")
        print(f"[outreach] wrote {draft_path.relative_to(ROOT)}")

if __name__ == "__main__":
    main()
