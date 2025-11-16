#!/usr/bin/env python3
import argparse
import json
import os
import re
import sys
from pathlib import Path

EXPECTED_PRICES = {
    "portfolio": 499,
    "business": 1499,
    "enterprise_min": 2988,
}

BAD_PRICE_PATTERNS = [
    r"\$6,000",
    r"\$18,000",
    r"\b6000\b",
    r"\b18000\b",
]

HTML_EXTS = {".html"}

def load_ci_config(root: Path) -> bool:
    cfg_path = root / "config" / "ci" / "config.json"
    if not cfg_path.exists():
        print(f"[pricing-check] config file missing: {cfg_path}", file=sys.stderr)
        return False
    try:
        with cfg_path.open("r", encoding="utf-8") as f:
            cfg = json.load(f)
    except Exception as e:
        print(f"[pricing-check] failed to load {cfg_path}: {e}", file=sys.stderr)
        return False

    prices = cfg.get("prices", {})
    ok = True
    for key, expected in EXPECTED_PRICES.items():
        actual = prices.get(key)
        if actual != expected:
            print(f"[pricing-check] mismatch for prices.{key}: expected {expected}, got {actual}", file=sys.stderr)
            ok = False
    return ok

def scan_old_prices(root: Path) -> bool:
    bad_files = []
    for dirpath, dirnames, filenames in os.walk(root):
        rel_root = os.path.relpath(dirpath, root)
        # Skip evidence and node_modules and .git
        if rel_root.startswith("evidence") or "node_modules" in rel_root or rel_root.startswith(".git"):
            continue
        for fn in filenames:
            ext = os.path.splitext(fn)[1].lower()
            if ext not in HTML_EXTS:
                continue
            path = Path(dirpath) / fn
            try:
                text = path.read_text(encoding="utf-8")
            except Exception:
                continue
            for pat in BAD_PRICE_PATTERNS:
                if re.search(pat, text):
                    bad_files.append(str(path.relative_to(root)))
                    break
    if bad_files:
        print("[pricing-check] found legacy 6,000/18,000 pricing in HTML files:", file=sys.stderr)
        for f in bad_files:
            print(f"  - {f}", file=sys.stderr)
        return False
    return True

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".", help="repository root")
    args = parser.parse_args()
    root = Path(args.root).resolve()

    ok_cfg = load_ci_config(root)
    ok_scan = scan_old_prices(root)

    if not (ok_cfg and ok_scan):
        sys.exit(1)

if __name__ == "__main__":
    main()
