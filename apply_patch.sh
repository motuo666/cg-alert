#!/usr/bin/env bash
set -e
APPEND="redirects_append.txt"
TARGET="_redirects"
mkdir -p evidence
if [ -f "$APPEND" ]; then
  touch "$TARGET"
  if [ -s "$TARGET" ] && [ -n "$(tail -c1 "$TARGET")" ]; then echo >> "$TARGET"; fi
  while IFS= read -r line || [ -n "$line" ]; do
    grep -qxF "$line" "$TARGET" || echo "$line" >> "$TARGET"
  done < "$APPEND"
  echo "Appended redirects into $TARGET"
fi
echo "Apply done. Next: xargs -a DELETE_LIST.txt -r git rm -f ; git add -A ; git commit ; git push"
