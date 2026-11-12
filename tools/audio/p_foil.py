"""Dimensional Strike: A minor / dorian elegy. Cold open on the Sun's peak, felt piano, wide strings,
glass bells, a descending Shepard tone, Jupiter's revolving figure, the human-scale 'witness' passage. No drums."""
import numpy as np
from dsp import *
from engine import *
from common import *

AM9 = [9, 0, 4, 11]
FMAJ7 = [5, 9, 0, 4]
CMAJ9 = [0, 4, 7, 2]
D6 = [2, 6, 9, 11]          # D F# A B  (dorian colour)
EM7 = [4, 7, 11, 2]
AMAJ9 = [9, 1, 4, 11]       # resolved: C# arrives
DADD9 = [2, 6, 9, 4]
SUS = [9, 2, 4, 7]          # A D E G: unresolved held chord
B = 1.05                    # beat (s)
RIDE_OVERRIDES = {'witness': -28.0, 'endcard': -26.0}

A1 = [(0.3, 76, 1.5), (1.8, 72, 1), (2.8, 74, 1), (3.8, 76, 1.5)]
A2 = [(0.3, 72, 1), (1.3, 69, 2.2)]
M_END = [(0.3, 76, 1), (1.3, 74, 1), (2.3, 71, 3.5)]
B1 = [(0.3, 74, 1.5), (1.8, 78, 1), (2.8, 81, 1.5)]
B2 = [(0.3, 79, 1), (1.3, 76, 1), (2.3, 74, .8), (3.1, 76, 2.2)]
C_EARTH = [(0.4, 76, 1.2), (1.6, 79, 0.8), (2.4, 81, 1.6), (4.0, 79, 0.8), (4.8, 76, 1.2), (6.0, 74, 1.0), (7.0, 72, 1.5),
           (8.8, 74, 1.0), (9.8, 76, 1.5), (11.3, 79, 1.0), (12.4, 76, 1.2), (13.6, 72, 1), (14.6, 69, 2.5)]
M_PAINT = [(0.4, 85, 2.2), (2.8, 81, 2.4), (6.2, 88, 1.3), (7.5, 85, 2.0), (9.6, 81, 3.0)]   # rests at ~136.1 for the ping
W_SLOW = [(0.4, 69, 1.8), (2.2, 72, 1.4), (3.6, 71, 1.4), (5.0, 69, 3.0)]


def chord_list(t0, t1, step, prog):
    n = max(1, int(round((t1 - t0) / step)))
    ed = np.linspace(t0, t1, n + 1)
    return [(float(ed[i]), float(ed[i + 1]), prog[i % len(prog)]) for i in range(n)]


def compose(cue, mix, R):
    N = cue.N
    t = np.arange(N) / SR
    S = cue.sec
    hook, calm, foil, nep, sat, jup, ear, wit, snw, sun, pai, ec = (S(n) for n in (
        'hook', 'calm', 'foil', 'neptune', 'saturn', 'jupiter', 'earth', 'witness', 'snow', 'sun', 'painting', 'endcard'))
    pn = np.zeros((2, N))
    pd = np.zeros((2, N))

    def piano(tt, midi, dur_s, vel, gain=1.0, dry=False):
        if tt >= cue.dur - 0.5 or tt < 0:
            return
        dur = float(min(dur_s + 3.8, 7.0))
        y = felt_piano(float(mtof(midi)), dur, vel, R)
        st = pan_stereo(y * gain, float(np.clip((midi - 72) / 40.0, -0.4, 0.4)))
        n0 = ix(tt)
        n1 = min(N, n0 + st.shape[1])
        (pd if dry else pn)[:, n0:n1] += st[:, :n1 - n0]

    def seq(sec, phs, tr=0, gain=1.0, start=0.0, gap=1.0, vel_base=0.55, stretch=1.0, dry=False, min_fit=0.7):
        if not sec:
            return
        conv = [[(bt * B * stretch, m, ln * B * stretch) for (bt, m, ln) in ph] for ph in phs]

        def place(t0, notes):
            for (dt, m, ln) in notes:
                piano(t0 + dt, m + tr, ln, vel_base + 0.12 * np.sin(dt * 1.7), gain, dry)
        fill_phrases(sec, conv, place, start=start, gap=gap * B, min_fit=min_fit)

    # ------------------------------------------------------------ chords timeline (main string chain)
    # jupiter's three phases (40-46 descent, 46-60 sinking, 60-66 revolving): touch-down sub +1.4 s, last swell +0.3 s
    j0 = j1 = j2 = None
    if jup:
        j0 = jup.t0
        jsub = [h['t'] for h in cue.hits_of('sub', jup)]
        jsw = [h['t'] for h in cue.hits_of('swell', jup)]
        j1 = jsub[0] + 1.4 if jsub else jup.t0 + 0.23 * jup.len
        j2 = jsw[-1] + 0.3 if jsw else jup.t0 + 0.77 * jup.len
    chords = []
    if jup:
        chords += [(j0, j1, AM9), (j1, j2, FMAJ7), (j2, jup.t1, AM9)]
    for sec, step, prog in ((nep, 4.0, [AM9, FMAJ7]), (sat, 5.0, [FMAJ7, CMAJ9]),
                            (ear, 4.0, [AM9, D6, FMAJ7, EM7]), (snw, 4.0, [D6, AM9]),
                            (sun, 3.0, [FMAJ7, AM9, D6]), (pai, 3.0, [D6, FMAJ7, DADD9, AMAJ9]), (ec, 99.0, [AMAJ9])):
        if sec:
            chords += chord_list(sec.t0, sec.t1, step, prog)
    hook_ch = chord_list(hook.t0, hook.t1 + 0.4, 2.9, [AM9, FMAJ7]) if hook else []

    def chord_at(tt):
        for a, b, p in hook_ch + chords:
            if a <= tt + 0.01 < b:
                return p
        return AM9

    # ------------------------------------------------------------ melody
    seq(calm, [A1, A2], 0, 0.9, start=0.9, gap=0.6)
    seq(foil, [M_END], 0, 0.85, start=0.2)
    seq(sat, [B1, B2, A2], 12, 0.8, start=0.4, vel_base=0.5, gap=0.8)
    seq(ear, [C_EARTH], 0, 1.15, start=0.2, vel_base=0.62, min_fit=0.5)
    if ear:
        for bt, m in ((0.0, 57), (3.0, 52), (6.0, 53), (9.0, 52)):
            if ear.t0 + bt * B < ear.t1 - 1:
                piano(ear.t0 + bt * B, m, 3 * B, 0.4, 0.8)
    seq(pai, [M_PAINT], 0, 0.8, start=0.3, vel_base=0.5, min_fit=0.5)

    # ------------------------------------------------------------ witness phases (derived from the hits inside the section)
    ph = {}
    if wit:
        sw = [h['t'] for h in cue.hits_of('swell', wit)]
        gl = [h['t'] for h in cue.hits_of('glass', wit) if h['t'] > wit.t0 + 0.5]
        sb = [h['t'] for h in cue.hits_of('sub', wit)]
        sil = [s for s in cue.silences if wit.t0 <= s['from'] < wit.t1]
        L = wit.len
        hold_end = sil[0]['from'] if sil else wit.t0 + 0.857 * L
        gl_pre = [g_ for g_ in gl if g_ < hold_end]
        # 82-88 piano alone | 88-94 edge overtakes (swell at 90): pad + Shepard + bells | 94-100 fullest |
        # 100-103.6 ring closes | sub at 103.6 -> held chord, silence | 106-110 one soft note
        p2 = (sw[0] - 2.0) if sw else wit.t0 + 0.214 * L
        p3 = gl_pre[-1] if len(gl_pre) >= 2 else wit.t0 + 0.5 * L
        p4 = (sb[0] - 3.6) if sb else wit.t0 + 0.714 * L
        p5 = gl[-1] if len(gl) >= 2 else wit.t0 + 0.857 * L
        ph = dict(p2=p2, p3=p3, p4=p4, p5=p5, hold_end=hold_end, tsub=(sb[0] if sb else hold_end))
        stretch = min(1.0, max(0.6, (p2 - wit.t0 - 1.5) / 5.4))
        seq(wit, [W_SLOW], 0, 1.0, start=0.5, vel_base=0.5, stretch=stretch, dry=True, min_fit=0.5)

    # piano buses
    lp = np.array([biquad('lp', 3200, 0.7)])
    echo = np.zeros_like(pn)
    for rep, (d, g) in enumerate(((0.63, 0.34), (1.26, 0.18), (1.89, 0.09))):
        sh = ix(d)
        src = pn[::-1] if rep % 2 == 0 else pn
        echo[:, sh:] += src[:, :N - sh] * g
    echo = signal.sosfilt(lp, echo, axis=-1)
    mix.add(pn * 0.55, 0, dry=1.0, hall=0.55, room=0.15)
    mix.add(echo * 0.55, 0, dry=0.8, hall=0.6)
    mix.add(pd * 0.62, 0, dry=1.0, hall=0.08, room=0.04)      # close and dry

    # ------------------------------------------------------------ strings pad
    names_amp = {'neptune': .55, 'saturn': .8, 'jupiter': .35, 'earth': .55, 'snow': .45, 'sun': 1.0, 'painting': .62, 'endcard': .22}
    pad_amp = cue.curve(names_amp, 0.0, fade=2.0)
    ecf = cue.end_fade(ec.t0 + 1.0 if ec else cue.dur - 6, cue.dur - 0.5)
    if ear:      # 78-82: the last cap of Earth, only the melody line is left
        pad_amp *= 1 - 0.65 * cue.pts([(ear.t1 - 4.0, 0), (ear.t1 - 0.5, 1)])
    pad_amp *= ecf
    cut = 850 + 1500 * pad_amp
    pad(cue, mix, R, chords, 52, 79, 4, 0.19, pad_amp, cut, att=2.2, rel=2.6, nv=5, det=9, hall=0.8, room=0.1, q=0.6)
    if sun:
        wide = [c for c in chords if sun.t0 - 1e-6 <= c[0] < sun.t1]
        sw_ = cue.curve({'sun': 1.0}, 0.0, fade=1.0) * np.clip(cue.pts([(sun.t0 - 2, 0), (sun.t0 + 2.5, 1)]), 0, 1)
        pad(cue, mix, R, wide, 64, 88, 3, 0.07, sw_, 1200 + 2200 * sw_, att=2.0, rel=2.5, nv=5, det=10, hall=0.9, q=0.6)
    if hook:     # cold open: sun-peak voicing at full weight from the first sample
        hw = cue.curve({'hook': 1.0}, 0.0, fade=0.1)
        pad(cue, mix, R, hook_ch, 45, 88, 6, 0.15, hw, 1500 + 1700 * hw, att=0.6, rel=0.8, nv=5, det=10, hall=0.85,
            q=0.6, att_first=0.004)
    # brass-like low figure for Jupiter's first two thirds
    if jup:
        ja = cue.pts([(j0 - 0.01, 0), (j0, 1), (j2 - 0.5, 1), (j2 + 1.0, 0.0)]) * (t >= j0 - 0.01)
        pad(cue, mix, R, [(j0, j1, [9, 0, 4]), (j1, (j1 + j2) / 2, [5, 9, 0]), ((j1 + j2) / 2, j2, [9, 0, 4])], 36, 64, 4, 0.20, ja, 1500 + 0 * t,
            att=0.9, rel=1.8, nv=5, det=7, hall=0.6, brass=(450, 1700, 1.6))
        # revolving three-note figure over the last third: one revolution every 4 s
        P = 4.0 / 3
        kk, tk = 0, j2
        notes3 = [57, 64, 71]
        while tk < jup.t1 - 0.5:
            m = notes3[kk % 3]
            ln = ix(2.4)
            n0 = ix(tk)
            x = supersaw(float(mtof(m)), ln, 3, 6, R, spread=0.5).sum(0) * 0.6
            tl = tk + np.arange(ln) / SR
            theta = TAU * tl / 4.0
            x = tv_filter(x, 700 + 450 * (np.cos(theta) + 1), 'lp', 0.8, chunk=512)
            x = tv_filter(x, 1400 + 0 * theta, 'lp', 0.7, chunk=512)
            e = ar_env(ln, ix(0.45), ix(1.1), ix(1.2)) * min(1.0, 0.5 + 0.5 * (tk - j2) / 3.0)
            ang = (np.sin(theta) + 1) * np.pi / 4
            st = np.stack([x * np.cos(ang), x * np.sin(ang)]) * e * 0.20
            mix.add(st, n0, dry=1.0, hall=0.8, room=0.1)
            tk += P
            kk += 1

    # pedal bass
    bass_amp = cue.curve({'hook': 1.0, 'neptune': .15, 'saturn': .35, 'jupiter': .6, 'earth': .2, 'sun': 1.0,
                          'painting': .5, 'endcard': .18}, 0.0, fade=2.5)
    if wit:
        bass_amp += cue.pts([(ph['p2'], 0), (ph['p2'] + 4, 0.25), (ph['p4'], 0.3), (ph['p4'] + 1.0, 0.45),
                             (ph['hold_end'] - 0.05, 0.45), (ph['hold_end'], 0)]) * (t >= ph['p2']) * (t < ph['hold_end'])
    bass_amp *= ecf
    b = np.sin(TAU * mtof(33) * t) * 0.8 + np.sin(TAU * mtof(45) * t) * 0.35 + np.sin(TAU * mtof(57) * t + 1.0) * 0.1
    mix.add(b * bass_amp * 0.21, 0, dry=1.0, hall=0.05)

    # ------------------------------------------------------------ witness: room tone, pad, shepard, arpeggios, held chord
    if wit:
        rt = cue.curve({'witness': 1.0}, 0.0, fade=1.5)
        slow = 0.7 + 0.3 * smooth_curve(R.standard_normal(N), 2.0) / 0.1
        slow = np.clip(slow, 0.4, 1.3)
        city = bandnoise(N, 650, 0.8, R) * rt * slow * 0.010
        mix.add(city, 0, dry=1.0, hall=0.15)
        p2, p3, p4, p5, he = ph['p2'], ph['p3'], ph['p4'], ph['p5'], ph['hold_end']
        wch = [(p2, p3, AM9)] + chord_list(p3, p4, (p4 - p3) / 2, [D6, FMAJ7]) + [(p4, he, SUS)]
        wamp = cue.pts([(p2 - 0.01, 0), (p2, 0.0), (p2 + 4, 0.5), (p3, 0.6), (p4, 0.85), (he, 0.85)]) * (t >= p2) * (t < he)
        pad(cue, mix, R, wch, 40, 68, 4, 0.19, wamp, 700 + 1100 * wamp, att=2.0, rel=2.0, nv=5, det=8, hall=0.9, q=0.6,
            hard_end=he)
    # ------------------------------------------------------------ Shepard tone
    fo = foil
    if fo:
        env = cue.curve({'foil': .35, 'neptune': .5, 'saturn': .55, 'jupiter': .5, 'earth': .38, 'snow': .38, 'sun': .8, 'painting': .5,
                         'endcard': .38}, 0.0, fade=2.5)
        env *= np.clip(cue.pts([(fo.t0, 0), (fo.t0 + 0.5, 0), (fo.t0 + 6.0, 1)]), 0, 1) * (t >= fo.t0 - 0.01)
        if wit:
            ts_ = ph['tsub']
            env += cue.pts([(p2, 0), (p2 + 3, .45), (p3, .5), (p3 + 2, .55), (ts_, .55), (ts_ + 0.6, 0)]) * (t >= p2) * (t < ts_ + 0.6)
        env *= ecf
        i0 = ix(fo.t0)
        sh = shepard(N - i0, f_min=27.5, octs=8.0, center=3.5, sigma=1.15, period=11.0, direction=-1, rng=R, width=0.85)
        sh = filt(sh, biquad('lp', 2600, 0.7), biquad('hp', 55, 0.7))
        mix.add(sh * env[i0:] * 0.22, i0, dry=1.0, hall=0.6)
    if hook:
        n1 = ix(hook.t1 + 0.3)
        sh = shepard(n1, f_min=27.5, octs=8.0, center=3.5, sigma=1.15, period=11.0, direction=-1, rng=R, width=0.85, t_off=30.0)
        sh = filt(sh, biquad('lp', 2600, 0.7), biquad('hp', 55, 0.7))
        mix.add(sh * cue.curve({'hook': 0.8}, 0.0, fade=0.1)[:n1] * 0.22, 0, dry=1.0, hall=0.6)

    # ------------------------------------------------------------ crystallising bell arpeggios
    def arp(t0, notes, dt, gain, k):
        for j, m in enumerate(notes):
            g = gain * (np.sin(np.pi * (j + 0.6) / (len(notes) + 0.4)) + 0.4)
            y = bell(float(mtof(m)), 5.0, R, t60=(5.0, 3.0, 2.0, 1.2))
            mix.add_t(pan_stereo(y * g, float(np.sin(k * 2.1 + j * 1.3)) * 0.6), t0 + j * dt, dry=0.8, hall=1.0, room=0.1)
            dt *= 0.93

    sets = [[81, 84, 88, 91, 93], [76, 79, 83, 88, 91, 95], [81, 84, 88, 91, 93, 96]]
    if snw:      # ice crystallising: bell arpeggios over a quiet pad, denser as the snowflakes bloom (most by ~115 s)
        tt = snw.t0 + 1.2
        k, gap, dt0 = 0, 1.8, 0.21
        while tt < snw.t1 - 0.8:
            arp(tt, sets[k % 3], dt0, 0.030, k)
            tt += gap
            gap = max(0.7, gap * 0.8)
            dt0 = max(0.11, dt0 * 0.95)
            k += 1
    if wit:
        tt, k, gap = p2 + 1.2, 0, 2.2      # 88-100: bells getting faster and faster
        while tt < p4 - 0.3:
            arp(tt, sets[k % 3], 0.11, 0.022 + 0.004 * k, k + 5)
            tt += gap
            gap = max(0.8, gap * 0.85)
            k += 1

    # ------------------------------------------------------------ one held high note (endcard)
    if ec:
        hold = cue.pts([(ec.t0, 0), (ec.t0 + 2.5, 1), (cue.dur, 1)]) * (t >= ec.t0) * cue.end_fade(ec.t0 + 2.0, cue.dur - 0.5)
        f0 = float(mtof(93))
        hn = (np.sin(TAU * f0 * t) + 0.5 * np.sin(TAU * f0 * 1.0006 * t + 1) + 0.04 * np.sin(TAU * 2 * f0 * t)) * hold
        mix.add(np.stack([hn, np.roll(hn, 13)]) * 0.05, 0, dry=0.8, hall=1.0)

    # ------------------------------------------------------------ hits (all soft; no percussive broadband)
    glass_p = {'calm': 88, 'foil': 83, 'jupiter': 86, 'earth': 93, 'painting': 93}
    wcount = 0
    for h in cue.hits:
        k, g, tt = h['kind'], h['gain'], h['t']
        sec = cue.sec_at(tt)
        if k == 'sub':
            put(cue, mix, sub_hit(R, soft=True, f_lo=38.0, drop=14.0), tt, 0.4 * g, dry=1.0, ring_tau=0.5)
        elif k == 'glass':
            if sec.name == 'witness':
                m = [81, 91, 93][min(wcount, 2)]
                gg = 0.09 if tt > 100 else 0.20
                wcount += 1
            elif sec.name == 'painting' and tt > pai.t0 + 4:      # the lightspeed ship: one bright, hopeful ping
                m, gg = 100, 0.12
            else:
                m, gg = glass_p.get(sec.name, 88), 0.30      # pings must read over the bed (checked: >= +6 dB in the >1.8 kHz band)
            put(cue, mix, glass_hit(R, m, dur=8.0), tt, gg * g, dry=0.8, hall=1.0)
        elif k == 'swell':
            if sec.name in ('hook', 'sun'):
                bloom(cue, mix, R, [45, 52, 57, 64, 71, 76, 81], tt, 3.5, 4.2 if sec.name == 'hook' else 3.0, 0.13 * g,
                      700 if sec.name == 'hook' else 500, 3200, hall=0.9)
            elif sec.name == 'jupiter':
                bloom(cue, mix, R, [33, 45, 52, 57, 64, 69], tt, min(9.0, tt - sec.t0), 3.2, 0.15 * g, 400, 2600, hall=0.9)
            elif sec.name == 'witness':
                bloom(cue, mix, R, lead(None, AM9, 40, 66, 4), tt, min(3.0, tt - ph.get('p2', tt - 3.0)), 3.0, 0.08 * g, 400, 1400, hall=0.9)
            elif sec.name == 'snow':     # the flat Earth's core wells up: short bloom, the passage before it is bare
                bloom(cue, mix, R, lead(None, chord_at(tt), 55, 79, 5), tt, 1.5, 3.0, 0.09 * g, 500, 2400, hall=0.9)
            elif sec.name == 'painting':     # quick upward bloom with the ping
                bloom(cue, mix, R, [81, 88, 93], tt, 0.5, 2.2, 0.08 * g, 1500, 5000, hall=1.0)
            else:
                notes = lead(None, chord_at(tt), 55, 79, 5)
                bloom(cue, mix, R, notes, tt, min(2.6, max(0.5, tt - 0.3)), 2.6, 0.10 * g, 500, 2300, hall=0.9)
    for r in cue.risers:
        put_riser(cue, mix, r, R, f_lo=300, f_hi=3500, tone=(110.0, 440.0), noise=0.0, tone_amp=0.12, hall=0.6)
