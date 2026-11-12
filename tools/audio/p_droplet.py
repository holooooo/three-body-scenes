"""Doomsday Battle: C minor. Cold open on the sincere hymn -> reveal (hymn sags flat into the cold sine) ->
accelerating ostinato / drums from several viewpoints -> desolation."""
import numpy as np
from dsp import *
from engine import *
from common import *

HYMN_A = [[0, 3, 7], [8, 0, 3], [5, 8, 0], [7, 11, 2]]      # Cm | Ab | Fm | G
HYMN_B = [[3, 7, 10], [10, 2, 5], [8, 0, 3], [7, 11, 2, 5]]  # Eb | Bb | Ab | G7   (second strain)
DARK_A = [[0, 3, 7], [1, 5, 8], [5, 8, 0], [7, 11, 2, 8]]   # Cm | Db | Fm | G(b9)
DARK_B = [[0, 3, 7], [3, 7, 10], [1, 5, 8], [10, 2, 5]]     # Cm | Eb | Db | Bb
ROOTS_H = [36, 32, 29, 31]
ROOTS_D = [36, 37, 29, 31]
ROOTS_R = [36, 34, 32, 31]
PAT_A = [0, 0, 12, 0, 3, 0, 12, 7, 0, 0, 12, 0, 5, 0, 10, 7]
PAT_B = [0, 0, 12, 0, 1, 0, 12, 7, 0, 0, 12, 0, 3, 0, 10, 6]
RIDE_OVERRIDES = {'hull': -33.0, 'aftermath': -27.0, 'endcard': -28.0, 'reveal': -24.0}
MAX_RATE = 7.5   # ostinato steps per second: kept below 8 Hz so it never reads as flicker


def chord_seq(t0, t1, step, prog):
    n = max(1, int(round((t1 - t0) / step)))
    ed = np.linspace(t0, t1, n + 1)
    return [(float(ed[i]), float(ed[i + 1]), prog[i % len(prog)]) for i in range(n)]


def compose(cue, mix, R):
    N = cue.N
    t = np.arange(N) / SR
    S = cue.sec
    ones = np.ones(N)
    fl, rv, ig, on, hu, tu, ro, fe, gv, af, ec = (S(n) for n in ('fleet', 'reveal', 'ignition', 'onboard', 'hull', 'turn',
                                                                   'rout', 'fleeing', 'godview', 'aftermath', 'endcard'))

    def sil_end(sec):
        return max([s['to'] for s in cue.silences if sec.t0 - 0.01 <= s['from'] <= sec.t0 + 0.3] + [sec.t0])

    # ============================================================ the fleet's hymn: sincere, full from the first sample
    fleet_ch = []
    if fl:
        conf = cue.pts([(fl.t0, 0), (fl.t1, 1)])
        amp = cue.pts([(fl.t0, 0.85), (fl.t1, 1.0)])
        cut = 1500 + 1500 * conf
        fleet_ch = chord_seq(fl.t0, fl.t1, 3.0, HYMN_A + HYMN_B)
        pad(cue, mix, R, fleet_ch, 50, 76, 4, 0.20, amp, cut, att=1.2, rel=1.3, nv=5, det=9, vowel=True, hall=0.55,
            hard_end=fl.t1, att_first=0.004)
        pad(cue, mix, R, fleet_ch, 58, 82, 3, 0.08, amp * 0.8, 800 + 3200 * conf, att=0.7, rel=1.0, nv=4, det=7, hall=0.5,
            hard_end=fl.t1, att_first=0.004)
        roots = ROOTS_H + [27, 34, 32, 31]
        for i, (a, b, _) in enumerate(fleet_ch):
            m = roots[i % len(roots)]
            last = abs(b - fl.t1) < 1e-6
            ln = ix(b - a + (0.02 if last else 1.0))
            n0 = ix(a)
            x = saw_blep(np.full(ln, float(mtof(m))))
            x = filt(x, biquad('lp', 260, 0.8))
            x = (x * 0.4 + np.sin(TAU * mtof(m) * np.arange(ln) / SR)) * ar_env(ln, ix(0.004 if i == 0 else 0.5), ix(b - a), ix(0.02 if last else 1.0))
            mix.add(x * 0.22 * float(amp[min(n0, N - 1)]), n0, dry=1.0, hall=0.1)
            if i > 0:
                put(cue, mix, boom_hit(R), a, 0.12 + 0.28 * (i / max(len(fleet_ch) - 1, 1)), dry=0.8, hall=0.5)

    def chord_at(tt):
        for a, b, p in fleet_ch:
            if a <= tt + 0.01 < b:
                return p
        return HYMN_A[0]

    # ============================================================ reveal: hymn thins voice by voice, sags flat; cold tone takes over
    t_alone = None
    if rv:
        t_alone = rv.t0 + 0.8 * rv.len
        last = [p for (a, b, p) in fleet_ch][-1:] or [HYMN_A[3]]
        vs = sorted(lead(None, last[0], 50, 76, 4)) + [31]
        for i, m in enumerate(sorted(vs, reverse=True)):
            t_out = rv.t0 + (0.18 + 0.15 * i) * rv.len * 1.0
            t_out = min(t_out, t_alone)
            n0 = ix(rv.t0)
            n1 = ix(t_out + 0.2)
            ln = n1 - n0
            tt = np.arange(ln) / SR
            u = np.clip(tt / (t_alone - rv.t0), 0, 1)
            cents = -110.0 * u ** 1.4
            f = float(mtof(m)) * 2 ** (cents / 1200)
            if m < 40:
                x = np.sin(TAU * np.cumsum(f) / SR) + 0.4 * saw_blep(f) * 0
                x = np.stack([x, x]) * 1.0
                x = filt(x, biquad('lp', 400, 0.7))
            else:
                x = supersaw(f, ln, 5, 9, R, spread=0.9, drift=3.0)
                cc = 2800 - 2000 * u
                x = tv_filter(tv_filter(x, cc, 'lp', 0.7, chunk=512), cc, 'lp', 0.6, chunk=512)
                vsum = sum(signal.sosfilt(biquad('bp', f_, q_)[None], x, axis=-1) * g_ for f_, q_, g_ in VOWEL_AH)
                x = 0.55 * x + 1.1 * vsum * (1 - 0.6 * u)
            e = ar_env(ln, ix(0.02), max(ix(t_out - rv.t0 - 1.6), 1), ix(1.8))
            mix.add(x * (e * (0.2 if m >= 40 else 0.22)), n0, dry=1.0, hall=0.6)

    # ============================================================ the droplet's pure cold tone
    f_c = float(mtof(72))                      # C5, no vibrato, exactly in tune
    tone_env = np.zeros(N)
    if rv:
        u = np.clip((t - (rv.t0 + 0.2 * rv.len)) / (t_alone - (rv.t0 + 0.2 * rv.len)), 0, 1)
        tone_env += 0.55 * (u * u * (3 - 2 * u)) * (t < rv.t1)
    if ig:
        tone_env += 0.55 * cue.pts([(ig.t0 - 0.01, 0.0), (ig.t0, 1), (ig.t1 - 0.4, 1), (ig.t1 - 0.1, 0.0)]) * (t >= ig.t0) * (t < ig.t1)
    if hu:
        tone_env += 0.45 * cue.pts([(hu.t0, 0), (sil_end(hu) + 1.5, 1), (hu.t1 - 0.3, 1), (hu.t1, 0)]) * (t >= hu.t0) * (t < hu.t1)
    if af:
        tone_env += cue.pts([(af.t0, 0), (sil_end(af) + 0.9, 1), (cue.dur, 1)]) * (t >= af.t0)
    if ec:
        tone_env *= cue.end_fade(ec.t0 + 1.5, cue.dur - 0.5)
    sp_ = np.where(tone_env > 1e-4)[0]
    if len(sp_):
        i0, i1 = int(sp_[0]), int(sp_[-1]) + 1
        tt = t[i0:i1]
        tn = (np.sin(TAU * f_c * tt) + 0.10 * np.sin(TAU * 2 * f_c * tt) + 0.035 * np.sin(TAU * 3 * f_c * tt)) * tone_env[i0:i1]
        mix.add(np.stack([tn, np.roll(tn, 9)]) * 0.16, i0, dry=1.0, hall=0.55, room=0.05)
        shw = ones * 0
        if rv:
            shw += (t >= rv.t0) * (t < rv.t1)
        if ig:
            shw += (t >= ig.t0) * (t < ig.t1)
        if hu:
            shw += (t >= hu.t0) * (t < hu.t1)
        sh = np.zeros(i1 - i0)
        for mult in (4, 6, 8, 12):
            fl_ = np.abs(smooth_curve(R.standard_normal(i1 - i0), 0.6))
            fl_ /= fl_.max() + 1e-9
            sh += np.sin(TAU * f_c * mult * tt + R.uniform(0, TAU)) * fl_
        mix.add(np.stack([sh, np.roll(sh, 31)]) * (tone_env[i0:i1] * shw[i0:i1]) * 0.012, i0, dry=0.6, hall=0.9)

    # ============================================================ ignition halo
    if ig:
        bloom(cue, mix, R, [72, 79, 84, 87], ig.t1, min(5.5, ig.len - 0.3), 1.5, 0.06, 1200, 5200, hall=1.0, nv=4)

    # ============================================================ rumble: hull (swelling) and aftermath
    rum = np.zeros(N)
    if hu:
        rum += cue.pts([(hu.t0, 0), (sil_end(hu) + 0.5, 0.15), (hu.t1 - 1.6, 1.0), (hu.t1 - 1.5, 0.0)]) * (t >= hu.t0) * (t < hu.t1)
    if af:
        rum += cue.pts([(af.t0, 0), (af.t0 + 2.0, 1), (cue.dur, 1)]) * (t >= af.t0)
    if ec:
        rum *= cue.end_fade(ec.t0 + 1.0, cue.dur - 0.5)
    sp_ = np.where(rum > 1e-4)[0]
    if len(sp_):
        i0, i1 = int(sp_[0]), int(sp_[-1]) + 1
        tt = t[i0:i1]
        nz = filt(R.standard_normal((2, i1 - i0)), biquad('lp', 70, 0.7), biquad('lp', 70, 0.7))
        nz /= nz.std() + 1e-9
        flo = 0.6 + 0.4 * np.sin(TAU * 0.13 * tt)
        mix.add(nz * rum[i0:i1] * flo * 0.05, i0, dry=1.0)
        d = np.sin(TAU * mtof(24) * tt) * rum[i0:i1] * 0.12 + np.sin(TAU * mtof(36) * tt) * rum[i0:i1] * 0.04
        mix.add(d, i0, dry=1.0, hall=0.2)

    # ============================================================ ostinato segments (16ths) + drums
    def ost(t0, t1, rate_fn, roots, pat, amp, cut_fn=None, kick=0.5, thin=False, ascend=False, octave=0):
        i0, i1 = ix(t0), ix(t1)
        tl = t[i0:i1]
        rate = np.minimum(rate_fn(tl), MAX_RATE)
        phase = np.cumsum(rate) / SR
        ticks = np.searchsorted(phase, np.arange(0, phase[-1]))
        for j, off in enumerate(ticks):
            n0 = i0 + int(off)
            bar, st = divmod(j, 16)
            if thin and st % 2:
                continue
            root = (36 + bar) if ascend else roots[bar % len(roots)]
            midi = root + pat[st] + octave
            step = 1.0 / float(rate[min(int(off), len(rate) - 1)])
            dur = min(0.7 * step * (2 if thin else 1), 0.18)
            a_ = amp(n0 / SR) if callable(amp) else amp
            vel = (1.0 if st % 4 == 0 else 0.62) * (1.15 if st == 0 else 1.0) * a_
            ln = ix(dur + 0.04)
            tt = np.arange(ln) / SR
            f = float(mtof(midi))
            y = saw_blep(np.full(ln, f)) * 0.8 + np.sign(np.sin(TAU * f * 0.5 * tt)) * 0.45
            y = tv_filter(y, 230 + (350 + 1900 * vel) * np.exp(-tt / 0.045), 'lp', 1.1, chunk=64)
            y = np.tanh(2.0 * y) * np.exp(-tt / (dur * 0.9)) * (1 - np.exp(-tt / 0.0015))
            c = cut_fn(n0 / SR) if cut_fn else None
            if c:
                y = filt(y, biquad('lp', c, 0.7), biquad('lp', c, 0.7)) * 1.6
            y[-ix(0.01):] *= np.linspace(1, 0, ix(0.01))
            mix.add(pan_stereo(y * 0.24 * vel, 0.0), n0, dry=1.0, hall=0.12, room=0.05)
            if st % 4 == 0 and (callable(kick) or kick > 0):
                ln2 = ix(0.38)
                t2 = np.arange(ln2) / SR
                f2 = 44 + 70 * np.exp(-t2 / 0.035)
                k = np.sin(TAU * np.cumsum(f2) / SR) * np.exp(-t2 / 0.13) * (1 - np.exp(-t2 / 0.001))
                k += filt(R.standard_normal(ln2), biquad('lp', 1800, 0.7)) * np.exp(-t2 / 0.012) * 0.25
                if c:
                    k = filt(k, biquad('lp', max(c, 300), 0.7))
                k[-ix(0.01):] *= np.linspace(1, 0, ix(0.01))
                kg = kick(n0 / SR) if callable(kick) else kick
                mix.add(k * (1.0 if st == 0 else 0.62) * kg * a_, n0, dry=1.0, hall=0.08)

    def lin(a, b, x0, x1):
        return lambda tl: a + (b - a) * np.clip((np.asarray(tl) - x0) / max(x1 - x0, 1e-6), 0, 1)

    if S('firstrow'):
        s = S('firstrow')
        ost(s.t0, s.t1, lin(5.0, 6.0, s.t0, s.t1), ROOTS_H, PAT_A, 0.9, kick=0.55)
    if on:
        split = max(on.t0 + 0.5, on.t1 - 6.0)       # slow-motion part = everything except the final 6 s
        ost(on.t0, split, lambda tl: 3.0 + 0 * np.asarray(tl), ROOTS_H, PAT_A, 0.8, cut_fn=lambda tt: 600.0, kick=0.6)
        w = on.t1 - split
        ost(split, on.t1, lambda tl: 3.0 + 4.2 * np.clip((np.asarray(tl) - split) / w, 0, 1) ** 1.6, ROOTS_H, PAT_A,
            lambda tt: 0.8 + 0.25 * min(1.0, (tt - split) / w),
            cut_fn=lambda tt: 600.0 * (10.0 ** min(1.0, (tt - split) / (0.85 * w))), kick=lambda tt: 0.6 + 0.4 * min(1.0, (tt - split) / w))
        for h in cue.hits_of('sub', on):        # looming sub swell into each slow pulse
            if h['t'] > on.t0 + 0.5 and h['t'] < split + 0.1:
                m = ix(1.4)
                u = np.linspace(0, 1, m)
                sw = np.sin(TAU * 44.0 * np.arange(m) / SR) * u ** 2.2 * 0.35
                mix.add_t(np.stack([sw, sw]), h['t'] - 1.4, dry=1.0)
    if tu:
        ost(tu.t0, tu.t1, lin(6.0, 6.8, tu.t0, tu.t1), ROOTS_D, PAT_A, 0.85, kick=0.5)
    if ro:
        ost(ro.t0, ro.t1, lin(6.8, MAX_RATE, ro.t0, ro.t1), ROOTS_R, PAT_B, 1.0, kick=0.6)
    if fe:
        ost(fe.t0, fe.t1 - 0.3, lambda tl: 6.0 + 0 * np.asarray(tl), None, PAT_A, 0.55, kick=0.2, thin=True, ascend=True, octave=12)
    if gv:      # drums recede
        tk = gv.t0 + 1.0
        fly = gv.t0 + 5.0       # 98-103 distant and hollow; from 103 the fly-through (cue hits carry the 106.1 / 109.7 events)
        while tk < min(gv.t1 - 1.0, fly):
            u = (tk - gv.t0) / gv.len
            put(cue, mix, boom_hit(R), tk, 0.45 * (1 - 0.75 * u), dry=0.8, hall=0.4)
            tk += 2.4

    # ============================================================ distorted hymn: turn, rout, godview (requiem)
    if tu:
        a_t = cue.pts([(tu.t0, 0.0), (tu.t0 + 0.4, 1.0), (tu.t1, 1.0)])
        pad(cue, mix, R, chord_seq(tu.t0, tu.t1, 2.5, DARK_A), 48, 74, 4, 0.20, a_t, 900 + 800 * a_t, att=0.35, rel=0.5, nv=5,
            det=12, drive=2.8, vowel=True, hall=0.4)
    if ro:
        pad(cue, mix, R, chord_seq(ro.t0, ro.t1, 2.0, DARK_B), 50, 80, 5, 0.17, ones, 1500 + 0 * t, att=0.25, rel=0.5, nv=5,
            det=14, drive=3.4, vowel=True, hall=0.35)
    if fe:
        # rising dread line: slow chromatic ascent
        i0, i1 = ix(fe.t0), ix(fe.t1)
        tl = t[i0:i1] - fe.t0
        stair = 48 + np.floor(tl / 1.4)
        mid = smooth_curve(stair, 0.35)
        u = np.clip(tl / fe.len, 0, 1)
        for off in (0, 7):
            f = mtof(mid + off)
            x = supersaw(f, i1 - i0, 4, 10, R, spread=0.8, drift=3.0)
            cc = 500 + 2600 * u
            x = tv_filter(tv_filter(x, cc, 'lp', 0.8, chunk=512), cc, 'lp', 0.6, chunk=512)
            x = np.tanh(1.6 * x)
            e = (0.25 + 0.75 * u) * ar_env(i1 - i0, ix(0.4), i1 - i0 - 1, 1)
            mix.add(x * e * 0.17, i0, dry=1.0, hall=0.45)
    if gv:
        a_g = cue.pts([(gv.t0, 0.0), (gv.t0 + 0.3, 1.0), (gv.t1, 1.0)])
        opening = cue.pts([(fly, 0.0), (gv.t1 - 1.5, 1.0)])      # the fly-through opens the pad up
        pad(cue, mix, R, chord_seq(gv.t0, gv.t1, 3.4, HYMN_A), 36, 84, 6, 0.17, a_g, 1100 + 1300 * a_g + 2200 * opening,
            att=0.5, rel=1.4, nv=5, det=10, drive=2.2, vowel=True, hall=0.8, spread=1.0, hard_end=gv.t1)
        # rushing air: builds from 103 s, peaks at the last ship's death, thins out toward where the droplet rests
        i0, i1 = ix(fly), ix(gv.t1)
        u = np.linspace(0, 1, i1 - i0)
        tl_ = max([h['t'] for h in cue.hits_of('boom', gv)] + [fly + 3.0])       # last ship dies: the rush dips so the boom reads
        rush_env = cue.pts([(fly, 0.0), (tl_ - 1.0, 1.0), (tl_, 0.45), (gv.t1 - 0.3, 0.25), (gv.t1, 0.0)])[i0:i1]
        rush = bandnoise(i1 - i0, 500 * (6000 / 500) ** np.minimum(u * 1.6, 1.0), 0.9, R) * rush_env ** 1.5
        mix.add(rush * 0.08, i0, dry=1.0, hall=0.4)

    # ============================================================ hits
    for h in cue.hits:
        k, g, tt = h['kind'], h['gain'], h['t']
        sec = cue.sec_at(tt)
        if k == 'sub':
            put(cue, mix, sub_hit(R, f_lo=30), tt, 0.62 * g, dry=1.0, ring_tau=0.12)
        elif k == 'boom':
            put(cue, mix, boom_hit(R), tt, 0.85 * g, dry=1.0, hall=0.2, room=0.1, ring_tau=0.12)
        elif k == 'impact':
            if sec.name == 'hull':      # the single biggest hit: layered
                put(cue, mix, impact_hit(R, pre=1.2, tail=8.0), tt, 1.45 * g, dry=1.0, hall=0.4, room=0.12)
                put(cue, mix, sub_hit(R, f_lo=28, tail=7.0), tt, 0.9, dry=1.0)
                put(cue, mix, boom_hit(R), tt, 0.7, dry=1.0, hall=0.3)
            else:      # an impact right behind another one gets a short pre-swell so it does not smear the first
                close = any(0 < tt - o['t'] < 1.0 for o in cue.hits_of('impact'))
                put(cue, mix, impact_hit(R, pre=0.15 if close else 0.9), tt, 1.0 * g, dry=1.0, hall=0.3, room=0.1)
        elif k == 'glass':
            put(cue, mix, glass_hit(R, 84), tt, 0.15 * g, dry=0.7, hall=0.9)
        elif k == 'swell':
            notes = lead(None, chord_at(tt), 43, 76, 5) if fleet_ch else [48, 55, 63, 67, 72]
            bloom(cue, mix, R, notes, tt, min(3.0, max(tt - 0.3, 0.4)), 2.5, 0.20 * g, 400, 2600, vowel=True, hall=0.8)
    for r in cue.risers:      # character by the section the riser starts in
        name = cue.sec_at(r['from']).name
        if name == 'ignition':       # tension, then a whip
            put_riser(cue, mix, r, R, f_lo=400, f_hi=6500, tone=(523.25, 1046.5), noise=0.25, tone_amp=0.08)
        elif name == 'hull':         # near silence, a held high tone that tightens into the fusion blast
            put_riser(cue, mix, r, R, f_lo=900, f_hi=4500, tone=(1046.5, 1568.0), noise=0.08, tone_amp=0.10, hall=0.5)
        elif name == 'godview':      # rushing air, rising motion
            put_riser(cue, mix, r, R, f_lo=250, f_hi=7000, tone=(261.6, 523.3), noise=0.45, tone_amp=0.06)
        elif name == 'fleeing':
            put_riser(cue, mix, r, R, f_lo=250, f_hi=5500, tone=(196.0, 392.0), noise=0.3, tone_amp=0.10)
        else:
            put_riser(cue, mix, r, R, f_lo=250, f_hi=5500, tone=(130.8, 261.6), noise=0.3, tone_amp=0.10)
