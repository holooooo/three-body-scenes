#!/bin/bash
# Assemble the static site into build/site and deploy it to Cloudflare Pages.
#   tools/deploy.sh            -> assemble only
#   tools/deploy.sh --publish  -> assemble + wrangler pages deploy (production branch main)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
SITE=build/site; rm -rf "$SITE"; mkdir -p "$SITE"
rsync -a --exclude '.DS_Store' index.html scene.html film.html LICENSE .nojekyll src vendor assets brand "$SITE"/
echo "assembled $SITE: $(find "$SITE" -type f | wc -l | tr -d ' ') files, $(du -sh "$SITE" | cut -f1)"
if [ "${1:-}" = "--publish" ]; then
  wrangler pages deploy "$SITE" --project-name three-body-scenes --branch main --commit-dirty=true
fi
