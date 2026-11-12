"""Doomsday Battle: C minor. Hymn pad -> cold sine droplet -> accelerating ostinato + drums -> desolation."""
import numpy as np
from dsp import *
from engine import *
from common import *

HYMN = [[0, 3, 7], [8, 0, 3], [5, 8, 0], [7, 11, 2]]       # Cm | Ab | Fm | G
DARK = [[0, 3, 7], [1, 5, 8], [5, 8, 0], [7, 11, 2, 8]]    # Cm | Db | Fm | G(b9)
ROOTS_H = [36, 32, 29, 31]
ROOTS_D = [36, 37, 29, 31]


def slots(t0, t1, step):
    n = max(1, int(round((t1 - t0) / step)))
    ed = np.linspace(t0, t1, n + 1)
    return [(float(ed[i]), float(ed[i + 1])) for i in range(n)]


def chord_seq(t0, t1, step, prog):
    return [(a, b, prog[i % len(prog)]) for i, (a, b) in enumerate(slots(t0, t1, step))]


def compose(cue, mix, R):
    N = cue.N
    t = np.arange(N) / SR
    S = cue.sec
    ones = np.ones(N)

    # ------------- low C drone (title) + fleet bass -------------
    ti = S('title')
    if ti:
        da = cue.pts([(0, 0), (0.3, 0), (3.2, 0.8), (ti.t1, 1.0), (ti.t1 + 0.01, 0)])
        x = supersaw(float(mtof(36)), N, 4, 8, R, spread=0.6)
        x = tv_filter(x, 220 + 380 * da, 'lp', 0.9, chunk=512) * da * 0.30
        mix.add(x, 0, dry=1.0, hall=0.35)
        sub = np.sin(TAU * mtof(24) * t) * da * 0.30
        mix.add(sub, 0, dry=1.0)
        fifth = supersaw(float(mtof(43)), N, 3, 9, R) * da * da * 0.07
        mix.add(tv_filter(fifth, 500, 'lp', 0.7, chunk=1024), 0, dry=1.0, hall=0.6)

    # ------------- the fleet's hymn -------------
    fl = S('fleet')
    if fl:
        conf = cue.pts([(fl.t0, 0), (fl.t1, 1)])
        amp = np.clip(cue.pts([(fl.t0, 0.55), (fl.t1, 1.0)]), 0, 1)
        cut = 700 + 2600 * conf
        ch = chord_seq(fl.t0, fl.t1, 3.0, HYMN)
        pad(cue, mix, R, ch, 50, 76, 4, 0.20, amp, cut, att=1.2, rel=1.3, nv=5, det=13, vowel=True,
            hall=0.55, hard_end=fl.t1)
        # brass-like layer: one octave up on the chord tones, breathes open on each chord
        pad(cue, mix, R, ch, 58, 82, 3, 0.08, amp * 0.8, 500 + 3200 * conf, att=0.7, rel=1.0, nv=4, det=9, hall=0.5,
            hard_end=fl.t1)
        # bass roots
        for i, (a, b, _) in enumerate(ch):
            m = ROOTS_H[i % 4]
            ln = ix(b - a + (0.02 if abs(b - fl.t1) < 1e-6 else 1.0))
            n0 = ix(a)
            x = saw_blep(np.full(ln, float(mtof(m))))
            x = filt(x, biquad('lp', 260, 0.8))
            x = (x * 0.4 + np.sin(TAU * mtof(m) * np.arange(ln) / SR)) * ar_env(ln, ix(0.5), ix(b - a), ix(1.0 if abs(b - fl.t1) > 1e-6 else 0.02))
            mix.add(x * 0.22 * float(np.clip(amp[n0], 0, 1)), n0, dry=1.0, hall=0.1)
            if i > 0:   # distant war-drum on each chord change, growing
                put(cue, mix, boom_hit(R), a, 0.12 + 0.28 * (i / max(len(ch) - 1, 1)), dry=0.8, hall=0.5)

    # ------------- the droplet: pure cold tone -------------
    dr, ig, af, ec = S('droplet'), S('ignition'), S('aftermath'), S('endcard')
    f_c = float(mtof(72))                      # C5, no vibrato, exactly in tune
    tone_env = np.zeros(N)
    if dr:
        s_end = max([s['to'] for s in cue.silences if dr.t0 - 0.01 <= s['from'] <= dr.t0 + 0.2] + [dr.t0])
        tone_env += cue.pts([(dr.t0, 0), (s_end, 0), (s_end + 1.2, 0.5), (dr.t1, 0.5)]) * (t >= dr.t0) * (t < dr.t1)
    if ig:
        tone_env += cue.pts([(ig.t0 - 0.2, 0), (ig.t0, 0.5), (ig.t1 - 0.3, 0.5), (ig.t1, 0.0)]) * (t >= ig.t0) * (t < ig.t1)
    if af:
        s_end = max([s['to'] for s in cue.silences if af.t0 - 0.01 <= s['from'] <= af.t0 + 0.2] + [af.t0])
        tone_env += cue.pts([(s_end, 0), (s_end + 0.9, 1.0), (cue.dur, 1.0)]) * (t >= af.t0)
    if ec:
        tone_env *= cue.end_fade(ec.t0 + 1.5, cue.dur - 0.5)
    # tone follows its own windows: dr/ig/af/ec only
    tn = (np.sin(TAU * f_c * t) + 0.10 * np.sin(TAU * 2 * f_c * t) + 0.035 * np.sin(TAU * 3 * f_c * t)) * tone_env
    mix.add(np.stack([tn, np.roll(tn, 9)]) * 0.16, 0, dry=1.0, hall=0.55, room=0.05)
    if dr:
        # faint high shimmer: slowly flickering high partials of the tone
        sh = np.zeros(N)
        for mult in (4, 6, 8, 12):
            fl_ = np.abs(smooth_curve(R.standard_normal(N), 0.6))
            fl_ /= fl_.max() + 1e-9
            sh += np.sin(TAU * f_c * mult * t + R.uniform(0, TAU)) * fl_
        sh_env = tone_env * (t < dr.t1)
        mix.add(np.stack([sh, np.roll(sh, 31)]) * sh_env * 0.012, 0, dry=0.6, hall=0.9)

    # ------------- aftermath: very low rumble -------------
    if af:
        ramp = cue.pts([(af.t0, 0), (af.t0 + 2.0, 1), (cue.dur, 1)]) * (t >= af.t0)
        if ec:
            ramp *= cue.end_fade(ec.t0 + 1.0, cue.dur - 0.5)
        nz = filt(R.standard_normal((2, N)), biquad('lp', 70, 0.7), biquad('lp', 70, 0.7))
        nz /= nz.std() + 1e-9
        flo = 0.6 + 0.4 * np.sin(TAU * 0.13 * t)
        mix.add(nz * ramp * flo * 0.05, 0, dry=1.0)
        d = np.sin(TAU * mtof(24) * t) * ramp * 0.12 + np.sin(TAU * mtof(36) * t) * ramp * 0.04
        mix.add(d, 0, dry=1.0, hall=0.2)

    # ------------- ostinato + kicks (accelerating 16ths) -------------
    hot = [s for s in cue.secs if s.level >= 3]
    if hot:
        o0, o1 = hot[0].t0, hot[-1].t1
        lev_amp = cue.curve(lambda s: {3: 0.8, 4: 1.0}.get(s.level, 0.0), 0.0, fade=0.4)
        i0, i1 = ix(o0), ix(o1)
        prog = np.clip((t - o0) / (o1 - o0), 0, 1)
        bpm = 112 + 66 * prog ** 0.8
        rate = bpm * 4 / 60.0
        phase = np.cumsum(rate) / SR
        ticks = np.searchsorted(phase[i0:i1] - phase[i0], np.arange(0, phase[i1 - 1] - phase[i0]) )
        pat = [0, 0, 12, 0, 3, 0, 12, 7, 0, 0, 12, 0, 5, 0, 10, 7]
        for j, off in enumerate(ticks):
            n0 = i0 + int(off)
            bar, st = divmod(j, 16)
            s = cue.sec_at(n0 / SR)
            roots = ROOTS_D if s.level >= 4 and s.t0 >= (hot[-1].t0 - 1e-6) else ROOTS_H
            root = roots[bar % 4]
            midi = root + pat[st]
            step = 1.0 / float(rate[min(n0, N - 1)])
            dur = min(0.7 * step, 0.16)
            vel = (1.0 if st % 4 == 0 else 0.62) * (1.15 if st == 0 else 1.0) * float(lev_amp[n0])
            ln = ix(dur + 0.04)
            tt = np.arange(ln) / SR
            f = float(mtof(midi))
            y = saw_blep(np.full(ln, f)) * 0.8 + np.sign(np.sin(TAU * f * 0.5 * tt)) * 0.45
            y = tv_filter(y, 230 + (350 + 1900 * vel) * np.exp(-tt / 0.045), 'lp', 1.1, chunk=64)
            y = np.tanh(2.0 * y) * np.exp(-tt / (dur * 0.9)) * (1 - np.exp(-tt / 0.0015))
            y[-ix(0.01):] *= np.linspace(1, 0, ix(0.01))
            mix.add(pan_stereo(y * 0.24 * vel, 0.0), n0, dry=1.0, hall=0.12, room=0.05)
            if st % 4 == 0:     # low drum on the beat
                ln2 = ix(0.38)
                t2 = np.arange(ln2) / SR
                f2 = 44 + 70 * np.exp(-t2 / 0.035)
                k = np.sin(TAU * np.cumsum(f2) / SR) * np.exp(-t2 / 0.13) * (1 - np.exp(-t2 / 0.001))
                k += filt(R.standard_normal(ln2), biquad('lp', 1800, 0.7)) * np.exp(-t2 / 0.012) * 0.25
                k[-ix(0.01):] *= np.linspace(1, 0, ix(0.01))
                mix.add(k * (0.55 if st == 0 else 0.35) * float(lev_amp[n0]), n0, dry=1.0, hall=0.08)

    # ------------- distorted hymn in the turn, harder in the rout -------------
    tu, ro = S('turn'), S('rout')
    if tu:
        a_t = cue.pts([(tu.t0, 0.0), (tu.t0 + 0.4, 1.0), (tu.t1, 1.0)])
        ch = chord_seq(tu.t0, tu.t1, 2.0, DARK)
        pad(cue, mix, R, ch, 48, 74, 4, 0.20, a_t, 900 + 0 * t + 800 * a_t, att=0.35, rel=0.5, nv=5, det=18, drive=2.8,
            vowel=True, hall=0.4, hard_end=tu.t1 if (ro and ro.t0 == tu.t1) else None)
    if ro:
        ch = chord_seq(ro.t0, ro.t1, 1.5, DARK[::-1][2:] + DARK[::-1][:2])
        pad(cue, mix, R, ch, 50, 80, 5, 0.17, ones, 1500 + 0 * t, att=0.25, rel=0.5, nv=5, det=22, drive=3.4,
            vowel=True, hall=0.35, hard_end=ro.t1)

    # ------------- hits -------------
    gl_p = {'droplet': 84, 'aftermath': 84}
    for h in cue.hits:
        k, g, tt = h['kind'], h['gain'], h['t']
        if k == 'sub':
            put(cue, mix, sub_hit(R, f_lo=30), tt, 0.62 * g, dry=1.0)
        elif k == 'boom':
            put(cue, mix, boom_hit(R), tt, 0.85 * g, dry=1.0, hall=0.2, room=0.1)
        elif k == 'impact':
            put(cue, mix, impact_hit(R), tt, 1.0 * g, dry=1.0, hall=0.3, room=0.1)
        elif k == 'glass':
            put(cue, mix, glass_hit(R, gl_p.get(cue.sec_at(tt).name, 84)), tt, 0.15 * g, dry=0.7, hall=0.9)
        elif k == 'swell':
            bloom(cue, mix, R, [48, 55, 63, 67, 72], tt, min(3.0, tt - 0.3) if tt > 0.6 else 0.3, 2.5, 0.20 * g, 400, 2600,
                  vowel=True, hall=0.8)
    for i, r in enumerate(cue.risers):
        if i == 0:
            put_riser(cue, mix, r, R, f_lo=400, f_hi=6500, tone=(523.25, 1046.5), noise=0.25, tone_amp=0.08)
        else:
            put_riser(cue, mix, r, R, f_lo=250, f_hi=5500, tone=(130.8, 261.6) if i == 1 else (1046.5, 2093.0),
                      noise=0.3, tone_amp=0.10 if i == 1 else 0.05)
