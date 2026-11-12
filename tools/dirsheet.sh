#!/bin/bash
# Review the interactive page at a list of scene times: tools/dirsheet.sh <scene> "t1,t2,..."
s="$1"; ts="$2"
node tools/render.mjs --scene "$s" --page scene.html --stills "$ts" --tag dir --eval "document.body.classList.add('bare'); new Promise(r=>setTimeout(r,1800))" 2>&1 | grep -E "EXC|FAILED|rror" | grep -v favicon
files=(); IFS=',' read -ra arr <<< "$ts"; for t in "${arr[@]}"; do files+=("build/stills/$s-dir-t$(printf '%05.1f' "$t").jpg"); done
TILE=640x360 tools/sheet.sh "build/stills/dir-$s.jpg" 3 "${files[@]}"
