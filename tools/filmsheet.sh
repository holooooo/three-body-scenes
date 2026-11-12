#!/bin/bash
# Review a film at a fixed step: tools/filmsheet.sh <scene> [step=2] [samples=1]  -> build/stills/film-<scene>-{a,b}.jpg
s="$1"; step="${2:-2}"; smp="${3:-1}"
ts=$(python3 -c "print(','.join(f'{t:.1f}' for t in [1+i*$step for i in range(int(61/$step)+1)] if t<62))")
node tools/render.mjs --scene "$s" --stills "$ts" --tag fs --query "samples=$smp" 2>&1 | grep -E "EXC|FAILED|rror"
files=(); for t in ${ts//,/ }; do files+=("build/stills/$s-fs-t$(printf '%05.1f' $t).jpg"); done
half=$(( (${#files[@]} + 1) / 2 ))
TILE=640x360 tools/sheet.sh build/stills/film-$s-a.jpg 4 "${files[@]:0:$half}"
TILE=640x360 tools/sheet.sh build/stills/film-$s-b.jpg 4 "${files[@]:$half}"
