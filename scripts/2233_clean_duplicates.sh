#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PATCH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$PATCH_DIR/.." && pwd)"
J="$PATCH_DIR/delete-files-2233.json"
if [ ! -f "$J" ]; then echo "no delete list"; exit 0; fi
python3 - "$J" "$REPO_ROOT" <<'PY'
import sys, json, os
j, repo = sys.argv[1], sys.argv[2]
with open(j,'r',encoding='utf-8') as f:
    lst=json.load(f)
for rel in lst:
    target = os.path.join(repo, rel)
    if os.path.exists(target):
        print("rm", rel)
        os.remove(target)
print("done")
PY
