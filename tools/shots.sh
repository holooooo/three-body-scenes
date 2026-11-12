#!/bin/bash
# Review chosen film times on one sheet: tools/shots.sh <scene> "t1,t2,..." [cols=4] [samples=1]  -> build/stills/shots-<scene>.jpg
s="$1"; ts="$2"; cols="${3:-4}"; smp="${4:-1}"
node tools/render.mjs --scene "$s" --stills "$ts" --tag x --query "samples=$smp" 2>&1 | grep -E "EXC|FAILED|rror"
files=(); IFS=',' read -ra arr <<< "$ts"; for t in "${arr[@]}"; do files+=("build/stills/$s-x-t$(printf '%05.1f' "$t").jpg"); done
TILE=640x360 tools/sheet.sh "build/stills/shots-$s.jpg" "$cols" "${files[@]}"
