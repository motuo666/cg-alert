#!/usr/bin/env python3
import argparse, subprocess, sys, os

def run(cmd):
    print("+", " ".join(cmd), flush=True)
    return subprocess.call(cmd) == 0

def main():
    ap = argparse.ArgumentParser(description="One-click P0+P1+P2 finalization (non-visual changes only).")
    ap.add_argument("--root", default=".", help="Repository root")
    ap.add_argument("--site-origin", required=True, help="e.g. https://www.cg-alert.com")
    args = ap.parse_args()

    env = os.environ.copy()
    env["SITE_ORIGIN"] = args.site_origin

    steps = [
        ["python3", "scripts/normalize_events.py", "--root", args.root],
        ["python3", "scripts/auto_fix_links.py", "--root", args.root],
        ["python3", "scripts/normalize_canonical.py", "--root", args.root, "--site-origin", args.site_origin],
        ["node", "scripts/build_sitemap.mjs"],
        ["python3", "scripts/check_links.py", "--root", args.root, "--verbose"],
        ["python3", "scripts/check_data_schema.py", "--root", args.root]
    ]

    for cmd in steps:
        if not run(cmd):
            print("FAIL:", " ".join(cmd))
            sys.exit(2)

    print("OK: Finalization completed successfully.")

if __name__ == "__main__":
    main()
