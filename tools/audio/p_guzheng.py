"""Operation Guzheng: D minor pentatonic, solo plucked guzheng (Karplus-Strong) over a bowed drone."""
import numpy as np
from dsp import *
from engine import *
from common import *

D4, F4, G4, A4, C5, D5 = 62, 65, 67, 69, 72, 74
PENTA = [0, 2, 5, 7, 9]  # D F G A C pitch classes: 2,5,7,9,0 -> stored as pcs below
PCS = {0, 2, 5, 7, 9}
_cache = {}


def gz_note(midi, dur, vel=0.7, pb=0, vib=0, variant=0, t60=None):
    key = (midi, round(dur, 2), round(vel, 2), pb, vib, variant, t60)
    if key in _cache:
        return _cache[key]
    f = float(mtof(midi))
    rng = np.random.default_rng(7000 + midi * 13 + variant)
    t60 = t60 or float(np.interp(midi, [40, 62, 84], [10, 7, 3.8]))
    y = ks(f, dur, t60, rng, pick=0.10 + 0.16 * rng.random(), bright=0.30 + 0.55 * vel)
    t = np.arange(len(y)) / SR
    u = np.clip(t / 0.28, 0, 1)
    cents = -pb * (1 - u * u * (3 - 2 * u))
    tv = np.clip(t - 0.35, 0, None)
    cents = cents + vib * np.clip(tv / 0.4, 0, 1) * np.exp(-tv / 1.9) * np.sin(TAU * 5.3 * t) * (t > 0.35)
    if pb or vib:
        y = warp(y, cents)
    y = tv_filter(y, 900 + (2200 + 5200 * vel) * np.exp(-t / 1.0), 'lp', 0.7)
    y = filt(y, biquad('peak', 190, 1.2, 3.5), biquad('peak', 430, 1.4, 3.0), biquad('peak', 2900, 1.0, -3.5))
    y[-ix(0.03):] *= np.linspace(1, 0, ix(0.03))
    _cache[key] = y
    return y


def compose(cue, mix, R):
    N = cue.N
    t = np.arange(N) / SR
    S = cue.sec
    sl_ = cue.sec('slide')

    def pluck(tt, midi, gain=1.0, dur=None, hall=0.5, room=0.15, **kw):
        if tt >= cue.dur - 0.5:
            return
        dur = dur or float(np.interp(midi, [40, 62, 84], [9.0, 7.0, 4.5]))
        y = gz_note(midi, dur, **kw)
        pan = np.clip((midi - 66) / 40.0, -0.5, 0.5)
        mix.add_t(pan_stereo(y * gain, pan), tt, dry=1.0, hall=hall, room=room, duck=not exempt(cue, tt))

    # ---------------- drone (bowed strings) ----------------
    base = cue.curve({'title': .5, 'canal': .5, 'strings': .55, 'approach': 1.0, 'contact': 0.0,
                      'passing': .3, 'slide': 1.0, 'aftermath': .45, 'endcard': .38}, 0.5, fade=1.6)
    gate = cue.curve(lambda s: 0.0 if s.name == 'contact' else 1.0, 1.0, fade=0.35)
    amp = np.minimum(base, gate)
    amp *= cue.pts([(0, 0), (0.4, 0), (4.0, 1), (cue.dur, 1)])
    ec = S('endcard')
    amp *= cue.end_fade((ec.t0 + 1.5) if ec else cue.dur - 6, cue.dur - 0.5)
    amp = np.clip(amp, 0, None)
    bow_lfo = 1 + 0.12 * np.sin(TAU * 0.17 * t + 0.6) + 0.07 * np.sin(TAU * 0.41 * t + 2.0)
    bright = cue.curve({'title': .55, 'canal': .6, 'strings': .75, 'approach': 1.1, 'passing': .5,
                        'slide': 1.7, 'aftermath': .5, 'endcard': .45}, .5, fade=2.0)

    def bowed(midi, a_curve, gain, nv=4, det=7, cut_mul=1.0):
        f = float(mtof(midi))
        x = supersaw(f, N, nv, det, R, spread=0.7, drift=2.5)
        x = tv_filter(x, (260 + 900 * bright * cut_mul) * (1 + 0.25 * np.sin(TAU * 0.11 * t + midi)), 'lp', 0.9, chunk=512)
        x = x * (a_curve * bow_lfo * gain)
        mix.add(x, 0, dry=1.0, hall=0.28, room=0.0)

    bowed(38, amp, 0.17, nv=4, det=7)
    bowed(50, amp * 0.55, 0.19, nv=4, det=8, cut_mul=0.9)
    fifth = amp * cue.curve({'strings': .8, 'approach': 1.0, 'slide': 1.0, 'aftermath': .35}, 0.0, fade=2.0)
    bowed(45, fifth, 0.18, nv=3, det=9)
    bowed(57, fifth * 0.6, 0.12, nv=3, det=10)
    eb = amp * cue.curve({'passing': 1.0}, 0.0, fade=2.5)
    if sl_:
        eb = np.maximum(eb, amp * cue.pts([(sl_.t0 + 5, 0), (sl_.t0 + 5.1, 0.5), (sl_.t1, 0.5)]) * (sl_.t1 > sl_.t0 + 5))
    bowed(39, eb, 0.26, nv=4, det=9)
    # bow noise: breathy bandpassed rosin hiss around the drone harmonics
    bn = bandnoise(N, 420, 2.0, R) * amp * 0.035
    mix.add(bn, 0, dry=1.0, hall=0.2)

    # ---------------- hit plucks ----------------
    pk_pitch = {'title': [D4, 57], 'strings': [A4, C5, D5], 'endcard': [D4]}
    cnt = {}
    for h in cue.hits_of('pluck'):
        s = cue.sec_at(h['t'])
        i = cnt.get(s.name, 0)
        cnt[s.name] = i + 1
        lst = pk_pitch.get(s.name, [D4])
        pluck(h['t'], lst[min(i, len(lst) - 1)], 0.95 * h['gain'], vel=0.55 + 0.3 * h['gain'],
              pb=60 if s.name == 'strings' else 0, vib=22,
              t60=(14.0 if s.name == 'endcard' else None))

    # ---------------- canal phrase and its slower return ----------------
    P = [(0.3, D4, .65, 0, 22), (1.9, A4, .6, 130, 28), (3.5, G4, .55, 0, 25),
         (4.6, F4, .55, 0, 20), (5.9, G4, .5, 70, 24), (7.0, D4, .6, 0, 26)]
    c = S('canal')
    if c:
        for (dt, m, v, pb, vib) in P:
            if c.t0 + dt < c.t1 - 0.4:
                pluck(c.t0 + dt, m, 0.85 * v / .6, vel=v, pb=pb, vib=vib)
    a = S('aftermath')
    if a:
        for (dt, m, v, pb, vib) in P[:3]:
            tt = a.t0 + 0.5 + dt * 1.35
            if tt < a.t1 - 0.6:
                pluck(tt, m, 0.8 * v / .6, vel=v * 0.85, pb=pb, vib=vib, t60=11.0)

    # ---------------- approach: heartbeat + rising tremolo figure ----------------
    ap = S('approach')
    if ap:
        k = 0
        tb = ap.t0 + 1.2
        while tb < ap.t1 - 0.3:
            u = (tb - ap.t0) / ap.len
            for off, g in ((0.0, 1.0), (0.31, 0.6)):
                n = ix(0.5)
                tt = np.arange(n) / SR
                f = 40 + 26 * np.exp(-tt / 0.07)
                s = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-tt / 0.13) * (1 - np.exp(-tt / 0.003))
                s = np.stack([s, s]) * g * (0.35 + 0.65 * u) * 0.75
                mix.add_t(s, tb + off, dry=1.0, hall=0.05)
            tb += 1.2
        steps = [D4, F4, G4, A4, C5, D5]
        t_start = ap.t0 + 2.4
        t_end = ap.t1 - 0.25
        tt = t_start
        j = 0
        while tt < t_end:
            u = (tt - t_start) / (t_end - t_start)
            rate = 9.5 + 3.5 * u
            m = steps[min(int(u * len(steps)), len(steps) - 1)]
            pluck(tt, m + (12 if u > 0.8 and False else 0), 0.20 + 0.34 * u, dur=0.5, vel=0.45 + 0.4 * u,
                  variant=j % 3, hall=0.4, room=0.1, t60=2.2)
            tt += 1.0 / rate
            j += 1

    # ---------------- contact: glassy sustained tone + metallic shimmer ----------------
    co = S('contact')
    if co:
        sil_end = max([s['to'] for s in cue.silences if co.t0 - 0.01 <= s['from'] <= co.t0 + 0.2] + [co.t0])
        tone_env = cue.curve({'contact': 1.0}, 0.0, fade=1.2) * cue.pts([(sil_end, 0), (sil_end + 1.6, 1), (cue.dur, 1)])
        tm = 0.5 * (np.sin(TAU * 1760.0 * t) + np.sin(TAU * 1761.3 * t + 1.0)) + 0.09 * np.sin(TAU * 2640.0 * t) \
            + 0.05 * np.sin(TAU * 3520.0 * t + 0.3)
        tm = tm * tone_env * (1 + 0.15 * np.sin(TAU * 0.23 * t))
        mix.add(np.stack([tm, np.roll(tm, 17)]) * 0.075, 0, dry=1.0, hall=0.85)
        shim = bandnoise(N, 5200 + 700 * np.sin(TAU * 0.2 * t), 6.0, R) * tone_env * 0.02 * (0.6 + 0.4 * np.sin(TAU * 4.7 * t))
        mix.add(shim, 0, dry=0.6, hall=0.9)
        # faint low breath so the silence is not a hole
    ps = S('passing')
    if ps:
        for fr, m in ((0.22, 81), (0.55, 87), (0.8, 86)):
            pluck(ps.t0 + fr * ps.len, m, 0.34, vel=0.5, pb=0, vib=14, hall=0.7, room=0.1, t60=4.0)

    # ---------------- slide: tremolo strings, screech, glissandi ----------------
    if sl_:
        rs = [r for r in cue.risers if abs(r['to'] - sl_.t0) < 0.2]
        rf = rs[0]['from'] if rs else sl_.t0
        gate_s = cue.curve({'slide': 1.0}, 0.0, fade=0.25)
        pre = cue.pts([(rf - 0.01, 0), (rf, 0), (sl_.t0 - 0.02, 0.45), (sl_.t0, 0.45), (sl_.t0 + 0.01, 0)])
        s_amp = np.maximum(gate_s, pre) * (t < sl_.t1 + 2)
        imp = [h['t'] for h in cue.hits if h['kind'] == 'impact' and sl_.t0 <= h['t'] < sl_.t1]
        bounds = [rf] + [x for x in imp if x > sl_.t0 + 0.5] + [sl_.t1 + 0.4]
        pcs_list = [[2, 5, 9], [7, 2, 10], [2, 3, 9], [2, 5, 9, 0]]
        chords = [(bounds[i], bounds[i + 1], pcs_list[i % 4]) for i in range(len(bounds) - 1)]
        trem = 0.45 + 0.55 * (0.5 + 0.5 * np.sin(TAU * 13.0 * t)) ** 1.4
        for (t_on, t_off, m) in voice_notes(chords, 50, 80, k=5):
            n0, n1 = ix(t_on), ix(t_off + 0.7)
            ln = n1 - n0
            x = supersaw(float(mtof(m)), ln, 5, 24, R, spread=0.9, drift=5)
            cut = (1500 + 1500 * s_amp[n0:n1])
            x = tv_filter(x, cut, 'lp', 0.8, chunk=512)
            e = ar_env(ln, ix(0.5), ix(t_off - t_on), ix(0.7))
            mix.add(x * (e * s_amp[n0:n1] * trem[n0:n1] * 0.2), n0, dry=1.0, hall=0.35, room=0.1)
        # metallic screech
        sc_env = np.maximum(gate_s, pre * 0.8)
        flut = 0.6 + 0.4 * np.sin(TAU * 7.3 * t + 1.0 * np.sin(TAU * 0.9 * t))
        for fc0, fm, rt in ((2300, 700, 0.31), (3100, 450, 0.23), (1650, 300, 0.17)):
            nz = bandnoise(N, fc0 + fm * np.sin(TAU * rt * t), 28.0, R)
            mix.add(nz * sc_env * flut * 0.075, 0, dry=0.7, hall=0.45)
        # fast glissandi across all strings
        gl_t = [x + 0.12 for x in imp] + [sl_.t0 + 0.35 * sl_.len, sl_.t0 + 0.8 * sl_.len, sl_.t0 + 0.98 * sl_.len - 0.6]
        allm = [m for m in range(50, 87) if (m % 12) in PCS]
        for gi, g0 in enumerate(sorted(gl_t)):
            if g0 > sl_.t1 - 0.3:
                continue
            seq = allm if gi % 2 == 0 else allm[::-1]
            dt = 0.052
            tt = g0
            for j, m in enumerate(seq):
                pluck(tt, m, 0.38 + 0.15 * (j / len(seq)), dur=2.4, vel=0.8, variant=gi % 2, hall=0.55, room=0.15, t60=3.5)
                tt += dt
                dt *= 0.96

    # ---------------- hits ----------------
    gl_pitch = {'strings': 88, 'contact': 93}
    for h in cue.hits:
        k, g, tt = h['kind'], h['gain'], h['t']
        if k == 'sub':
            put(cue, mix, sub_hit(R), tt, 0.5 * g, dry=1.0, hall=0.0)
        elif k == 'boom':
            put(cue, mix, boom_hit(R, 0.6), tt, 0.75 * g, dry=1.0, hall=0.18, room=0.1)
        elif k == 'impact':
            put(cue, mix, impact_hit(R, subg=0.6), tt, 0.95 * g, dry=1.0, hall=0.3, room=0.1)
        elif k == 'glass':
            put(cue, mix, glass_hit(R, gl_pitch.get(cue.sec_at(tt).name, 88)), tt, 0.14 * g, dry=0.7, hall=0.9)
    for r in cue.risers:
        late = r['to'] > 30
        put_riser(cue, mix, r, R, f_lo=300, f_hi=6500 if late else 4200, tone=(520, 1500) if late else (150, 330),
                  noise=0.22 if late else 0.14, tone_amp=0.07 if late else 0.07, gain=1.0)
