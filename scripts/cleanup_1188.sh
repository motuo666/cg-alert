#!/usr/bin/env bash
set -euo pipefail
echo "== CG Alert cleanup (1188) =="
# A) prefer cf/stripe-dispatcher; remove older cf/worker-stripe.js
if [ -f cf/worker-stripe.js ]; then
  git rm -f cf/worker-stripe.js || true
  echo "removed: cf/worker-stripe.js"
fi
# B) remove legacy kv-editor (we keep workers/kv-editor instead)
if [ -d kv-editor ]; then
  git rm -rf kv-editor || true
  echo "removed: kv-editor/ (legacy)"
fi
# C) make sure wrangler toml are ignored
if [ -f .gitignore.append ]; then
  if ! grep -q 'wrangler.toml' .gitignore 2>/dev/null; then
    cat .gitignore.append >> .gitignore
    echo "appended wrangler ignore rules to .gitignore"
  fi
fi
echo "Done. Commit the changes:"
echo "  git add -A && git commit -m 'chore: 1188 cleanup (stripe worker unify, kv-editor dedupe, wrangler ignore)' && git push"
