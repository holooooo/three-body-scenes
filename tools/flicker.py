"""Find temporal flicker in a rendered film.
usage: python3 tools/flicker.py video.mp4 [step_seconds=2] [out_prefix=build/stills/flicker]
For a 5-frame window every `step` seconds it measures the per-pixel 2nd temporal difference |f0 - 2 f1 + f2|
(large where a pixel alternates frame to frame, small for smooth motion) and writes a ranked list plus
heat-map images for the worst windows."""
import subprocess, sys, numpy as np
src = sys.argv[1]; step = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0; pre = sys.argv[3] if len(sys.argv) > 3 else 'build/stills/flicker'
W, H = 960, 540
dur = float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).decode())
def grab(t, n=5):
    raw = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', src, '-frames:v', str(n), '-vf', f'scale={W}:{H}', '-pix_fmt', 'gray', '-f', 'rawvideo', '-'])
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W).astype(np.float32)
rows = []
t = min(1.0, 0.1 * dur)
while t < dur - min(1.0, 0.15 * dur):
    f = grab(t)
    if len(f) >= 5:
        d2 = np.abs(f[:-2] - 2 * f[1:-1] + f[2:]).mean(0)          # flicker energy
        d1 = np.abs(f[1:] - f[:-1]).mean(0)                         # motion energy
        ratio = d2 / (d1 + 2.0)
        score = float(np.percentile(d2, 99.5)); frac = float((d2 > 14).mean())
        rows.append((score, frac, t, d2))
    t += step
rows.sort(key=lambda r: -r[1])
print('worst windows (t, 99.5th pct of 2nd diff, fraction of pixels flickering > 14):')
for s, fr, tt, _ in rows[:14]: print(f'  t={tt:6.1f}  p99.5={s:6.1f}  frac={fr * 100:5.2f}%')
print('median frac: %.3f%%' % (100 * float(np.median([r[1] for r in rows]))))
try:
    from PIL import Image
    for k, (s, fr, tt, d2) in enumerate(rows[:6]):
        Image.fromarray(np.clip(d2 * 6, 0, 255).astype(np.uint8)).save(f'{pre}-{k}-t{tt:05.1f}.png')
except Exception as e: print('no heatmaps:', e)
