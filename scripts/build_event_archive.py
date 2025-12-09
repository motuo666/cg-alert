
#!/usr/bin/env python3
"""
Build a simple, SEO-friendly event archive page from data/events.csv.

Output:
- /reports/events/index.html

This page is fully static and safe to run in CI; it only reads events.csv.
"""

from __future__ import annotations
import csv
import html
import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List, Dict

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REPORTS = ROOT / "reports"
CONFIG = ROOT / "config"
FEEDS_JSON = CONFIG / "feeds.json"

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


def html_escape(s: str) -> str:
    return html.escape(s or "", quote=True)


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
    url: str
    title: str
    impact: str
    severity: str
    category: str


def load_events() -> List[Event]:
    if not EVENTS_CSV.exists():
        return []
    rows: List[Event] = []
    with EVENTS_CSV.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            vendor = (r.get("vendor") or "").strip()
            if not vendor:
                continue
            date = parse_date(r.get("date") or r.get("captured_at") or "")
            url = (r.get("url") or "").strip()
            title = (r.get("title") or r.get("change") or "").strip()
            impact = (r.get("impact") or "").strip()
            severity = (r.get("severity") or "").strip()
            category = classify_category(url, title)
            rows.append(Event(
                date=date,
                vendor=vendor,
                url=url,
                title=title,
                impact=impact,
                severity=severity,
                category=category,
            ))
    rows.sort(key=lambda e: e.date, reverse=True)
    return rows


def build_archive(events: List[Event], chrome: Dict[str, str]) -> None:
    out_dir = REPORTS / "events"
    out_dir.mkdir(parents=True, exist_ok=True)

    rows_html = []
    for e in events:
        date_str = e.date.date().isoformat()
        badges = []
        if e.category:
            badges.append(e.category)
        if e.severity:
            badges.append(e.severity)
        badge_html = ""
        if badges:
            badge_html = '<span class="cg-badges">' + " ".join(
                f'<span class="cg-badge">{html_escape(b)}</span>' for b in badges
            ) + "</span>"
        snippet = e.impact or e.title
        rows_html.append(
            f"""<tr>
  <td><time datetime="{html_escape(date_str)}">{html_escape(date_str)}</time></td>
  <td>{html_escape(e.vendor)}</td>
  <td>{badge_html}</td>
  <td><a href="{html_escape(e.url)}" rel="noopener noreferrer">{html_escape(e.title or e.url)}</a></td>
  <td class="cg-subtle">{html_escape(snippet)}</td>
</tr>"""
        )

    body = f"""
<main class="cg-wrap" style="padding-top:28px">
  <h1 style="font-weight:900;margin:0 0 10px">SaaS vendor change events archive</h1>
  <p class="cg-sub">
    This page shows the canonical event feed CG Alert uses internally: each row is a public change
    to SaaS pricing, terms, DPAs, privacy policies, subprocessors or status pages.
  </p>
  <p class="cg-note">
    Looking for a board-style view instead? See
    <a href="/reports/latest.html">Latest SaaS vendor change evidence</a>,
    or browse by <a href="/reports/vendors/">vendor</a> and <a href="/reports/topics/">topic</a>.
  </p>
  <div class="cg-table-wrap">
    <table class="cg-table">
      <thead>
        <tr><th>Date</th><th>Vendor</th><th>Type</th><th>Change</th><th>Why it matters</th></tr>
      </thead>
      <tbody>
        {''.join(rows_html)}
      </tbody>
    </table>
  </div>
</main>
"""
    html_out = page_shell(
        title="SaaS vendor change events archive — CG Alert",
        description="Canonical archive of SaaS vendor change events used by CG Alert: pricing, terms, DPA, privacy, subprocessors and status pages.",
        canonical="https://www.cg-alert.com/reports/events/",
        chrome=chrome,
        body_html=body,
    )
    (out_dir / "index.html").write_text(html_out, encoding="utf-8")
    print(f"[build_event_archive] Wrote {out_dir/'index.html'} ({len(events)} events).")



def load_public_config() -> Dict[str, object]:
    try:
        with FEEDS_JSON.open("r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception:
        cfg = {}
    if not isinstance(cfg, dict):
        return {}
    return cfg


def filter_public_events(events: List[Event], cfg: Dict[str, object]) -> List[Event]:
    public_vendors = set((cfg or {}).get("public_vendors", []) or [])
    try:
        min_age = int((cfg or {}).get("public_min_age_days", 14))
    except Exception:
        min_age = 14
    today = datetime.utcnow().date()
    out: List[Event] = []
    for e in events:
        age = (today - e.date.date()).days
        if age < min_age:
            continue
        if public_vendors and e.vendor not in public_vendors:
            continue
        out.append(e)
    return out


def load_public_events() -> List[Event]:
    events = load_public_events()
    cfg = load_public_config()
    return filter_public_events(events, cfg)


def main() -> None:
    events = load_events()
    chrome = load_site_chrome()
    build_archive(events, chrome)


if __name__ == "__main__":
    main()
