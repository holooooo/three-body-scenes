"""Dimensional Strike: A minor / dorian elegy. Felt piano, wide strings, glass bells, descending Shepard tone. No drums."""
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

B = 1.05   # beat length (s), ~57 bpm


def chord_list(cue, t0, t1, step, prog):
    n = max(1, int(round((t1 - t0) / step)))
    ed = np.linspace(t0, t1, n + 1)
    return [(float(ed[i]), float(ed[i + 1]), prog[i % len(prog)]) for i in range(n)]


def compose(cue, mix, R):
    N = cue.N
    t = np.arange(N) / SR
    S = cue.sec
    pn = np.zeros((2, N))

    def piano(tt, midi, beats, vel, gain=1.0):
        if tt >= cue.dur - 0.5 or tt < 0:
            return
        dur = float(min(beats * B + 3.8, 7.0))
        y = felt_piano(float(mtof(midi)), dur, vel, R)
        pan = np.clip((midi - 72) / 40.0, -0.4, 0.4)
        st = pan_stereo(y * gain, pan)
        n0 = ix(tt)
        n1 = min(N, n0 + st.shape[1])
        pn[:, n0:n1] += st[:, :n1 - n0]

    def phrase(sec, notes, transpose=0, gain=1.0, start=0.0, stretch=1.0, vel_base=0.55):
        if not sec:
            return
        for (bt, m, ln) in notes:
            tt = sec.t0 + start + bt * B * stretch
            if tt < sec.t1 - 0.5 * B:
                piano(tt, m + transpose, ln * stretch, vel_base + 0.12 * np.sin(bt * 1.7), gain)

    # ------------------------------------------------------------ melody
    M1 = [(0.3, 76, 1.5), (1.8, 72, 1), (2.8, 74, 1), (3.8, 76, 1.5), (5.3, 69, 1.7)]
    M_END = [(0.3, 76, 1), (1.3, 74, 1), (2.3, 71, 3.5)]           # stops on B (unresolved)
    M2 = [(0.0, 76, 1.5), (1.5, 72, 1), (2.5, 74, 1), (3.5, 76, 1.5), (5.0, 79, 1), (6.0, 76, 2)]
    M3 = [(0.4, 76, 1.2), (1.6, 79, 0.8), (2.4, 81, 1.6), (4.0, 79, 0.8), (4.8, 76, 1.2), (6.0, 74, 1.0), (7.0, 72, 1.5)]
    M_PAINT = [(0.4, 85, 2.2), (2.8, 81, 2.4)]
    phrase(S('calm'), M1, 0, 0.9, start=0.3)
    phrase(S('foil'), M_END, 0, 0.85, start=0.2)
    phrase(S('saturn'), M2, 12, 0.8, start=0.4, vel_base=0.5)
    phrase(S('earth'), M3, 0, 1.15, start=0.2, vel_base=0.62)
    phrase(S('painting'), M_PAINT, 0, 0.8, start=0.3, vel_base=0.5)
    # gentle low counter-line under the earth melody (warmth)
    e = S('earth')
    if e:
        for bt, m in ((0.0, 57), (3.0, 52), (6.0, 53)):
            if e.t0 + bt * B < e.t1 - 1:
                piano(e.t0 + bt * B, m, 3, 0.4, 0.8)

    # piano bus: ping-pong echo with darkened repeats
    lp = np.array([biquad('lp', 3200, 0.7)])
    echo = np.zeros_like(pn)
    for rep, (d, g) in enumerate(((0.63, 0.34), (1.26, 0.18), (1.89, 0.09))):
        sh = ix(d)
        src = pn[::-1] if rep % 2 == 0 else pn
        echo[:, sh:] += src[:, :N - sh] * g
    echo = signal.sosfilt(lp, echo, axis=-1)
    mix.add(pn * 0.55, 0, dry=1.0, hall=0.55, room=0.15)
    mix.add(echo * 0.55, 0, dry=0.8, hall=0.6)

    # ------------------------------------------------------------ strings pad
    ne = S('neptune')
    pad_amp = cue.curve({'neptune': .55, 'saturn': .8, 'earth': .55, 'sun': 1.0, 'painting': .62, 'endcard': .22},
                        0.0, fade=2.0)
    pad_amp *= cue.end_fade((S('endcard').t0 + 1.0) if S('endcard') else cue.dur - 6, cue.dur - 0.5)
    sc = ne.t0 if ne else 17.0
    cut = 850 + 1500 * pad_amp
    chords = []
    for name, step, prog in (('neptune', 4.0, [AM9, FMAJ7]), ('saturn', 4.0, [FMAJ7, CMAJ9]),
                             ('earth', 4.0, [AM9, D6]), ('sun', 3.0, [FMAJ7, AM9, D6]),
                             ('painting', 2.6, [DADD9, AMAJ9]), ('endcard', 99.0, [AMAJ9])):
        s = S(name)
        if s:
            chords += chord_list(cue, s.t0, s.t1, step, prog)
    # one long voice-led chain so voices tie across sections where chords share tones
    if chords:
        # widest voicing in the sun
        pad(cue, mix, R, chords, 52, 79, 4, 0.19, pad_amp, cut, att=2.2, rel=2.6, nv=5, det=14, hall=0.8, room=0.1,
            q=0.6)
        su = S('sun')
        if su:
            wide = [(a, b, p) for (a, b, p) in chords if su.t0 - 1e-6 <= a < su.t1]
            sw = cue.curve({'sun': 1.0}, 0.0, fade=1.0) * np.clip(cue.pts([(su.t0 - 2, 0), (su.t0 + 2.5, 1)]), 0, 1)
            pad(cue, mix, R, wide, 64, 88, 3, 0.07, sw, 1200 + 2200 * sw, att=2.0, rel=2.5, nv=5, det=16, hall=0.9,
                q=0.6)
        # pedal bass (sun: deep sustained A)
        bass_amp = cue.curve({'neptune': .15, 'saturn': .35, 'earth': .2, 'sun': 1.0, 'painting': .5, 'endcard': .18},
                             0.0, fade=2.5) * cue.end_fade(S('endcard').t0 + 1.0 if S('endcard') else cue.dur - 6, cue.dur - 0.5)
        b = np.sin(TAU * mtof(33) * t) * 0.8 + np.sin(TAU * mtof(45) * t) * 0.35 + np.sin(TAU * mtof(57) * t + 1.0) * 0.1
        mix.add(b * bass_amp * 0.21, 0, dry=1.0, hall=0.05)

    # ------------------------------------------------------------ Shepard tone (from the foil section on)
    fo = S('foil')
    if fo:
        sh = shepard(N, f_min=27.5, octs=8.0, center=3.5, sigma=1.15, period=11.0, direction=-1, rng=R, width=0.85)
        env = cue.curve({'foil': .35, 'neptune': .5, 'saturn': .55, 'earth': .38, 'sun': .8, 'painting': .5, 'endcard': .38},
                        0.0, fade=2.5)
        env *= np.clip(cue.pts([(fo.t0, 0), (fo.t0 + 0.5, 0), (fo.t0 + 6.0, 1)]), 0, 1) * (t >= fo.t0 - 0.01)
        env *= cue.end_fade((S('endcard').t0 + 1.0) if S('endcard') else cue.dur - 6, cue.dur - 0.5)
        sh = filt(sh, biquad('lp', 2600, 0.7), biquad('hp', 55, 0.7))
        mix.add(sh * env * 0.22, 0, dry=1.0, hall=0.6)

    # ------------------------------------------------------------ crystallising bell arpeggios (earth)
    if e:
        arps = [(1.0, [81, 84, 88, 91, 93]), (3.4, [76, 79, 83, 88, 91, 95]), (6.0, [81, 84, 88, 91, 93, 96])]
        for k, (off, notes) in enumerate(arps):
            tt0 = e.t0 + off
            if tt0 > e.t1 - 1.0:
                continue
            dt = 0.21
            for j, m in enumerate(notes):
                g = 0.035 * np.sin(np.pi * (j + 0.6) / (len(notes) + 0.4)) + 0.015
                y = bell(float(mtof(m)), 5.0, R, t60=(5.0, 3.0, 2.0, 1.2))
                st = pan_stereo(y * g, float(np.sin(k * 2.1 + j * 1.3)) * 0.6)
                mix.add_t(st, tt0 + j * dt, dry=0.8, hall=1.0, room=0.1)
                dt *= 0.93

    # ------------------------------------------------------------ one held high note (endcard)
    ec = S('endcard')
    if ec:
        n0 = ix(ec.t0)
        hold = np.zeros(N)
        hold[n0:] = 1
        hold = np.minimum(hold, 1.0) * cue.pts([(ec.t0, 0), (ec.t0 + 2.5, 1), (cue.dur, 1)]) * cue.end_fade(ec.t0 + 2.0, cue.dur - 0.5)
        f0 = float(mtof(93))   # A6
        hn = (np.sin(TAU * f0 * t) + 0.5 * np.sin(TAU * f0 * 1.0006 * t + 1) + 0.04 * np.sin(TAU * 2 * f0 * t)) * hold
        mix.add(np.stack([hn, np.roll(hn, 13)]) * 0.05, 0, dry=0.8, hall=1.0)

    # ------------------------------------------------------------ hits (all soft; no percussive broadband)
    glass_p = {'title': 88, 'foil': 83, 'earth': 86, 'painting': 93}
    for h in cue.hits:
        k, g, tt = h['kind'], h['gain'], h['t']
        if k == 'sub':
            put(cue, mix, sub_hit(R, soft=True, f_lo=38.0, drop=14.0), tt, 0.4 * g, dry=1.0)
        elif k == 'glass':
            put(cue, mix, glass_hit(R, glass_p.get(cue.sec_at(tt).name, 88), dur=8.0), tt, 0.13 * g, dry=0.8, hall=1.0)
        elif k == 'swell':
            s = cue.sec_at(tt)
            sun = (s.name == 'sun')
            notes = [45, 52, 57, 64, 71, 76, 81] if sun else [57, 64, 71, 72, 76][: 5]
            if not sun:
                pcs = [p for (a, b, p) in chords if a <= tt + 0.01 < b] or [AM9]
                notes = lead(None, pcs[0], 55, 79, 5)
            rise = min(3.6 if sun else 2.6, max(0.5, tt - 0.3))
            bloom(cue, mix, R, notes, tt, rise, 3.0 if sun else 2.6, (0.12 if sun else 0.10) * g, 500, 3000 if sun else 2300,
                  hall=0.9)
    for r in cue.risers:
        put_riser(cue, mix, r, R, f_lo=300, f_hi=3500, tone=(110.0, 440.0), noise=0.0, tone_amp=0.12, hall=0.6)
