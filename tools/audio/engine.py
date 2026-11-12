"""Engine: cue wrapper, mixer with ducking + reverb sends, hit/riser renderers, voice-leading."""
import itertools
import numpy as np
from scipy import signal
from dsp import *


class Sec:
    def __init__(self, name, t0, t1, level, note):
        self.name, self.t0, self.t1, self.level, self.note = name, t0, t1, level, note
        self.len = t1 - t0

    def __repr__(self):
        return f"<{self.name} {self.t0}-{self.t1} L{self.level}>"


class Cue:
    def __init__(self, d):
        self.d = d
        self.id = d['id']
        self.dur = float(d['duration'])
        self.N = ix(self.dur)
        ss = d['sections']
        self.secs = [Sec(s['name'], s['t'], ss[i + 1]['t'] if i + 1 < len(ss) else self.dur,
                         s['level'], s.get('note', '')) for i, s in enumerate(ss)]
        self.by = {s.name: s for s in self.secs}
        self.hits = sorted(d.get('hits', []), key=lambda h: h['t'])
        self.risers = d.get('risers', [])
        self.silences = d.get('silences', [])

    def sec(self, name):
        return self.by.get(name)

    def sec_at(self, t):
        for s in self.secs:
            if s.t0 <= t < s.t1:
                return s
        return self.secs[-1]

    def hits_of(self, kind, sec=None):
        out = [h for h in self.hits if h['kind'] == kind]
        if sec is not None:
            out = [h for h in out if sec.t0 <= h['t'] < sec.t1]
        return out

    def curve(self, vals, default=0.0, fade=1.5):
        """Per-sample curve: vals is dict name->value or callable(Sec); smoothed over `fade` seconds."""
        arr = np.full(self.N, float(default))
        for s in self.secs:
            v = vals(s) if callable(vals) else vals.get(s.name, default)
            arr[ix(s.t0):ix(s.t1)] = v
        return smooth_curve(arr, fade) if fade > 0 else arr

    def pts(self, points):
        """piecewise-linear curve through (t, value) points"""
        ts = [p[0] for p in points]
        vs = [p[1] for p in points]
        return np.interp(np.arange(self.N) / SR, ts, vs)

    def end_fade(self, t_start, t_end):
        """1 -> 0 (cosine) between t_start and t_end, 0 after."""
        t = np.arange(self.N) / SR
        u = np.clip((t - t_start) / max(t_end - t_start, 1e-6), 0, 1)
        return 0.5 + 0.5 * np.cos(np.pi * u)


class Mix:
    def __init__(self, cue):
        self.cue = cue
        self.N = cue.N
        self.b = {}
        for bus in ('dry', 'hall', 'room'):
            for dk in (True, False):
                self.b[(bus, dk)] = np.zeros((2, self.N), dtype=np.float32)

    def add(self, sig, i0, dry=1.0, hall=0.0, room=0.0, duck=True):
        sig = np.asarray(sig)
        if sig.ndim == 1:
            sig = np.stack([sig, sig])
        m = sig.shape[1]
        a, b = max(i0, 0), min(i0 + m, self.N)
        if b <= a:
            return
        seg = sig[:, a - i0:b - i0]
        for bus, g in (('dry', dry), ('hall', hall), ('room', room)):
            if g:
                self.b[(bus, duck)][:, a:b] += (g * seg).astype(np.float32)

    def add_t(self, sig, t, **kw):
        self.add(sig, ix(t), **kw)

    def duck_gain(self):
        g = np.ones(self.N)
        for s in self.cue.silences:
            a, b = ix(s['from']), ix(s['to'])
            g[a:b] = 0.0
            r = ix(0.003)
            g[max(a - r, 0):a] = np.linspace(1, 0, min(r, a))
            u = ix(0.03)
            g[b:b + u] = np.minimum(g[b:b + u], np.linspace(0, 1, len(g[b:b + u])))
        return g

    def render(self, hall_ir, room_ir, hall_gain=1.0, room_gain=1.0):
        dg = self.duck_gain()
        sig = {}
        for bus in ('dry', 'hall', 'room'):
            sig[bus] = self.b[(bus, True)] * dg + self.b[(bus, False)]
        hp = np.array([biquad('hp', 150, 0.7)])
        wet_h = convolve(signal.sosfilt(hp, sig['hall'].astype(np.float64), axis=-1), hall_ir)
        wet_r = convolve(signal.sosfilt(hp, sig['room'].astype(np.float64), axis=-1), room_ir)
        return sig['dry'].astype(np.float64) + hall_gain * wet_h + room_gain * wet_r, wet_h, wet_r


# ------------------------------------------------------------------ voice leading
def lead(prev, pcs, lo, hi, k=4):
    targets = [pcs[i % len(pcs)] for i in range(k)]
    cands = [[m for m in range(lo, hi + 1) if m % 12 == pc] for pc in targets]
    if prev is None:
        out = []
        for i, pc in enumerate(targets):
            ideal = lo + (hi - lo) * (i + 0.5) / k
            c = min(cands[i], key=lambda m: abs(m - ideal))
            while c in out:
                c += 12
            out.append(c)
        return out
    best, bc = None, 1e9
    for perm in itertools.permutations(range(k)):
        pick = [min(cands[perm[i]], key=lambda m: abs(m - prev[i])) for i in range(k)]
        if len(set(pick)) < k:
            continue
        cost = sum(abs(p - q) for p, q in zip(pick, prev))
        if cost < bc:
            best, bc = pick, cost
    return best if best else [min(cands[i], key=lambda m: abs(m - prev[i])) for i in range(k)]


def voice_notes(chords, lo, hi, k=4):
    """chords: [(t0, t1, pcs)] -> voice-led notes with tied common tones [(t_on, t_off, midi)]"""
    prev = None
    lanes = [[] for _ in range(k)]
    for (t0, t1, pcs) in chords:
        v = lead(prev, pcs, lo, hi, k)
        prev = v
        for i, m in enumerate(v):
            if lanes[i] and lanes[i][-1][2] == m and abs(lanes[i][-1][1] - t0) < 1e-6:
                lanes[i][-1][1] = t1
            else:
                lanes[i].append([t0, t1, m])
    return [tuple(n) for lane in lanes for n in lane]


# ------------------------------------------------------------------ hits
def _fadeout(x, n=24):
    x = x.copy()
    n = min(n, x.shape[-1])
    x[..., -n:] *= np.linspace(1, 0, n)
    return x


def sub_hit(rng, soft=False, f_lo=34.0, drop=24.0, tail=None):
    tail = tail or (7.0 if soft else 4.5)
    m = ix(tail)
    t = np.arange(m) / SR
    f = f_lo + drop * np.exp(-t / (0.5 if soft else 0.22))
    ph = TAU * np.cumsum(f) / SR
    att = 0.14 if soft else 0.012
    e = (1 - np.exp(-t / att)) * (np.exp(-t / (2.2 if soft else 1.35)))
    s = (np.sin(ph) + 0.18 * np.sin(2 * ph + 0.5)) * e
    return _fadeout(np.stack([s, s]) * 0.9), 0


def boom_hit(rng, subg=1.0):
    tail = 2.6
    m = ix(tail)
    t = np.arange(m) / SR
    f = 31 + 48 * np.exp(-t / 0.055)
    ph = TAU * np.cumsum(f) / SR
    sub = np.sin(ph) * np.exp(-t / 0.5) * (1 - np.exp(-t / 0.0015))
    nz = rng.standard_normal((2, m))
    nz = tv_filter(nz, 450 * np.exp(-t / 0.2) + 120, 'lp', 0.8, chunk=128) * np.exp(-t / 0.16) * 1.1
    rum = filt(rng.standard_normal((2, m)), biquad('lp', 110, 0.7)) * np.exp(-t / 0.9) * 2.5
    out = sub * 0.9 * subg + nz * 0.55 + rum * 0.5 * subg
    return _fadeout(out), 0


def impact_hit(rng, pre=0.9, tail=5.5, subg=1.0):
    mt = ix(tail)
    t = np.arange(mt) / SR
    f = 27 + 75 * np.exp(-t / 0.085)
    sub = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / 1.25) * (1 - np.exp(-t / 0.0018))
    body = np.zeros(mt)
    for fr, a, T in ((52, 0.5, 1.6), (77.8, 0.35, 1.1), (118, 0.22, 0.8), (167, 0.12, 0.5)):
        body += a * np.sin(TAU * np.cumsum(fr * (1 + 0.25 * np.exp(-t / 0.2))) / SR) * np.exp(-t / T)
    body *= (1 - np.exp(-t / 0.002))
    crack_m = ix(1.0)
    tc = t[:crack_m]
    crack = tv_filter(rng.standard_normal((2, crack_m)), 6500 * np.exp(-tc / 0.1) + 260, 'lp', 0.8, chunk=128)
    crack *= np.exp(-tc / 0.2) * (1 - np.exp(-tc / 0.0008)) * 0.9
    rum = filt(rng.standard_normal((2, mt)), biquad('lp', 160, 0.7)) * np.exp(-t / 1.9) * 3.0
    ring = np.zeros(mt)
    for r, a, T in ((1, 1, 2.2), (2.76, 0.6, 1.5), (5.4, 0.35, 1.0)):
        ring += a * np.sin(TAU * 311 * r * t + rng.uniform(0, TAU)) * np.exp(-t / T)
    ring *= 0.06 * (1 - np.exp(-t / 0.002))
    out = np.zeros((2, mt))
    out += (sub * 1.0 * subg + body * 0.45 * (0.5 + 0.5 * subg) + ring)
    out[:, :crack_m] += crack * 0.55
    out += rum * 0.35 * subg
    # pre-swell: reversed noise sweep ending exactly at the hit
    mp = ix(pre)
    u = np.linspace(0, 1, mp)
    sw = bandnoise(mp, 350 * (9000 / 350) ** u, 0.9, rng) * (u ** 2.6) * 0.5
    sw[:, -ix(0.002):] *= np.linspace(1, 0, ix(0.002))
    full = np.concatenate([sw * 0.6, out], axis=1)
    return _fadeout(full), mp


def glass_hit(rng, midi, dur=7.0):
    b = bell(float(mtof(midi)), dur, rng)
    return np.stack([b, np.roll(b, 23) * 0.97]), 0


def riser_sig(dur, rng, f_lo=300.0, f_hi=7000.0, tone=None, noise=1.0, tone_amp=0.5, curve=1.3, pw=2.2):
    m = ix(dur)
    u = np.linspace(0, 1, m)
    fc = f_lo * (f_hi / f_lo) ** (u ** curve)
    out = bandnoise(m, fc, 1.2, rng) * (u ** pw) * noise if noise > 0 else np.zeros((2, m))
    if tone:
        f0, f1 = tone
        e = u ** (pw * 0.75)
        for k, (mul, a) in enumerate(((1.0, 1.0), (1.5, 0.45), (2.0, 0.3))):
            l = sine_glide(f0 * mul, f1 * mul, m, 1.0)
            r = sine_glide(f0 * mul * 1.003, f1 * mul * 1.003, m, 1.0)
            out += np.stack([l, r]) * e * a * tone_amp
    out[:, -ix(0.0015):] *= np.linspace(1, 0, ix(0.0015))
    return out
