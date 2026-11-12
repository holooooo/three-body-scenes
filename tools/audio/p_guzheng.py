"""Operation Guzheng: D minor pentatonic, solo plucked guzheng (Karplus-Strong) over a bowed drone.
Cold open (hook = flash-forward of the slide), calm canal, interior control room, the slide inside/outside."""
import numpy as np
from dsp import *
from engine import *
from common import *

PCS = {0, 2, 5, 7, 9}
LAD = [50, 53, 55, 57, 60, 62, 65, 67, 69, 72, 74, 77, 79, 81, 84, 86, 89, 91, 93]  # D minor pentatonic ladder
RIDE_OVERRIDES = {'interior': -27.0, 'stillness': -29.0}
_cache = {}

# phrases as (time, ladder index, velocity, pre-bend cents, vibrato cents)
PH = {
    'A': [(0.3, 5, .65, 0, 22), (1.9, 8, .6, 130, 28), (3.5, 7, .55, 0, 25), (4.6, 6, .55, 0, 20), (5.9, 7, .5, 70, 24), (7.0, 5, .6, 0, 26)],
    'B': [(0.3, 7, .6, 0, 20), (1.7, 9, .55, 90, 26), (3.2, 10, .6, 0, 28), (4.9, 9, .5, 60, 22), (6.0, 8, .5, 0, 24), (7.4, 6, .6, 0, 26)],
    'C': [(0.3, 3, .5, 0, 18), (2.2, 5, .5, 100, 22), (4.4, 6, .45, 0, 20), (5.8, 5, .5, 0, 22), (7.5, 2, .55, 0, 24)],
    'D': [(0.3, 5, .6, 0, 22), (1.9, 2, .55, 80, 26), (3.5, 3, .5, 0, 24), (4.6, 4, .5, 0, 20), (5.9, 3, .5, 40, 22), (7.0, 5, .55, 0, 26)],
    'E': [(0.2, 9, .5, 60, 24), (1.8, 7, .5, 0, 24), (3.2, 5, .55, 0, 26)],
}


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


def harmonic(midi, dur, rng):
    """very soft, bell-like guzheng harmonic: nearly pure sine, octave partial, long decay."""
    m = ix(dur)
    t = np.arange(m) / SR
    f = float(mtof(midi))
    y = (np.sin(TAU * f * t) + 0.10 * np.sin(TAU * 2 * f * t + 1.0) + 0.03 * np.sin(TAU * 3.01 * f * t)) * np.exp(-6.9 * t / 4.5)
    y *= 1 - np.exp(-t / 0.004)
    y[-ix(0.05):] *= np.linspace(1, 0, ix(0.05))
    return y


def compose(cue, mix, R):
    N = cue.N
    t = np.arange(N) / SR
    S = cue.sec
    hook, canal, strings_s, ap, co = S('hook'), S('canal'), S('strings'), S('approach'), S('contact')
    inte, ps, stl, sl_, af, ec = S('interior'), S('passing'), S('stillness'), S('slide'), S('aftermath'), S('endcard')

    def sil_end(sec):
        return max([s['to'] for s in cue.silences if sec.t0 - 0.01 <= s['from'] <= sec.t0 + 0.3] + [sec.t0])

    def pluck(tt, midi, gain=1.0, dur=None, hall=0.5, room=0.15, pan=None, **kw):
        if tt >= cue.dur - 0.5 or tt < 0:
            return
        dur = dur or float(np.interp(midi, [40, 62, 84], [9.0, 7.0, 4.5]))
        y = gz_note(midi, dur, **kw)
        p = np.clip((midi - 66) / 40.0, -0.5, 0.5) if pan is None else pan
        mix.add_t(pan_stereo(y * gain, p), tt, dry=1.0, hall=hall, room=room, duck=not exempt(cue, tt))

    def play(t0, notes, stretch=1.0, shift=0, gain=0.85, **kw):
        for (dt, li, v, pb, vib) in notes:
            pluck(t0 + dt * stretch, LAD[int(np.clip(li + shift, 0, len(LAD) - 1))], gain * v / .6, vel=v, pb=pb, vib=vib, **kw)

    # ============================================================ drone (bowed strings)
    base = cue.curve({'hook': 1.0, 'canal': .5, 'strings': .55, 'approach': 1.0, 'passing': .3, 'slide': 1.0,
                      'aftermath': .45, 'endcard': .38}, 0.0, fade=1.6)
    gate = cue.curve(lambda s: 0.0 if s.name in ('contact', 'interior', 'stillness') else 1.0, 1.0, fade=0.35)
    amp = np.minimum(base, gate)
    if canal:
        c0, se = canal.t0, sil_end(canal)
        amp *= np.where(t < c0, 1.0, cue.pts([(c0, 0), (se, 0), (se + 3.0, 1), (cue.dur, 1)]))
    if ec:
        amp *= cue.end_fade(ec.t0 + 1.5, cue.dur - 0.5)
    amp = np.clip(amp, 0, None)
    bow_lfo = 1 + 0.12 * np.sin(TAU * 0.17 * t + 0.6) + 0.07 * np.sin(TAU * 0.41 * t + 2.0)
    bright = cue.curve({'hook': 1.7, 'canal': .6, 'strings': .75, 'approach': 1.1, 'passing': .5,
                        'slide': 1.7, 'aftermath': .5, 'endcard': .45}, .5, fade=2.0)

    def span(a):
        idx = np.where(a > 1e-3)[0]
        return (int(idx[0]), int(idx[-1]) + 1) if len(idx) else None

    def bowed(midi, a_curve, gain, nv=4, det=7, cut_mul=1.0, sine=False):
        sp = span(a_curve)
        if not sp:
            return
        i0, i1 = sp
        tt = t[i0:i1]
        f = float(mtof(midi))
        if sine:
            x = np.sin(TAU * f * tt)
            x = np.stack([x, np.sin(TAU * f * 1.0007 * tt + 0.5)]) * 0.9
        else:
            x = supersaw(f, i1 - i0, nv, det, R, spread=0.7, drift=2.5)
            x = tv_filter(x, (260 + 900 * bright[i0:i1] * cut_mul) * (1 + 0.25 * np.sin(TAU * 0.11 * tt + midi)), 'lp', 0.9, chunk=512)
        mix.add(x * (a_curve[i0:i1] * bow_lfo[i0:i1] * gain), i0, dry=1.0, hall=0.28)

    bowed(38, amp, 0.17)
    bowed(50, amp * 0.55, 0.19, det=8, cut_mul=0.9)
    fifth = amp * cue.curve({'strings': .8, 'approach': 1.0, 'slide': 1.0, 'aftermath': .35}, 0.0, fade=2.0)
    bowed(45, fifth, 0.18, nv=3, det=9)
    bowed(57, fifth * 0.6, 0.12, nv=3, det=10)
    sp = span(amp)
    if sp:
        bn = bandnoise(sp[1] - sp[0], 420, 2.0, R) * amp[sp[0]:sp[1]] * 0.035
        mix.add(bn, sp[0], dry=1.0, hall=0.2)

    # ============================================================ canal: opening plucks + short phrase, aftermath: its slow return
    if canal:
        pk = [h['t'] for h in cue.hits_of('pluck', canal)]
        cur = (pk[-1] - canal.t0 + 1.8) if pk else 0.6
        fill_phrases(canal, [PH['E'], PH['B']], lambda t0, n: play(t0, n), start=cur, gap=1.0, min_fit=0.65)
    if af:
        play(af.t0 + 0.6, [(0, 5, .6, 0, 22), (2.7, 3, .55, 60, 24)], stretch=1.0, gain=0.8, t60=11.0, hall=0.7)
        fill_phrases(af, [PH['E']], lambda t0, n: play(t0, n, stretch=1.5, gain=0.7, t60=11.0, hall=0.7), start=4.0, gap=1.0, min_fit=0.6)

    pk_pitch = {'canal': [62, 57], 'strings': [69, 72, 74, 67], 'endcard': [62]}
    cnt = {}
    for h in cue.hits_of('pluck'):
        s = cue.sec_at(h['t'])
        if s.name == 'interior':
            continue
        i = cnt.get(s.name, 0)
        cnt[s.name] = i + 1
        lst = pk_pitch.get(s.name, [62])
        pluck(h['t'], lst[min(i, len(lst) - 1)], 0.95 * h['gain'], vel=0.55 + 0.3 * h['gain'],
              pb=60 if s.name == 'strings' else 0, vib=22, t60=(14.0 if s.name == 'endcard' else None))

    # ============================================================ approach: heartbeat + rising tremolo figure (slow, 5-7 Hz)
    if ap:
        tb = ap.t0 + 1.2
        while tb < ap.t1 - 0.3:
            u = (tb - ap.t0) / ap.len
            for off, g in ((0.0, 1.0), (0.31, 0.6)):
                n = ix(0.5)
                tt = np.arange(n) / SR
                f = 40 + 26 * np.exp(-tt / 0.07)
                s = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-tt / 0.13) * (1 - np.exp(-tt / 0.003))
                mix.add_t(np.stack([s, s]) * g * (0.35 + 0.65 * u) * 0.75, tb + off, dry=1.0, hall=0.05)
            tb += 1.2
        steps = [5, 6, 7, 8, 9, 10, 11, 10]
        t_start, t_end = ap.t0 + 2.4, ap.t1 - 0.25
        tt, j = t_start, 0
        while tt < t_end:
            u = (tt - t_start) / (t_end - t_start)
            m = LAD[steps[min(int(u * len(steps)), len(steps) - 1)]]
            pluck(tt, m, 0.20 + 0.34 * u, dur=0.6, vel=0.45 + 0.4 * u, variant=j % 3, hall=0.4, room=0.1, t60=2.2)
            tt += 1.0 / (5.0 + 2.5 * u)
            j += 1

    # ============================================================ glassy tone (contact + stillness) and shimmer
    tone_env = np.zeros(N)
    for sec in (co, stl):
        if sec:
            se = sil_end(sec)
            tone_env += cue.curve({sec.name: 1.0}, 0.0, fade=1.2) * cue.pts([(se, 0), (se + 1.6, 1), (cue.dur, 1)])
    if tone_env.any():
        tm = 0.5 * (np.sin(TAU * 1760.0 * t) + np.sin(TAU * 1761.3 * t + 1.0)) + 0.09 * np.sin(TAU * 2640.0 * t) \
            + 0.05 * np.sin(TAU * 3520.0 * t + 0.3)
        tm = tm * tone_env * (1 + 0.15 * np.sin(TAU * 0.23 * t))
        mix.add(np.stack([tm, np.roll(tm, 17)]) * 0.075, 0, dry=1.0, hall=0.85)
        shim = bandnoise(N, 5200 + 700 * np.sin(TAU * 0.2 * t), 6.0, R) * tone_env * 0.02 * (0.6 + 0.4 * np.sin(TAU * 0.7 * t))
        mix.add(shim, 0, dry=0.6, hall=0.9)

    # ============================================================ interior: room-tone hum, harmonics, the held semitone
    if inte:
        he = cue.curve({'interior': 1.0}, 0.0, fade=1.2) * cue.pts([(sil_end(inte), 0), (sil_end(inte) + 2.5, 1), (cue.dur, 1)])
        hum = np.zeros(N)
        for k in range(1, 9):
            hum += np.sin(TAU * 49.0 * k * t + k) * k ** -0.9 * (1.0 if k > 1 else 0.8)
        hum += 0.22 * np.sin(TAU * 73.5 * t) + 0.08 * np.sin(TAU * 147.0 * t + 0.3)     # faint fifth above
        hum *= he * (1 + 0.06 * np.sin(TAU * 0.07 * t))
        mix.add(np.stack([hum, np.roll(hum, 11)]) * 0.075, 0, dry=1.0, hall=0.12, room=0.1)
        fan = bandnoise(N, 1100 + 150 * np.sin(TAU * 0.05 * t), 0.8, R) * he * 0.006
        mix.add(fan, 0, dry=1.0, hall=0.1)
        hp = cue.hits_of('pluck', inte)
        pitches = [93, 86, 96, 91, 98, 89, 93, 86, 91, 96]
        for i, h in enumerate(hp):
            y = harmonic(pitches[i % len(pitches)], 6.0, R)
            pan = -0.65 + 1.3 * (i / max(len(hp) - 1, 1))
            mix.add_t(pan_stereo(y * 0.5 * h['gain'], pan), h['t'], dry=0.35, hall=1.0, room=0.2, duck=not exempt(cue, h['t']))
        cs = (hp[-1]['t'] + 0.8) if hp else inte.t0 + 14
    else:
        cs = 0
    if inte or ps:
        ce = cue.curve({'interior': 1.0, 'passing': 1.0}, 0.0, fade=1.5) * cue.pts([(cs, 0), (cs + 3.0, 1), (cue.dur, 1)])
        d = np.sin(TAU * mtof(38) * t) * 0.9
        e_ = np.sin(TAU * mtof(39) * t + 0.4)
        x = (d * 0.8 + e_ * 0.7) * ce
        mix.add(np.stack([x, np.roll(x, 7)]) * 0.12, 0, dry=1.0, hall=0.3)

    # passing: sparse high plucks (with a clash note) and a low brooding phrase
    if ps:
        for fr, m in ((0.18, 81), (0.45, 87), (0.72, 86)):
            pluck(ps.t0 + fr * ps.len, m, 0.34, vel=0.5, vib=14, hall=0.7, room=0.1, t60=4.0)
        fill_phrases(ps, [PH['C']], lambda t0, n: play(t0, n, stretch=0.8, gain=0.55, hall=0.6, t60=8.0), start=0.8, min_fit=0.6)

    # ============================================================ slide-type texture (used for the hook and for the slide)
    trem = 0.45 + 0.55 * (0.5 + 0.5 * np.sin(TAU * 13.0 * t)) ** 1.4      # explicit tremolo strings

    def tex_strings(chords, lo, hi, k, env, cut, gain, hall, att=0.5, rel=0.7, att_first=None, det=24):
        notes = voice_notes(chords, lo, hi, k)
        first = min(n[0] for n in notes)
        for (t_on, t_off, m) in notes:
            n0, n1 = ix(t_on), ix(t_off + rel)
            n1 = min(n1, N)
            ln = n1 - n0
            x = supersaw(float(mtof(m)), ln, 5, det, R, spread=0.9, drift=5)
            x = tv_filter(x, sl(cut, n0, ln), 'lp', 0.8, chunk=512)
            a = att_first if (att_first is not None and abs(t_on - first) < 1e-6) else att
            e = ar_env(ln, ix(a), ix(t_off - t_on), ix(rel))
            mix.add(x * (e * env[n0:n1] * trem[n0:n1] * gain), n0, dry=1.0, hall=hall, room=0.1)

    flut = 0.6 + 0.4 * np.sin(TAU * 4.1 * t + 1.0 * np.sin(TAU * 0.9 * t))

    def tex_screech(env, near, gain=0.075):
        sp = span(env)
        if not sp:
            return
        i0, i1 = sp
        tt = t[i0:i1]
        for fc0, fm, rt in ((2300, 700, 0.31), (3100, 450, 0.23), (1650, 300, 0.17)):
            nz = bandnoise(i1 - i0, fc0 + fm * np.sin(TAU * rt * tt), 28.0, R)
            mix.add(nz * env[i0:i1] * flut[i0:i1] * gain, i0, dry=1.0 if near else 0.7, hall=0.12 if near else 0.45)

    allm = [m for m in range(38, 100) if (m % 12) in PCS]

    def gliss(g0, lo, hi, up, dt, gain, pan, vel, hall, variant):
        seq = [m for m in allm if lo <= m <= hi]
        seq = seq if up else seq[::-1]
        tt = g0
        for j, m in enumerate(seq):
            pluck(tt, m, gain + 0.15 * (j / len(seq)), dur=2.4, vel=vel, variant=variant, hall=hall, room=0.15, t60=3.5, pan=pan)
            tt += dt
            dt *= 0.96

    def impacts_in(sec):
        return [h['t'] for h in cue.hits if h['kind'] == 'impact' and sec.t0 <= h['t'] < sec.t1]

    def hits_in(sec):
        return [h['t'] for h in cue.hits if h['kind'] in ('impact', 'boom') and sec.t0 <= h['t'] < sec.t1]

    # ---- hook: flash-forward of the slide, full from the first sample ----
    if hook:
        env = cue.curve({'hook': 1.0}, 0.0, fade=0.1)
        imp = impacts_in(hook)
        bounds = [hook.t0] + [x for x in imp if x > hook.t0 + 0.5] + [hook.t1 + 0.3]
        pcs_list = [[2, 5, 9], [7, 2, 10], [2, 3, 9]]
        chords = [(bounds[i], bounds[i + 1], pcs_list[i % 3]) for i in range(len(bounds) - 1)]
        tex_strings(chords, 50, 80, 5, env, 1500 + 1700 * env, 0.2, 0.3, att=0.15, att_first=0.004)
        tex_screech(env * 0.9, False)
        for i, g0 in enumerate(sorted([hook.t0 + 0.12] + [x + 0.1 for x in hits_in(hook) if x > hook.t0 + 0.5])):
            if g0 < hook.t1 - 0.4:
                gliss(g0, 50, 86, i % 2 == 0, 0.045, 0.34, None, 0.8, 0.5, i % 2)

    # ---- slide: outside / inside the room / outside (brightest) ----
    if sl_:
        rs = [r for r in cue.risers if abs(r['to'] - sl_.t0) < 0.2]
        rf = rs[0]['from'] if rs else sl_.t0
        imp = impacts_in(sl_)
        in0 = imp[1] if len(imp) >= 3 else sl_.t0 + 0.2 * sl_.len
        in1 = imp[2] if len(imp) >= 3 else sl_.t0 + 0.6 * sl_.len
        gate_s = cue.curve({'slide': 1.0}, 0.0, fade=0.25)
        pre = cue.pts([(rf - 0.01, 0), (rf, 0), (sl_.t0 - 0.02, 0.12), (sl_.t0, 0.12), (sl_.t0 + 0.01, 0)])
        s_amp = np.maximum(gate_s, pre) * (t < sl_.t1 + 2)
        ph_in = cue.pts([(in0 - 0.4, 0), (in0, 1), (in1, 1), (in1 + 0.4, 0)])
        ph_out2 = cue.pts([(in1 - 0.4, 0), (in1, 1), (sl_.t1, 1), (sl_.t1 + 0.01, 0)])
        # strings, one voice-led block per phase
        pcs_out1 = [[2, 5, 9], [7, 2, 10], [2, 3, 9]]
        phases = [(rf, in0, 50, 80, 1500, pcs_out1, 0.2, 0.35), (in0, in1, 38, 64, 1000, [[2, 9], [2, 3, 9], [2, 7, 9]], 0.22, 0.12),
                  (in1, sl_.t1 + 0.4, 62, 90, 2600, [[2, 5, 9, 0], [7, 2, 10, 5], [2, 9, 0]], 0.18, 0.5)]
        for (a, b, lo, hi, cb, pl, g, hl) in phases:
            inner = [x for x in imp if a + 0.5 < x < b - 0.5] + [x for x in hits_in(sl_) if a + 1.0 < x < b - 1.0]
            bnd = [a] + sorted(set(inner)) + [b]
            ch = [(bnd[i], bnd[i + 1], pl[i % len(pl)]) for i in range(len(bnd) - 1)]
            cut = cb + 1400 * s_amp
            tex_strings(ch, lo, hi, 5, s_amp, cut, g, hl, att=0.5, rel=0.7)
        # screech: far outside, near inside
        sc_far = np.maximum(gate_s * (1 - 0.6 * ph_in), pre * 0.8) * (1 + 0.3 * ph_out2)
        tex_screech(sc_far, False)
        tex_screech(gate_s * ph_in * 1.6, True, 0.075)
        # darker, closer: extra low end inside
        sp = span(ph_in)
        if sp:
            i0, i1 = sp
            sub = np.sin(TAU * mtof(26) * t[i0:i1]) * 0.8 + 0.4 * np.sin(TAU * mtof(38) * t[i0:i1] + 1)
            mix.add(sub * ph_in[i0:i1] * 0.16, i0, dry=1.0)
        # glissandi after every impact/boom; answering left-right inside; wide and bright outside
        gl = sorted([x + 0.11 for x in hits_in(sl_)] + [in0 + 0.45 * (in1 - in0), in0 + 0.8 * (in1 - in0), sl_.t0 + 0.35 * (in0 - sl_.t0)])
        side = 0
        for i, g0 in enumerate(gl):
            if g0 > sl_.t1 - 0.5:
                continue
            if in0 <= g0 < in1:
                gliss(g0, 38, 79, side % 2 == 0, 0.036, 0.36, -0.75 if side % 2 == 0 else 0.75, 0.8, 0.3, i % 2)
                side += 1
            elif g0 >= in1:
                gliss(g0, 62, 98, i % 2 == 0, 0.04, 0.34, None, 0.95, 0.75, i % 2)
            else:
                gliss(g0, 50, 86, i % 2 == 0, 0.052, 0.38, None, 0.8, 0.55, i % 2)

    # ============================================================ hits
    gl_pitch = {'strings': 88, 'contact': 93}
    for h in cue.hits:
        k, g, tt = h['kind'], h['gain'], h['t']
        if k == 'sub':
            put(cue, mix, sub_hit(R), tt, 0.5 * g, dry=1.0)
        elif k == 'boom':
            put(cue, mix, boom_hit(R, 0.6), tt, 0.75 * g, dry=1.0, hall=0.18, room=0.1)
        elif k == 'impact':
            put(cue, mix, impact_hit(R, subg=0.6), tt, 0.95 * g, dry=1.0, hall=0.3, room=0.1)
        elif k == 'glass':
            put(cue, mix, glass_hit(R, gl_pitch.get(cue.sec_at(tt).name, 88)), tt, 0.14 * g, dry=0.7, hall=0.9)
        elif k == 'swell':
            bloom(cue, mix, R, [50, 57, 62, 65, 69], tt, min(2.5, max(tt - 0.3, 0.3)), 3.0, 0.10 * g, 400, 1800, hall=0.9)
    for i, r in enumerate(cue.risers):
        late = i > 0
        put_riser(cue, mix, r, R, f_lo=300, f_hi=6500 if late else 4200, tone=(520, 1500) if late else (150, 330),
                  noise=0.22 if late else 0.14, tone_amp=0.07)
