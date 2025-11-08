#!/usr/bin/env bash
set -euo pipefail
# Move archived workflows out of the active folder so actionlint doesn't parse broken examples.
if [ -d ".github/workflows/_archive" ]; then
  mkdir -p .github/workflows-archive
  git mv -f .github/workflows/_archive .github/workflows-archive || mv -f .github/workflows/_archive .github/workflows-archive
  echo "Moved _archive workflows to .github/workflows-archive (ignored by GitHub)."
else
  echo "No _archive folder under .github/workflows."
fi
# Optionally disable any *.yml.off files still present
for f in .github/workflows/*.yml.off .github/workflows/*.yaml.off; do
  [ -e "$f" ] || continue
  new="${f%.off}"
  mv "$f" "$new"
  echo "Re-enabled $new"
done
