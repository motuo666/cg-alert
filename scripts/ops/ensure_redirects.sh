#!/usr/bin/env bash
set -euo pipefail
f="cg-alert-main/_redirects"
touch "$f"
add_line(){
  local line="$1"
  grep -Fqx "$line" "$f" || { printf "%s\n" "$line" | cat - "$f" > "$f.tmp" && mv "$f.tmp" "$f"; }
}
add_line "/pricing   /#pricing   301"
add_line "/unsubscribe/*   https://api.cg-alert.com/unsubscribe/:splat   302"
add_line "/*/unsubscribe/*   https://api.cg-alert.com/unsubscribe/:splat   302"
echo "ensured redirects in $f"
