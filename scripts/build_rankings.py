
#!/usr/bin/env python3
"""
Build simple ranking pages from data/events.csv.

Outputs under /reports/rankings/:

- index.html
- change-volume-last-12-months.html
- high-severity-last-12-months.html

These pages are fully static and safe to run in CI.
"""

from __future__ import annotations
import csv
import html
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import List, Dict, Tuple

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REPORTS = ROOT / "reports"

EVENTS_CSV = DATA / "events.csv"


def parse_date(s: str) -> datetime:
    s = (s or "").strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(s, fmt)
        except Exception:
            continue
    if len(s) >= 10:
        try:
            return datetime.strptime(s[:10], "%Y-%m-%d")
        except Exception:
            pass
    return datetime(1970, 1, 1)


def html_escape(s: str) -> str:
    return html.escape(s or "", quote=True)


def safe_slug(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-") or "vendor"


def load_site_chrome() -> Dict[str, str]:
    base_html = (REPORTS / "index.html").read_text(encoding="utf-8")
    csp_match = re.search(
        r'<meta http-equiv="Content-Security-Policy"[^>]*?>',
        base_html,
        re.S,
    )
    csp_meta = csp_match.group(0) if csp_match else ""
    style_block = ""
    m_style = re.search(r'<style id="no-underline-patch">.*?</style>', base_html, re.S)
    if m_style:
        style_block = m_style.group(0)
    org_block = ""
    m_org = re.search(r'<script type="application/ld\+json">.*?</script>', base_html, re.S)
    if m_org:
        org_block = m_org.group(0)
    header = ""
    m_header = re.search(r'<header class="cg-topbar">.*?</header>', base_html, re.S)
    if m_header:
        header = m_header.group(0)
    footer = ""
    m_footer = re.search(r'<footer class="cg-footer">.*?</footer>', base_html, re.S)
    if m_footer:
        footer = m_footer.group(0)
    return {
        "csp_meta": csp_meta,
        "style_block": style_block,
        "org_block": org_block,
        "header": header,
        "footer": footer,
    }


def page_shell(title: str, description: str, canonical: str, chrome: Dict[str, str], body_html: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="en"><head>
<meta content="https://api.cg-alert.com" name="worker-url"/>
<meta charset="utf-8"/>
<meta content="width=device-width,initial-scale=1" name="viewport"/>
<title>{html_escape(title)}</title>
<link href="/icon.svg" rel="icon" type="image/svg+xml"/>
<link href="{html_escape(canonical)}" rel="canonical">
<link href="/assets/home-v3c.css?v=cb1" rel="stylesheet"/>
<meta name="description" content="{html_escape(description)}">
{chrome.get("csp_meta","")}
{chrome.get("style_block","")}
{chrome.get("org_block","")}
</head><body>
{chrome.get("header","")}
{body_html}
{chrome.get("footer","")}
<script src="/assets/home-v3c.js"></script>
</body></html>
"""


@dataclass
class Event:
    date: datetime
    vendor: str
    severity: str


def load_recent_events(days: int = 365) -> List[Event]:
    if not EVENTS_CSV.exists():
        return []
    now = datetime.utcnow()
    cutoff = now - timedelta(days=days)
    rows: List[Event] = []
    with EVENTS_CSV.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            vendor = (r.get("vendor") or "").strip()
            if not vendor:
                continue
            date = parse_date(r.get("date") or r.get("captured_at") or "")
            if date < cutoff:
                continue
            severity = (r.get("severity") or "").strip().lower()
            rows.append(Event(
                date=date,
                vendor=vendor,
                severity=severity,
            ))
    return rows


def aggregate(events: List[Event]) -> List[Tuple[str, str, int, int]]:
    # vendor, slug, total_count, high_count
    by_vendor: Dict[str, Dict[str, int]] = {}
    for e in events:
        v = e.vendor
        b = by_vendor.setdefault(v, {"total": 0, "high": 0})
        b["total"] += 1
        if e.severity in ("high", "critical"):
            b["high"] += 1
    rows: List[Tuple[str, str, int, int]] = []
    for vendor, counts in by_vendor.items():
        slug = safe_slug(vendor)
        rows.append((vendor, slug, counts["total"], counts["high"]))
    # sort by total events desc, then high desc
    rows.sort(key=lambda t: (t[2], t[3]), reverse=True)
    return rows


def build_index(chrome: Dict[str, str]) -> None:
    out_dir = REPORTS / "rankings"
    out_dir.mkdir(parents=True, exist_ok=True)
    body = """
<main class="cg-wrap" style="padding-top:28px">
  <h1 style="font-weight:900;margin:0 0 10px">Vendor change rankings</h1>
  <p class="cg-sub">
    These programmatic rankings are generated from the same canonical event feed used for
    /reports/latest.html. They are designed to give a coarse view of which SaaS vendors are
    changing pricing, terms and DPAs most often.
  </p>
  <ul class="cg-list">
    <li class="cg-list-item">
      <h2 class="cg-list-title"><a href="/reports/rankings/change-volume-last-12-months.html">Top vendors by change volume (last 12&nbsp;months)</a></h2>
      <p class="cg-subtle">Vendors ranked by total number of tracked public changes over the last 12 months.</p>
    </li>
    <li class="cg-list-item">
      <h2 class="cg-list-title"><a href="/reports/rankings/high-severity-last-12-months.html">Top vendors by high‑severity changes (last 12&nbsp;months)</a></h2>
      <p class="cg-subtle">Vendors ranked by number of changes classified as high or critical severity over the last 12 months.</p>
    </li>
  </ul>
  <p class="cg-note">
    Want evidence for your own vendor list instead of generic rankings?
    Start with the <a href="/reports/latest.html">Latest SaaS vendor change evidence</a>
    or compare plans on the <a href="/pricing/">pricing</a> page.
  </p>
</main>
"""
    html_out = page_shell(
        title="Vendor change rankings — CG Alert",
        description="Programmatic rankings of SaaS vendors by change volume and severity over the last 12 months.",
        canonical="https://www.cg-alert.com/reports/rankings/",
        chrome=chrome,
        body_html=body,
    )
    (out_dir / "index.html").write_text(html_out, encoding="utf-8")
    print(f"[build_rankings] Wrote {out_dir/'index.html'}.")


def build_volume_page(rows: List[Tuple[str, str, int, int]], chrome: Dict[str, str]) -> None:
    out_dir = REPORTS / "rankings"
    out_dir.mkdir(parents=True, exist_ok=True)
    top = rows[:50]
    rows_html = []
    for idx, (vendor, slug, total, high) in enumerate(top, start=1):
        vendor_url = f"/reports/vendors/{slug}/"
        rows_html.append(
            f"""<tr>
  <td>{idx}</td>
  <td><a href="{html_escape(vendor_url)}">{html_escape(vendor)}</a></td>
  <td>{total}</td>
  <td>{high}</td>
</tr>"""
        )
    body = f"""
<main class="cg-wrap" style="padding-top:28px">
  <h1 style="font-weight:900;margin:0 0 10px">Top vendors by change volume (last 12 months)</h1>
  <p class="cg-sub">
    Vendors ranked by total number of tracked public changes over the last 12 months, based on CG Alert&apos;s
    canonical event feed. High-severity changes are shown separately.
  </p>
  <div class="cg-table-wrap">
    <table class="cg-table">
      <thead>
        <tr><th>Rank</th><th>Vendor</th><th>Changes (12m)</th><th>High-severity</th></tr>
      </thead>
      <tbody>
        {''.join(rows_html)}
      </tbody>
    </table>
  </div>
  <p class="cg-note">
    Rankings are coarse by design. Real customer boards are filtered to your vendor list and contracts.
  </p>
</main>
"""
    html_out = page_shell(
        title="Top vendors by change volume (last 12 months) — CG Alert",
        description="SaaS vendors ranked by number of tracked public changes over the last 12 months.",
        canonical="https://www.cg-alert.com/reports/rankings/change-volume-last-12-months.html",
        chrome=chrome,
        body_html=body,
    )
    (out_dir / "change-volume-last-12-months.html").write_text(html_out, encoding="utf-8")
    print(f"[build_rankings] Wrote {out_dir/'change-volume-last-12-months.html'}.")


def build_high_sev_page(rows: List[Tuple[str, str, int, int]], chrome: Dict[str, str]) -> None:
    out_dir = REPORTS / "rankings"
    out_dir.mkdir(parents=True, exist_ok=True)
    # sort by high desc, then total desc
    rows_sorted = sorted(rows, key=lambda t: (t[3], t[2]), reverse=True)
    top = rows_sorted[:50]
    rows_html = []
    for idx, (vendor, slug, total, high) in enumerate(top, start=1):
        vendor_url = f"/reports/vendors/{slug}/"
        rows_html.append(
            f"""<tr>
  <td>{idx}</td>
  <td><a href="{html_escape(vendor_url)}">{html_escape(vendor)}</a></td>
  <td>{high}</td>
  <td>{total}</td>
</tr>"""
        )
    body = f"""
<main class="cg-wrap" style="padding-top:28px">
  <h1 style="font-weight:900;margin:0 0 10px">Top vendors by high‑severity changes (last 12 months)</h1>
  <p class="cg-sub">
    Vendors ranked by number of changes classified as high or critical severity over the last 12 months.
  </p>
  <div class="cg-table-wrap">
    <table class="cg-table">
      <thead>
        <tr><th>Rank</th><th>Vendor</th><th>High-severity changes</th><th>All changes (12m)</th></tr>
      </thead>
      <tbody>
        {''.join(rows_html)}
      </tbody>
    </table>
  </div>
  <p class="cg-note">
    This view is meant to highlight vendors with frequent, material changes — not to make absolute risk claims.
  </p>
</main>
"""
    html_out = page_shell(
        title="Top vendors by high-severity changes (last 12 months) — CG Alert",
        description="SaaS vendors ranked by number of high- or critical-severity changes over the last 12 months.",
        canonical="https://www.cg-alert.com/reports/rankings/high-severity-last-12-months.html",
        chrome=chrome,
        body_html=body,
    )
    (out_dir / "high-severity-last-12-months.html").write_text(html_out, encoding="utf-8")
    print(f"[build_rankings] Wrote {out_dir/'high-severity-last-12-months.html'}.")


def main() -> None:
    events = load_recent_events(days=365)
    chrome = load_site_chrome()
    summary = aggregate(events)
    build_index(chrome)
    if summary:
        build_volume_page(summary, chrome)
        build_high_sev_page(summary, chrome)
    else:
        print("[build_rankings] No recent events; wrote index only.")


if __name__ == "__main__":
    main()
