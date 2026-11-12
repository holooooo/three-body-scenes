#!/bin/bash
# tools/make_film.sh <guzheng|droplet|foil> [--mux-only] [--poster SECONDS] [render.mjs args...]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
ID="${1:-}"; [ -n "$ID" ] || { echo "usage: $0 <guzheng|droplet|foil> [--mux-only] [--poster S] [render args]" >&2; exit 2; }
shift
case "$ID" in
  guzheng) NAME="三体名场面-01-古筝行动";;
  droplet) NAME="三体名场面-02-末日战役";;
  foil)    NAME="三体名场面-03-二向箔";;
  *) echo "unknown id: $ID" >&2; exit 2;;
esac
MUX_ONLY=0; POSTER=30; ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --mux-only) MUX_ONLY=1;;
    --poster) POSTER="$2"; shift;;
    *) ARGS+=("$1");;
  esac; shift
done
V="build/video/$ID.mp4"; A="build/audio/$ID.wav"; OUT="out/$NAME.mp4"
if [ "$MUX_ONLY" = 0 ]; then node tools/render.mjs --scene "$ID" ${ARGS[@]+"${ARGS[@]}"}; fi
[ -f "$V" ] || { echo "missing $V" >&2; exit 1; }
[ -f "$A" ] || { echo "missing $A" >&2; exit 1; }
mkdir -p out
dur() { ffprobe -v error -select_streams "$2" -show_entries stream=duration -of default=nw=1:nk=1 "$1" | head -1; }
VD=$(dur "$V" v:0); AD=$(dur "$A" a:0)
AF="aresample=48000"
MODE=$(awk -v v="$VD" -v a="$AD" 'BEGIN{d=a-v; print (d<-0.02)?"pad":(d>0.02)?"trim":"same"}')
case "$MODE" in
  pad)  AF="$AF,apad";;
  trim) AF="$AF,afade=t=out:st=$(awk -v v="$VD" 'BEGIN{printf "%.3f", v-0.5}'):d=0.5";;
esac
echo "video ${VD}s audio ${AD}s -> audio mode: $MODE"
# -t pins the output to the video length (apad is infinite; trim cuts long audio). No -shortest.
ffmpeg -y -v error -i "$V" -i "$A" -map 0:v:0 -map 1:a:0 -c:v copy -af "$AF" -c:a aac -b:a 192k -ar 48000 -ac 2 -t "$VD" -movflags +faststart "$OUT"
ffmpeg -y -v error -ss "$POSTER" -i "$OUT" -frames:v 1 -q:v 2 "out/$NAME.jpg"
echo "== $OUT"
ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,color_space,duration -of default=nw=1 "$OUT"
echo "poster: out/$NAME.jpg (t=${POSTER}s)"
