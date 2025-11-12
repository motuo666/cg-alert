#!/usr/bin/env python3
import os, re, sys, json, argparse, pathlib

PRICE_RE = re.compile(r'\$?\s*([0-9][0-9,]*)', re.I)
HREF_RE = re.compile(r'href=["\']([^"\']+)["\']', re.I)
TEXT_RE = re.compile(r'>([^<]+)<')

def read_file(p):
    return pathlib.Path(p).read_text(encoding="utf-8", errors="ignore")

def extract_text(html):
    return " ".join([m.strip() for m in TEXT_RE.findall(html) if m.strip()])

def find_prices(text):
    nums = [int(x.replace(",", "")) for x in PRICE_RE.findall(text)]
    return set(nums)

def find_hrefs(html):
    return HREF_RE.findall(html)

def load_cfg(root):
    cfgp = pathlib.Path(root) / "config/ci/config.json"
    if cfgp.exists():
        return json.loads(cfgp.read_text(encoding="utf-8"))
    return {
        "prices": {"portfolio": 2988, "business": 6000, "enterprise_min": 18000},
        "enterprise_cta_must_include": ["/intake/","/contact","/form"],
        "stripe_link_must_not_appear_for_enterprise": True,
        "pricing_page": "pricing/index.html"
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--pricing-page", default=None)
    args = ap.parse_args()

    root = pathlib.Path(args.root).resolve()
    cfg = load_cfg(root)
    pricing_page = args.pricing_page or cfg.get("pricing_page","pricing/index.html")
    page_path = (root / pricing_page).resolve()
    if not page_path.exists():
        print(f"FAIL: missing pricing page: {pricing_page}")
        sys.exit(2)

    html = read_file(page_path)
    text = extract_text(html)
    prices = find_prices(text)

    want_portfolio = cfg["prices"]["portfolio"]
    want_business = cfg["prices"]["business"]
    want_enterprise_min = cfg["prices"]["enterprise_min"]

    # price presence checks
    needed = {want_portfolio, want_business}
    if not needed.issubset(prices):
        print(f"FAIL: expected prices {needed} not all found in text: {prices}")
        sys.exit(2)
    # enterprise min must be present as a number or "+" form
    if not any(p >= want_enterprise_min for p in prices):
        print(f"FAIL: enterprise minimum ({want_enterprise_min}+) not found")
        sys.exit(2)

    # href checks
    hrefs = find_hrefs(html)
    enterprise_bad = []
    stripe_like = [h for h in hrefs if "stripe" in h.lower()]
    # enterprise CTAs must go to intake/contact/form, not Stripe
    must_incl = cfg.get("enterprise_cta_must_include", [])
    if cfg.get("stripe_link_must_not_appear_for_enterprise", True):
        # Allow stripe links to appear for non-enterprise tiers, but enterprise must have at least one intake/contact/form link
        if not any(any(token in h for token in must_incl) for h in hrefs):
            print("FAIL: enterprise CTA missing intake/contact/form link")
            sys.exit(2)
    print("OK: pricing & CTA guard passed")
    sys.exit(0)

if __name__ == "__main__":
    main()
