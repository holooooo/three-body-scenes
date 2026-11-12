"""Shared hit / riser placement and mastering."""
import numpy as np
from scipy import signal
from dsp import *
from engine import *


def exempt(cue, t):
    """hits that land on the start of a silence are the accent that causes the cut: not ducked."""
    return any(s['from'] - 1e-6 <= t <= s['from'] + 0.06 for s in cue.silences)


def put(cue, mix, sp, t, gain=1.0, dry=1.0, hall=0.0, room=0.0, ring_tau=None):
    """ring_tau: if a silence starts within 0.45 s after this hit, the hit is not ducked but its tail is
    given an extra exp(-t/ring_tau) decay from the silence start, so it rings out into the silence instead of
    being chopped (the reverb-tail rule) without filling the silence."""
    sig, pre = sp
    duck = not exempt(cue, t)
    if ring_tau:
        for s in cue.silences:
            d = s['from'] - t
            if 0.06 < d <= 0.45:
                k = np.arange(sig.shape[1]) / SR - pre
                sig = sig * np.exp(-np.maximum(0.0, k - d) / ring_tau)
                duck = False
                break
    mix.add(sig * gain, ix(t) - pre, dry=dry, hall=hall, room=room, duck=duck)


def put_riser(cue, mix, r, rng, **kw):
    dur = r['to'] - r['from']
    g = kw.pop('gain', 1.0)
    send = kw.pop('hall', 0.35)
    sig = riser_sig(dur, rng, **kw)
    mix.add(sig * g, ix(r['to']) - sig.shape[1], dry=1.0, hall=send, room=0.1)


def ride(x, cue, targets, overrides=None, clamp=12.0, fade=1.6):
    """Section-level loudness rider: pulls each section's typical (60th-percentile of 0.5 s blocks,
    K-weighted) loudness toward targets[level] or overrides[name] (relative LU), smoothed across boundaries.
    Using a percentile keeps a single big hit at the end of a near-silent section from being ridden down."""
    overrides = overrides or {}
    y = k_weight(x)
    arr = np.zeros(cue.N)
    blk = ix(0.5)
    for s in cue.secs:
        a, b = ix(s.t0), ix(s.t1)
        nb = max(1, (b - a) // blk)
        seg = y[:, a:a + nb * blk]
        if seg.shape[1] < blk:
            seg = y[:, a:b]
            nb = 1
            ms = np.mean(seg ** 2, axis=1).sum(keepdims=True)
        else:
            ms = (seg.reshape(2, nb, blk) ** 2).mean(2).sum(0)
        l = -0.691 + 10 * np.log10(ms + 1e-12)
        l = np.percentile(l, 60)
        tgt = overrides.get(s.name, targets[s.level])
        arr[a:b] = np.clip(tgt - l, -clamp, clamp)
    g = smooth_curve(arr, fade)
    return x * db(g)


def fill_phrases(sec, phrases, place, start=0.4, gap=1.0, min_fit=0.7, margin=0.4):
    """Place phrases one after another inside a section; a phrase that mostly does not fit is dropped.
    phrases: list of note lists [(dt, ...), ...]; place(t, notes) plays them."""
    cursor = sec.t0 + start
    for ph in phrases:
        fit = [n for n in ph if cursor + n[0] < sec.t1 - margin]
        if len(fit) < min_fit * len(ph):
            break
        place(cursor, fit)
        cursor += max(n[0] for n in ph) + gap
    return cursor


def master(x, cue, target=-14.0):
    N = cue.N
    sos = signal.butter(2, 25, 'hp', fs=SR, output='sos')
    x = signal.sosfilt(sos, x, axis=-1)
    x = mono_below(x, 120)
    x = compress(x, thr_db=-19, ratio=1.45, attack=0.05, release=0.6, knee=12)
    # edge fades: silent start / end, no click
    f = np.ones(N)
    a0, a = ix(0.03), ix(0.033)          # cold open: 30 ms digital silence, then a 3 ms de-click ramp
    f[:a0] = 0
    f[a0:a] = cos_ramp(a - a0)
    e0 = ix(cue.dur - 1.6)
    e1 = ix(cue.dur - 0.08)
    f[e0:e1] = 0.5 + 0.5 * np.cos(np.pi * np.linspace(0, 1, e1 - e0))
    f[e1:] = 0
    x = x * f
    ceiling = -1.6
    g = 1.0
    for _ in range(5):
        for _ in range(4):
            y = limiter(x * g, ceiling)
            L = lufs(y)
            if abs(L - target) < 0.05:
                break
            g *= db(target - L)
        tp = true_peak_db(y)
        if tp <= -1.0:
            break
        ceiling -= (tp + 1.0) + 0.1
    return y, dict(lufs=L, tp=tp, ceiling=ceiling)


# ------------------------------------------------------------------ pads
VOWEL_AH = ((730, 6.0, 1.0), (1090, 8.0, 0.6), (2440, 10.0, 0.3))


def pad(cue, mix, R, chords, lo, hi, k, gain, amp, cut, att=1.2, rel=1.2, nv=5, det=12, drive=0.0,
        vowel=False, hall=0.5, room=0.1, hard_end=None, spread=0.9, q=0.7, att_first=None, brass=None):
    """Voice-led pad: chords [(t0,t1,pcs)], amp/cut are full-length curves (gain, Hz)."""
    notes = voice_notes(chords, lo, hi, k)
    first = min(n[0] for n in notes)
    for (t_on, t_off, m) in notes:
        r = 0.02 if (hard_end is not None and abs(t_off - hard_end) < 1e-6) else rel
        a_t = att_first if (att_first is not None and abs(t_on - first) < 1e-6) else att
        n0 = ix(t_on)
        ln = ix(t_off - t_on + r)
        x = supersaw(float(mtof(m)), ln, nv, det, R, spread=spread, drift=3.0)
        cc = sl(cut, n0, ln)
        if brass:
            cc = brass[0] + (brass[1] - brass[0]) * (1 - np.exp(-np.arange(ln) / SR / brass[2]))
        x = tv_filter(tv_filter(x, cc, 'lp', q, chunk=512), cc, 'lp', 0.6, chunk=512)
        if vowel:
            vs = sum(signal.sosfilt(biquad('bp', f, qq)[None], x, axis=-1) * g for f, qq, g in VOWEL_AH)
            x = 0.55 * x + 1.1 * vs
        if drive:
            x = np.tanh(drive * x) / np.tanh(drive * 0.6)
            x = filt(x, biquad('lp', 4200, 0.7))
        e = ar_env(ln, ix(a_t), ix(t_off - t_on), ix(r))
        mix.add(x * (e * sl(amp, n0, ln) * gain), n0, dry=1.0, hall=hall, room=room)


def bloom(cue, mix, R, notes, t_peak, rise, fall, gain, cut_lo, cut_hi, nv=6, det=14, hall=0.7, room=0.1,
          spread=1.0, vowel=False, duck=True):
    """Soft pad swell that peaks exactly at t_peak and flattens afterwards."""
    nr, nf_ = ix(rise), ix(fall)
    ln = nr + nf_
    n0 = ix(t_peak) - nr
    env = np.concatenate([cos_ramp(nr) ** 1.4, (1 - cos_ramp(nf_)) ** 1.2])
    cutc = cut_lo * (cut_hi / cut_lo) ** env
    for m in notes:
        x = supersaw(float(mtof(m)), ln, nv, det, R, spread=spread, drift=3.0)
        x = tv_filter(tv_filter(x, cutc, 'lp', 0.7, chunk=512), cutc, 'lp', 0.6, chunk=512)
        if vowel:
            vs = sum(signal.sosfilt(biquad('bp', f, qq)[None], x, axis=-1) * g for f, qq, g in VOWEL_AH)
            x = 0.55 * x + 1.1 * vs
        mix.add(x * (env * gain), n0, dry=1.0, hall=hall, room=room, duck=duck and not exempt(cue, t_peak))
