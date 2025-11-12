#!/usr/bin/env python3
import os, sys, csv, json, argparse, pathlib, re
from datetime import datetime

URL_RE = re.compile(r'^https?://')

def load_schema(p):
    return json.loads(pathlib.Path(p).read_text(encoding="utf-8"))

def check_row(row, schema, rownum, errs):
    for f in schema["required_fields"]:
        if f not in row or not str(row[f]).strip():
            errs.append(f"row {rownum}: missing required '{f}'")
    for f, t in schema.get("field_types", {}).items():
        if f not in row: 
            continue
        v = str(row[f]).strip()
        if t == "str_nonempty" and not v:
            errs.append(f"row {rownum}: '{f}' empty")
        elif t == "url" and not URL_RE.match(v):
            errs.append(f"row {rownum}: '{f}' not a valid http(s) url")
        elif t == "datetime":
            ok = False
            for fmt in ("%Y-%m-%d", "%Y-%m-%d %H:%M", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%d %H:%M:%S"):
                try:
                    datetime.strptime(v, fmt); ok=True; break
                except: 
                    pass
            if not ok:
                errs.append(f"row {rownum}: '{f}' not a recognized datetime")
    return errs

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=".")
    ap.add_argument("--schema", default="config/schema/events.schema.json")
    ap.add_argument("--file", default=None, help="data file override (csv)")
    args = ap.parse_args()

    root = pathlib.Path(args.root).resolve()
    schema = load_schema(root / args.schema)

    data_csv = args.file or (root / "data" / "events.csv")
    data_csv = pathlib.Path(data_csv)
    if not data_csv.exists():
        print(f"FAIL: data file not found: {data_csv}")
        sys.exit(2)

    errs = []
    seen = {k:set() for k in schema.get("unique_fields",[])}

    with data_csv.open(newline='', encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader, start=2):
            check_row(row, schema, i, errs)
            for uf in seen.keys():
                val = row.get(uf, "").strip()
                if val:
                    if val in seen[uf]:
                        errs.append(f"row {i}: duplicate unique field '{uf}'='{val}'")
                    else:
                        seen[uf].add(val)

    if errs:
        print("Schema violations:")
        for e in errs[:500]:
            print("-", e)
        print("FAIL: schema check")
        sys.exit(2)

    print("OK: data schema check passed")
    sys.exit(0)

if __name__ == "__main__":
    main()
