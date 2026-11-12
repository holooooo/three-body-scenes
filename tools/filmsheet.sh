#!/bin/bash
# Review a film at a fixed step: tools/filmsheet.sh <scene> [step=2] [samples=1]  -> build/stills/film-<scene>-{a,b,...}.jpg (16 frames each)
s="$1"; step="${2:-2}"; smp="${3:-1}"
dur=$(node -e "const c=JSON.parse(require('fs').readFileSync('films/cues/$s.json','utf8'));console.log(c.duration)")
ts=$(python3 -c "print(','.join(f'{t:.1f}' for t in [0.5+i*$step for i in range(int($dur/$step)+1)] if t<$dur))")
node tools/render.mjs --scene "$s" --stills "$ts" --tag fs --query "samples=$smp" 2>&1 | grep -E "EXC|FAILED|rror"
files=(); IFS=',' read -ra arr <<< "$ts"; for t in "${arr[@]}"; do files+=("build/stills/$s-fs-t$(printf '%05.1f' "$t").jpg"); done
n=${#files[@]}; i=0; k=0
while [ $i -lt $n ]; do
  TILE=640x360 tools/sheet.sh "build/stills/film-$s-$(printf "\\$(printf '%03o' $((97+k)))").jpg" 4 "${files[@]:$i:16}"
  i=$((i+16)); k=$((k+1))
done
