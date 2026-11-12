#!/usr/bin/env python3
"""Procedural score for the three-body showcase films.

usage: python3 tools/audio/score.py guzheng|droplet|foil|all [--report]
reads films/cues/<id>.json, writes build/audio/<id>.wav (and <id>.png with --report)
(env SCORE_CUES_DIR / SCORE_OUT_DIR override the folders, for testing)
"""
import json
import os
import sys
import time
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CUES = os.environ.get('SCORE_CUES_DIR', os.path.join(ROOT, 'films', 'cues'))
OUT = os.environ.get('SCORE_OUT_DIR', os.path.join(ROOT, 'build', 'audio'))

import numpy as np
from scipy import signal
from dsp import *
from engine import *
from common import master, ride

PIECES = {
    # id: (module, seed, hall_rt, hall_gain, room_rt, room_gain, level->relative LUFS targets)
    'guzheng': ('p_guzheng', 11, 5.0, 0.62, 1.5, 0.35, {0: -29, 1: -22, 2: -15.5, 3: -13, 4: -11}),
    'droplet': ('p_droplet', 23, 5.5, 0.55, 1.4, 0.3, {0: -29, 1: -25, 2: -15, 3: -12.5, 4: -11}),
    'foil': ('p_foil', 37, 6.2, 0.7, 1.7, 0.3, {0: -29, 1: -23, 2: -17, 3: -14.5, 4: -12}),
}


def write_wav(path, y):
    pcm = np.clip(np.round(y.T * 32767.0), -32768, 32767).astype('<i2')
    with wave.open(path, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def build(pid, report=False):
    t0 = time.time()
    mod_name, seed, hrt, hg, rrt, rg, targets = PIECES[pid]
    mod = __import__(mod_name)
    with open(os.path.join(CUES, pid + '.json')) as f:
        cue = Cue(json.load(f))
    R = np.random.default_rng(seed)
    mix = Mix(cue)
    mod.compose(cue, mix, R)
    hall = make_ir(hrt, 0.032, np.random.default_rng(seed + 1))
    room = make_ir(rrt, 0.010, np.random.default_rng(seed + 2), tilt=(1.1, 1.0, 0.8, 0.5, 0.3))
    x, wh, wr = mix.render(hall, room, hg, rg)
    x = ride(x, cue, targets, getattr(mod, 'RIDE_OVERRIDES', None))
    y, info = master(x, cue)
    assert y.shape == (2, cue.N) and np.isfinite(y).all()
    os.makedirs(OUT, exist_ok=True)
    out = os.path.join(OUT, pid + '.wav')
    write_wav(out, y)
    print(f"[{pid}] {out}  {cue.N} samples ({cue.N / SR:.3f}s)  LUFS {info['lufs']:.2f}  "
          f"TP {info['tp']:.2f} dBTP  DC {abs(y.mean()):.2e}  built in {time.time() - t0:.0f}s")
    if report:
        make_report(pid, cue, y)


def make_report(pid, cue, y):
    print('  per-section RMS (dBFS) / momentary-ish LUFS:')
    for s in cue.secs:
        seg = y[:, ix(s.t0):ix(s.t1)]
        rms = 20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-12)
        l = lufs(seg) if seg.shape[1] > ix(0.5) else float('nan')
        print(f"   {s.name:10s} {s.t0:5.1f}-{s.t1:5.1f}  L{s.level}  rms {rms:6.1f}  lufs {l:6.1f}")
    # hit onset check: largest positive log-RMS rise (2 ms frames) within +-120 ms
    mono = y.mean(0)
    hpm = signal.sosfilt(signal.butter(2, 150, 'hp', fs=SR, output='sos'), mono)
    fr = ix(0.002)
    nf = len(mono) // fr
    lr_full = 10 * np.log10(np.mean(mono[:nf * fr].reshape(nf, fr) ** 2, axis=1) + 1e-14)
    lr_hp = 10 * np.log10(np.mean(hpm[:nf * fr].reshape(nf, fr) ** 2, axis=1) + 1e-14)
    print('  hit onset check (largest 2ms energy rise within +-40ms, offset vs cue):')
    offs = []
    for h in cue.hits:
        c = int(h['t'] / 0.002)
        lr = lr_full if h['kind'] in ('sub', 'boom', 'impact', 'swell') else lr_hp
        lo, hi = max(c - 20, 1), min(c + 20, nf - 1)
        d = lr[lo:hi] - lr[lo - 1:hi - 1]
        j = lo + int(np.argmax(d))
        off = (j * 0.002 - h['t']) * 1000
        offs.append(off)
        print(f"   {h['t']:6.2f} {h['kind']:7s} {off:+6.0f} ms  (rise {d.max():4.1f} dB)")
    hpm2 = signal.sosfilt(signal.butter(2, 150, 'hp', fs=SR, output='sos'), mono)
    fr5 = ix(0.005)
    nf5 = len(hpm2) // fr5
    env = np.sqrt(np.mean(hpm2[:nf5 * fr5].reshape(nf5, fr5) ** 2, axis=1))
    print('  amplitude-modulation depth 8-30 Hz (max over 3 s windows, >150 Hz content):')
    W = 600
    win = np.hanning(W)
    fq5 = np.fft.rfftfreq(W, 0.005)
    band = (fq5 >= 8) & (fq5 <= 30)
    for s_ in cue.secs:
        a, b = int(s_.t0 / 0.005), int(s_.t1 / 0.005)
        best, bt = 0.0, 0.0
        for st in range(a, max(a + 1, b - W + 1), 300):
            e = env[st:st + W]
            if len(e) < W or e.mean() < 10 ** (-60 / 20):
                continue
            A = 2 * np.abs(np.fft.rfft((e - e.mean()) * win)) / win.sum() / e.mean()
            d = float(A[band].max())
            if d > best:
                best, bt = d, st * 0.005
        print(f"   {s_.name:10s} peak-bin depth {best:5.2f} (at {bt:5.1f}s)")
    bands = [(20, 120), (120, 500), (500, 2000), (2000, 5000), (5000, 10000), (10000, 20000)]
    F = np.abs(np.fft.rfft(mono)) ** 2
    fq = np.fft.rfftfreq(len(mono), 1 / SR)
    tot = F.sum()
    print('  spectral energy share: ' + '  '.join(f"{lo}-{hi}Hz {10 * np.log10(F[(fq >= lo) & (fq < hi)].sum() / tot + 1e-12):.1f}dB" for lo, hi in bands))
    try:
        import matplotlib
        matplotlib.use('Agg')
        import matplotlib.pyplot as plt
        fig, ax = plt.subplots(figsize=(15, 6))
        ax.specgram(mono, NFFT=4096, Fs=SR, noverlap=3072, cmap='magma', vmin=-130, vmax=-30)
        ax.set_ylim(0, 12000)
        for s in cue.secs:
            ax.axvline(s.t0, color='cyan', lw=0.8)
            ax.text(s.t0 + 0.1, 11300, f"{s.name} L{s.level}", color='cyan', fontsize=7, rotation=90, va='top')
        for h in cue.hits:
            ax.axvline(h['t'], color='white', lw=0.5, ls=':')
        for r in cue.risers:
            ax.axvspan(r['from'], r['to'], color='lime', alpha=0.12)
        for s in cue.silences:
            ax.axvspan(s['from'], s['to'], color='red', alpha=0.25)
        ax.set_title(f"{pid}  (cyan=sections, dotted=hits, green=risers, red=silences)")
        fig.tight_layout()
        p = os.path.join(OUT, pid + '.png')
        fig.savefig(p, dpi=90)
        print('  spectrogram', p)
    except Exception as e:
        print('  (spectrogram skipped:', e, ')')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    report = '--report' in sys.argv
    if not args:
        print(__doc__)
        sys.exit(1)
    ids = list(PIECES) if args[0] == 'all' else args
    for pid in ids:
        build(pid, report)


if __name__ == '__main__':
    main()
