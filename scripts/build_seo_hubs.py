
#!/usr/bin/env python3
"""
Build SEO-oriented content hubs from data/events.csv:

- Vendor library: /reports/vendors/index.html + /reports/vendors/{vendor_slug}/index.html
- Topic library: /reports/topics/index.html + /reports/topics/{topic_slug}/index.html
- Public sample digests: /reports/digests/this-week.html + /reports/digests/this-month.html

The goal is to reuse existing site chrome (topbar/footer/CSP/Org JSON-LD) and
keep everything deterministic so it is safe to run from CI.
"""

import csv
import html
import json
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Iterable, Tuple
import re

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
REPORTS = ROOT / "reports"
CONFIG = ROOT / "config"
FEEDS_JSON = CONFIG / "feeds.json"

EVENTS_CSV = DATA / "events.csv"
VENDOR_PRIORITY_CSV = DATA / "vendor_priority.csv"

# Simple date util
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
    """Very simple heuristic category, aligned with build_events_canonical."""
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


def safe_slug(s: str) -> str:
    s = (s or "").lower()
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-") or "vendor"


def html_escape(s: str) -> str:
    return html.escape(s or "", quote=True)


@dataclass
class Event:
    vendor: str
    date: datetime
    url: str
    title: str
    change: str
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
            change = (r.get("change") or "").strip()
            impact = (r.get("impact") or "").strip()
            severity = (r.get("severity") or "").strip()
            cat = classify_category(url, change or title)
            rows.append(Event(
                vendor=vendor,
                date=date,
                url=url,
                title=title,
                change=change,
                impact=impact,
                severity=severity,
                category=cat,
            ))
    # newest first
    rows.sort(key=lambda e: e.date, reverse=True)
    return rows


def load_vendor_scores() -> Dict[str, float]:
    scores: Dict[str, float] = {}
    if not VENDOR_PRIORITY_CSV.exists():
        return scores
    with VENDOR_PRIORITY_CSV.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            v = (r.get("vendor") or "").strip().lower()
            if not v:
                continue
            try:
                scores[v] = float(r.get("score") or "0")
            except ValueError:
                continue
    return scores


# --- Template helpers: reuse nav/footer/CSP from existing reports index ---

def extract_block(src: str, pattern: str) -> str:
    m = re.search(pattern, src, re.S)
    return m.group(0) if m else ""


def load_site_chrome() -> Dict[str, str]:
    base_html = (REPORTS / "index.html").read_text(encoding="utf-8")
    # CSP meta
    csp_match = re.search(
        r'<meta http-equiv="Content-Security-Policy"[^>]*?>',
        base_html,
        re.S,
    )
    csp_meta = csp_match.group(0) if csp_match else ""
    # no-underline style (if present)
    style_block = extract_block(base_html, r'<style id="no-underline-patch">.*?</style>')
    # Organization JSON-LD (optional)
    org_block = extract_block(
        base_html,
        r'<script type="application/ld\+json">.*?</script>',
    )
    # header/footer
    header = extract_block(base_html, r'<header class="cg-topbar">.*?</header>')
    footer = extract_block(base_html, r'<footer class="cg-footer">.*?</footer>')
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


# --- Vendor library ---

def build_vendor_library(events: List[Event], vendor_scores: Dict[str, float], chrome: Dict[str, str]) -> None:
    if not events:
        return
    # group by vendor
    by_vendor: Dict[str, List[Event]] = {}
    for ev in events:
        by_vendor.setdefault(ev.vendor, []).append(ev)

    # summarise vendors
    vendors_summary: List[Tuple[str, str, int, int, List[str]]] = []
    for vendor, evs in by_vendor.items():
        if not evs:
            continue
        evs_sorted = sorted(evs, key=lambda e: e.date, reverse=True)
        cat_counts: Dict[str, int] = {}
        for e in evs:
            cat_counts[e.category] = cat_counts.get(e.category, 0) + 1
        top_cats = sorted(cat_counts.items(), key=lambda t: t[1], reverse=True)
        top_cat_labels = [c for c, _ in top_cats[:3]]
        score = vendor_scores.get(vendor.lower(), 0.0)
        vendors_summary.append(
            (vendor, safe_slug(vendor), len(evs), int(score), top_cat_labels)
        )

    # sort vendors by score desc then event count
    vendors_summary.sort(key=lambda t: (t[3], t[2]), reverse=True)

    # ensure output dirs
    vendors_root = REPORTS / "vendors"
    vendors_root.mkdir(parents=True, exist_ok=True)

    # index page
    index_rows = []
    for vendor, slug, count, score, cats in vendors_summary:
        cats_str = ", ".join(cats) if cats else "Mixed"
        index_rows.append(
            f"""<tr>
  <td><a href="/reports/vendors/{html_escape(slug)}/">{html_escape(vendor)}</a></td>
  <td>{count}</td>
  <td>{cats_str}</td>
  <td>{score or ""}</td>
</tr>"""
        )
    index_body = f"""
<main class="cg-wrap" style="padding-top:28px">
  <h1 style="font-weight:900;margin:0 0 10px">Vendor change library</h1>
  <p class="cg-subtle">
    This page lists SaaS vendors where CG Alert has detected recent public changes to pricing, terms, DPAs,
    privacy policies, subprocessors or status pages. Each vendor page below is a small change log built from
    the same evidence-backed feed we use internally.
  </p>
  <p class="cg-note">
    Looking for a live-style board of cross-vendor change evidence?
    See <a href="/reports/latest.html">Latest SaaS vendor change evidence</a> or
    the <a href="/reports/">SaaS vendor change reports hub</a>.
  </p>
  <div class="cg-table-wrap">
    <table class="cg-table">
      <thead>
        <tr><th>Vendor</th><th>Tracked changes</th><th>Focus areas</th><th>Priority score</th></tr>
      </thead>
      <tbody>
        {''.join(index_rows)}
      </tbody>
    </table>
  </div>
</main>
"""
    idx_html = page_shell(
        title="Vendor change library — CG Alert",
        description="Browse SaaS vendors where CG Alert tracks pricing, terms, DPA, privacy, subprocessor and status changes.",
        canonical="https://www.cg-alert.com/reports/vendors/",
        chrome=chrome,
        body_html=index_body,
    )
    (vendors_root / "index.html").write_text(idx_html, encoding="utf-8")

    # per-vendor pages
    for vendor, slug, count, score, cats in vendors_summary:
        evs = sorted(by_vendor[vendor], key=lambda e: e.date, reverse=True)
        if not evs:
            continue
        first_date = evs[-1].date.date().isoformat()
        last_date = evs[0].date.date().isoformat()
        cats_str = ", ".join(sorted({e.category for e in evs}))
        rows_html = []
        for e in evs:
            date_str = e.date.date().isoformat()
            sev = e.severity or ""
            badges = []
            if e.category:
                badges.append(e.category)
            if sev:
                badges.append(sev)
            badge_html = ""
            if badges:
                badge_html = '<span class="cg-badges">' + " ".join(
                    f'<span class="cg-badge">{html_escape(b)}</span>' for b in badges
                ) + "</span>"
            snippet = e.impact or e.change or e.title
            rows_html.append(
                f"""<li class="cg-list-item">
  <div class="cg-list-title">
    <time datetime="{html_escape(date_str)}">{html_escape(date_str)}</time>
    {badge_html}
  </div>
  <p><a href="{html_escape(e.url)}" rel="noopener noreferrer">{html_escape(e.title or e.change or e.url)}</a></p>
  <p class="cg-subtle">{html_escape(snippet)}</p>
</li>"""
            )
        body = f"""
<main class="cg-wrap" style="padding-top:28px">
  <h1 style="font-weight:900;margin:0 0 10px">{html_escape(vendor)} SaaS vendor change log</h1>
  <p class="cg-sub">
    This page shows public contract, pricing, DPA, privacy, subprocessor and status changes CG Alert has observed for
    <b>{html_escape(vendor)}</b>. It is built from the same evidence-backed feed used for renewal, audit and vendor risk work.
  </p>
  <p class="cg-note">
    Coverage window: {html_escape(first_date)} → {html_escape(last_date)} · Tracked changes: {len(evs)} · Focus areas: {html_escape(cats_str)}.
  </p>
  <ul class="cg-list">
    {''.join(rows_html)}
  </ul>
  <hr class="cg-hr"/>
  <p class="cg-note">
    Want this board filtered to <b>your</b> vendors and contracts?
    See <a href="/reports/latest.html">Latest SaaS vendor change evidence</a> or
    <a href="/pricing/">compare plans</a>, then use the <a href="/intake/">vendor intake form</a> after checkout.
  </p>
</main>
"""
        html_out = page_shell(
            title=f"{vendor} SaaS vendor change log — CG Alert",
            description=f"Public change log for {vendor}: pricing, terms, DPA, privacy, subprocessors and status changes observed by CG Alert.",
            canonical=f"https://www.cg-alert.com/reports/vendors/{slug}/",
            chrome=chrome,
            body_html=body,
        )
        out_dir = vendors_root / slug
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "index.html").write_text(html_out, encoding="utf-8")


# --- Topic library ---

@dataclass
class Topic:
    slug: str
    name: str
    description: str
    seo_description: str
    match_categories: List[str]
    keyword_any: List[str]


TOPICS: List[Topic] = [
    Topic(
        slug="dpa-changes",
        name="SaaS DPA change tracker",
        description="Recent changes to data processing agreements (DPAs) across SaaS vendors.",
        seo_description="See recent SaaS DPA changes across vendors: new subprocessors, data residency shifts and transfer clauses.",
        match_categories=["DPA"],
        keyword_any=[],
    ),
    Topic(
        slug="pricing-changes",
        name="SaaS pricing change tracker",
        description="Pricing, plan and packaging changes that affect renewals and margins.",
        seo_description="Monitor SaaS vendor pricing changes: plan uplifts, packaging shifts and discount structures.",
        match_categories=["Pricing"],
        keyword_any=["price", "pricing", "plan", "plans", "billing"],
    ),
    Topic(
        slug="tos-changes",
        name="SaaS terms of service change tracker",
        description="Terms of service changes that impact contractual risk and obligations.",
        seo_description="Track SaaS terms of service changes that affect liability caps, SLAs and contractual risk.",
        match_categories=["ToS"],
        keyword_any=["terms", "sla"],
    ),
    Topic(
        slug="privacy-changes",
        name="SaaS privacy policy change tracker",
        description="Privacy policy and data use changes relevant to compliance and trust.",
        seo_description="See SaaS privacy policy changes and data use updates across vendors.",
        match_categories=["Privacy"],
        keyword_any=["privacy"],
    ),
    Topic(
        slug="subprocessor-updates",
        name="Subprocessor and vendor register updates",
        description="New subprocessors, transfers and region changes affecting vendor risk.",
        seo_description="Monitor SaaS subprocessor list updates and data transfer changes.",
        match_categories=["Subprocessors"],
        keyword_any=["subprocessor", "sub-processors"],
    ),
    Topic(
        slug="status-and-sla",
        name="Status and SLA changes",
        description="Status page and SLA wording changes that influence reliability commitments.",
        seo_description="Track SaaS status and SLA wording changes that impact reliability guarantees.",
        match_categories=["Status"],
        keyword_any=["status", "sla"],
    ),
    Topic(
        slug="ai-training-clauses",
        name="AI training and data use clauses",
        description="Changes that mention AI training, model use and customer data in AI systems.",
        seo_description="See SaaS contract and policy changes that mention AI training and customer data use.",
        match_categories=[],
        keyword_any=[" ai ", "artificial intelligence", "training data", "model training"],
    ),
]


def matches_topic(ev: Event, topic: Topic) -> bool:
    if topic.match_categories and ev.category in topic.match_categories:
        return True
    text = f"{ev.title} {ev.change} {ev.impact}".lower()
    for kw in topic.keyword_any:
        if kw.strip().lower() in text:
            return True
    return False


def build_topic_library(events: List[Event], chrome: Dict[str, str]) -> None:
    if not events:
        return
    topics_root = REPORTS / "topics"
    topics_root.mkdir(parents=True, exist_ok=True)

    # per-topic selection
    topic_events: Dict[str, List[Event]] = {t.slug: [] for t in TOPICS}
    for ev in events:
        for t in TOPICS:
            if matches_topic(ev, t):
                topic_events[t.slug].append(ev)

    # topic index
    cards_html = []
    for t in TOPICS:
        evs = sorted(topic_events[t.slug], key=lambda e: e.date, reverse=True)
        count = len(evs)
        if not count:
            # Still render, but with "no recent events" note
            detail = "No recent events in the current window."
        else:
            latest = evs[0]
            detail = f"{count} tracked changes; latest from {latest.date.date().isoformat()} ({html_escape(latest.vendor)})."
        cards_html.append(
            f"""<div class="cg-card hover">
  <h3>{html_escape(t.name)}</h3>
  <p class="cg-subtle">{html_escape(t.description)}</p>
  <p class="cg-note">{detail}</p>
  <p><a class="cg-btn ghost" href="/reports/topics/{html_escape(t.slug)}/">View change log →</a></p>
</div>"""
        )
    index_body = f"""
<main class="cg-wrap" style="padding-top:28px">
  <h1 style="font-weight:900;margin:0 0 10px">Vendor change topics</h1>
  <p class="cg-sub">
    Browse SaaS contract and policy changes by topic — DPA, pricing, terms, privacy, subprocessors, status/SLA and AI clauses.
    Each topic page below is built from the same event feed used for /reports/latest.html.
  </p>
  <div class="cg-grid3">
    {''.join(cards_html)}
  </div>
  <p class="cg-note">
    Want a cross-vendor board instead? See <a href="/reports/latest.html">Latest SaaS vendor change evidence</a>.
  </p>
</main>
"""
    idx_html = page_shell(
        title="Vendor change topics — CG Alert",
        description="See SaaS vendor changes grouped by topic: DPA, pricing, terms, privacy, subprocessors, status/SLA and AI clauses.",
        canonical="https://www.cg-alert.com/reports/topics/",
        chrome=chrome,
        body_html=index_body,
    )
    (topics_root / "index.html").write_text(idx_html, encoding="utf-8")

    # per-topic pages
    for t in TOPICS:
        evs = sorted(topic_events[t.slug], key=lambda e: e.date, reverse=True)
        if not evs:
            body = f"""
<main class="cg-wrap" style="padding-top:28px">
  <h1 style="font-weight:900;margin:0 0 10px">{html_escape(t.name)}</h1>
  <p class="cg-sub">{html_escape(t.description)}</p>
  <p class="cg-note">No recent events matched this topic in the current events feed.</p>
</main>
"""
        else:
            items_html = []
            for e in evs:
                date_str = e.date.date().isoformat()
                snippet = e.impact or e.change or e.title
                items_html.append(
                    f"""<li class="cg-list-item">
  <div class="cg-list-title">
    <time datetime="{html_escape(date_str)}">{html_escape(date_str)}</time>
    <span class="cg-badges"><span class="cg-badge">{html_escape(e.category)}</span></span>
  </div>
  <p><a href="{html_escape(e.url)}" rel="noopener noreferrer">{html_escape(e.title or e.change or e.url)}</a></p>
  <p class="cg-subtle">{html_escape(snippet)}</p>
  <p class="cg-note">Vendor: {html_escape(e.vendor)}</p>
</li>"""
                )
            body = f"""
<main class="cg-wrap" style="padding-top:28px">
  <h1 style="font-weight:900;margin:0 0 10px">{html_escape(t.name)}</h1>
  <p class="cg-sub">{html_escape(t.description)}</p>
  <ul class="cg-list">
    {''.join(items_html)}
  </ul>
  <hr class="cg-hr"/>
  <p class="cg-note">
    Want these changes filtered to your vendor list and renewals?
    See <a href="/reports/latest.html">Latest SaaS vendor change evidence</a> or <a href="/pricing/">compare plans</a>.
  </p>
</main>
"""
        html_out = page_shell(
            title=f"{t.name} — CG Alert",
            description=t.seo_description,
            canonical=f"https://www.cg-alert.com/reports/topics/{t.slug}/",
            chrome=chrome,
            body_html=body,
        )
        out_dir = topics_root / t.slug
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "index.html").write_text(html_out, encoding="utf-8")


# --- Sample digests ---

def select_recent(events: List[Event], days: int) -> List[Event]:
    if not events:
        return []
    now = datetime.utcnow()
    cutoff = now - timedelta(days=days)
    return [e for e in events if e.date >= cutoff]


def build_sample_digests(events: List[Event], chrome: Dict[str, str]) -> None:
    dig_root = REPORTS / "digests"
    dig_root.mkdir(parents=True, exist_ok=True)

    for label, days, slug in [
        ("weekly", 7, "this-week"),
        ("monthly", 30, "this-month"),
    ]:
        evs = select_recent(events, days)
        evs = sorted(evs, key=lambda e: e.date, reverse=True)[:40]
        if not evs:
            body = f"""
<main class="cg-wrap" style="padding-top:28px">
  <h1 style="font-weight:900;margin:0 0 10px">Sample {label} digest</h1>
  <p class="cg-sub">No recent events in the current window — once pollers start capturing live vendor changes, this page will show a public-style digest.</p>
</main>
"""
        else:
            # group by vendor
            by_vendor: Dict[str, List[Event]] = {}
            for e in evs:
                by_vendor.setdefault(e.vendor, []).append(e)
            sections = []
            for vendor, v_events in sorted(by_vendor.items()):
                items_html = []
                for e in sorted(v_events, key=lambda x: x.date, reverse=True):
                    date_str = e.date.date().isoformat()
                    snippet = e.impact or e.change or e.title
                    items_html.append(
                        f"""<li class="cg-list-item">
  <div class="cg-list-title">
    <time datetime="{html_escape(date_str)}">{html_escape(date_str)}</time>
    <span class="cg-badges"><span class="cg-badge">{html_escape(e.category)}</span></span>
  </div>
  <p><a href="{html_escape(e.url)}" rel="noopener noreferrer">{html_escape(e.title or e.change or e.url)}</a></p>
  <p class="cg-subtle">{html_escape(snippet)}</p>
</li>"""
                    )
                sections.append(
                    f"""<section class="cg-preview">
  <div class="cg-wrap">
    <h2>{html_escape(vendor)}</h2>
    <ul class="cg-list">
      {''.join(items_html)}
    </ul>
  </div>
</section>"""
                )
            body = f"""
<main>
  <section class="cg-hero cg-hero-narrow">
    <div class="cg-wrap">
      <h1>Recent SaaS vendor changes — sample {label} digest</h1>
      <p class="cg-sub">
        This page shows a public-style digest generated from the same event feed as /reports/latest.html.
        Real customer digests are private, filtered to your vendors and contracts, and may include internal
        commentary and escalation language.
      </p>
      <p class="cg-note">
        Public demo only — no customer-specific data. When you&apos;re ready to wire real delivery,
        you&apos;ll point your Cloudflare Worker or email system at the digest outputs instead.
      </p>
      <div class="cg-cta">
        <a class="cg-btn" href="/pricing/">Compare plans</a>
        <a class="cg-btn ghost" href="/reports/latest.html">See latest evidence</a>
      </div>
    </div>
  </section>
  {''.join(sections)}
</main>
"""
        title = f"Recent SaaS vendor changes — sample {label} digest · CG Alert"
        desc = f"Sample {label} digest of SaaS vendor changes generated from CG Alert&apos;s events feed."
        canonical = f"https://www.cg-alert.com/reports/digests/{slug}.html"
        html_out = page_shell(
            title=title,
            description=desc,
            canonical=canonical,
            chrome=chrome,
            body_html=body,
        )
        (dig_root / f"{slug}.html").write_text(html_out, encoding="utf-8")



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
    events = load_events()
    cfg = load_public_config()
    return filter_public_events(events, cfg)


def main() -> None:
    events = load_public_events()
    vendor_scores = load_vendor_scores()
    chrome = load_site_chrome()
    if not events:
        print("[build_seo_hubs] No events.csv found or empty; still ensuring directories exist.")
        (REPORTS / "vendors").mkdir(parents=True, exist_ok=True)
        (REPORTS / "topics").mkdir(parents=True, exist_ok=True)
        (REPORTS / "digests").mkdir(parents=True, exist_ok=True)
        return
    build_vendor_library(events, vendor_scores, chrome)
    build_topic_library(events, chrome)
    build_sample_digests(events, chrome)
    print("[build_seo_hubs] Updated vendor/topic/digest hubs.")

if __name__ == "__main__":
    main()
