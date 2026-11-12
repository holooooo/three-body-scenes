#!/bin/bash
# Contact sheet of stills for review: tools/sheet.sh out.jpg cols img1 img2 ...   (TILE=WxH env to change tile size)
out="$1"; cols="$2"; shift 2
TW=${TILE%x*}; TH=${TILE#*x}; TW=${TW:-960}; TH=${TH:-540}
n=$#
args=(); for f in "$@"; do args+=(-i "$f"); done
ffmpeg -y -v error "${args[@]}" -filter_complex "$(for i in $(seq 0 $((n-1))); do printf "[%d:v]scale=%d:%d[v%d];" $i $TW $TH $i; done; for i in $(seq 0 $((n-1))); do printf "[v%d]" $i; done)xstack=inputs=$n:layout=$(for i in $(seq 0 $((n-1))); do printf "%d_%d" $(( (i % cols) * TW )) $(( (i / cols) * TH )); [ $i -lt $((n-1)) ] && printf "|"; done)[o]" -map "[o]" -q:v 3 "$out"
echo "$out"
