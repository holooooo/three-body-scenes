"""DSP building blocks for the three-body score (numpy + scipy only, deterministic)."""
import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d

SR = 48000
TAU = 2 * np.pi


def ix(t):
    return int(round(t * SR))


def db(x):
    return 10 ** (x / 20.0)


def mtof(m):
    return 440.0 * 2 ** ((np.asarray(m, dtype=float) - 69) / 12.0)


def sl(arr, i0, m):
    """arr[i0:i0+m] with edge-value padding on both sides."""
    out = np.empty(m, dtype=np.float64)
    n = len(arr)
    a = max(i0, 0)
    b = min(i0 + m, n)
    if b <= a:
        out[:] = arr[0] if i0 < 0 else arr[-1]
        return out
    if i0 < 0:
        out[:a - i0] = arr[0]
    out[a - i0:b - i0] = arr[a:b]
    if i0 + m > n:
        out[b - i0:] = arr[-1]
    return out


# ----------------------------------------------------------------- filters
def biquad(kind, f, q=0.707, gain_db=0.0):
    f = float(np.clip(f, 15.0, SR * 0.45))
    w0 = TAU * f / SR
    cw, sw = np.cos(w0), np.sin(w0)
    al = sw / (2 * q)
    A = 10 ** (gain_db / 40.0)
    if kind == 'lp':
        b = [(1 - cw) / 2, 1 - cw, (1 - cw) / 2]
        a = [1 + al, -2 * cw, 1 - al]
    elif kind == 'hp':
        b = [(1 + cw) / 2, -(1 + cw), (1 + cw) / 2]
        a = [1 + al, -2 * cw, 1 - al]
    elif kind == 'bp':
        b = [al, 0.0, -al]
        a = [1 + al, -2 * cw, 1 - al]
    elif kind == 'peak':
        b = [1 + al * A, -2 * cw, 1 - al * A]
        a = [1 + al / A, -2 * cw, 1 - al / A]
    else:
        raise ValueError(kind)
    return np.array([b[0] / a[0], b[1] / a[0], b[2] / a[0], 1.0, a[1] / a[0], a[2] / a[0]])


def filt(x, *rows):
    return signal.sosfilt(np.array(rows), x, axis=-1)


def tv_filter(x, cutoff, kind='lp', q=0.707, chunk=256):
    """Biquad with a time-varying cutoff (array or scalar), state carried between chunks."""
    x = np.asarray(x, dtype=np.float64)
    m = x.shape[-1]
    out = np.empty_like(x)
    zi = np.zeros((1,) + x.shape[:-1] + (2,))
    arr = np.ndim(cutoff) > 0
    for s in range(0, m, chunk):
        e = min(s + chunk, m)
        fc = cutoff[(s + e) // 2] if arr else cutoff
        y, zi = signal.sosfilt(biquad(kind, fc, q)[None], x[..., s:e], zi=zi, axis=-1)
        out[..., s:e] = y
    return out


def smooth_curve(arr, fade):
    """Moving-average (hann) smoothing of a long control curve."""
    k = int(fade * SR) | 1
    if k < 3:
        return arr
    w = np.hanning(k + 2)[1:-1]
    w /= w.sum()
    h = k // 2
    p = np.concatenate([np.full(h, arr[0]), arr, np.full(h, arr[-1])])
    return signal.fftconvolve(p, w, mode='valid')[:len(arr)]


# ----------------------------------------------------------------- envelopes
def cos_ramp(n):
    if n <= 0:
        return np.zeros(0)
    return 0.5 - 0.5 * np.cos(np.pi * np.linspace(0, 1, n))


def ar_env(m, att, hold_end, rel):
    """raised-cosine attack, flat, raised-cosine release starting at hold_end (samples)."""
    e = np.ones(m)
    a = min(att, m)
    e[:a] = cos_ramp(a)
    hold_end = min(max(hold_end, 0), m)
    r = min(rel, m - hold_end)
    if r > 0:
        e[hold_end:hold_end + r] *= 1 - cos_ramp(r)
        e[hold_end + r:] = 0
    else:
        e[hold_end:] = 0
    return e


def pan_stereo(x, pan):
    """mono -> stereo equal power, pan -1..1"""
    ang = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(ang), x * np.sin(ang)])


# ----------------------------------------------------------------- oscillators
def saw_blep(freq, ph0=0.0):
    dt = freq / SR
    ph = (ph0 + np.cumsum(dt)) % 1.0
    s = 2 * ph - 1
    lo = ph < dt
    x = np.where(lo, ph / dt, 0.0)
    s -= np.where(lo, x + x - x * x - 1, 0.0)
    hi = ph > 1 - dt
    x = np.where(hi, (ph - 1) / dt, 0.0)
    s -= np.where(hi, x * x + x + x + 1, 0.0)
    return s


def supersaw(f, m, nv=5, det=10.0, rng=None, spread=0.9, drift=3.0):
    """Detuned saw stack, stereo (2,m). f may be an array (glide)."""
    t = np.arange(m) / SR
    out = np.zeros((2, m))
    pans = rng.permutation(np.linspace(-1, 1, nv)) * spread if nv > 1 else np.zeros(1)
    for i in range(nv):
        c = det * ((i / (nv - 1)) * 2 - 1) if nv > 1 else 0.0
        c += rng.uniform(-1, 1) * det * 0.12
        lfo = drift * np.sin(TAU * rng.uniform(0.05, 0.3) * t + rng.uniform(0, TAU))
        fr = f * 2 ** ((c + lfo) / 1200.0)
        s = saw_blep(fr, rng.uniform())
        ang = (pans[i] + 1) * np.pi / 4
        out[0] += s * np.cos(ang)
        out[1] += s * np.sin(ang)
    return out / np.sqrt(nv)


def sine_glide(f0, f1, m, curve=1.0):
    """exponential glide f0->f1 across m samples (curve>1 delays the motion)"""
    u = np.linspace(0, 1, m) ** curve
    f = f0 * (f1 / f0) ** u
    return np.sin(TAU * np.cumsum(f) / SR)


# ----------------------------------------------------------------- plucked / struck sounds
def ks(f, dur, t60, rng, pick=0.2, bright=0.6):
    """Karplus-Strong string (loop: 2-point average + first-order allpass tuning),
    pick-position comb on the excitation. Vectorised via lfilter."""
    m = ix(dur)
    Dtot = SR / f - 0.5
    Dint = int(np.floor(Dtot - 0.5))
    d = Dtot - Dint
    a = (1 - d) / (1 + d)
    g = min(10 ** (-3.0 / (t60 * f)), 0.99985)
    loop = g * np.convolve([0.5, 0.5], [a, 1.0])
    den = np.zeros(max(Dint + 3, 2))
    den[:2] += [1.0, a]
    den[Dint:Dint + 3] -= loop
    L = int(SR / f)
    x = rng.uniform(-1, 1, L)
    c = 0.9 * (1 - bright)
    x = signal.lfilter([1 - c], [1, -c], x)
    p = max(1, int(pick * L))
    x2 = x.copy()
    x2[p:] -= x[:-p]
    x2 -= x2.mean()
    xin = np.zeros(m)
    xin[:L] = x2
    y = signal.lfilter([1.0, a], den, xin)
    r = np.sqrt(np.mean(y[:ix(0.15)] ** 2)) + 1e-12
    return y * (0.18 / r)


def warp(y, cents):
    """time-varying pitch via resampling; cents is array (output length)."""
    ratio = 2 ** (cents / 1200.0)
    tau = np.cumsum(ratio) - ratio[0]
    return np.interp(tau, np.arange(len(y)), y)


def felt_piano(f, dur, vel, rng):
    m = ix(dur)
    t = np.arange(m) / SR
    K = int(max(3, min(12, 5500 // f)))
    out = np.zeros(m)
    T0 = 5.0 * np.clip(440.0 / f, 0.7, 1.9) ** 0.6
    for k in range(1, K + 1):
        fk = f * k * np.sqrt(1 + 0.00022 * k * k)
        amp = k ** -1.15 * np.exp(-(k - 1) * 0.2 * (1.35 - vel))
        T = T0 / (1 + 0.5 * (k - 1))
        e = 0.62 * np.exp(-6.9 * t / T) + 0.38 * np.exp(-6.9 * t / (2.6 * T))
        for sgn in (-1, 1):
            out += 0.5 * amp * np.sin(TAU * fk * (1 + sgn * 0.00028) * t + rng.uniform(0, TAU)) * e
    out *= 1 - np.exp(-t / 0.0045)
    out = filt(out, biquad('lp', 3400, 0.6))
    th = rng.standard_normal(m)
    th = filt(th, biquad('lp', 380, 0.7)) * np.exp(-t / 0.03) * 0.5
    out += th * (0.4 + vel * 0.6) * 0.15
    out *= 0.2 / (np.sqrt(np.mean(out[:ix(0.2)] ** 2)) + 1e-12)
    out[-ix(0.03):] *= np.linspace(1, 0, ix(0.03))
    return out


def bell(f, dur, rng, ratios=(1, 2.756, 5.404, 8.933), amps=(1, .42, .2, .08),
         t60=(7.0, 4.5, 3.0, 1.8), shimmer=0.0014, att=0.002):
    m = ix(dur)
    t = np.arange(m) / SR
    out = np.zeros(m)
    for r, a, T in zip(ratios, amps, t60):
        fr = f * r
        if fr > 13000:
            continue
        e = np.exp(-6.9 * t / T)
        for sgn in (-1, 1):
            out += 0.5 * a * np.sin(TAU * fr * (1 + sgn * shimmer) * t + rng.uniform(0, TAU)) * e
    out *= 1 - np.exp(-t / att)
    out *= 0.2 / (np.sqrt(np.mean(out[:ix(0.3)] ** 2)) + 1e-12)
    out[-ix(0.05):] *= np.linspace(1, 0, ix(0.05))
    return out


def bandnoise(m, fc, q, rng, stereo=True):
    x = rng.standard_normal((2, m) if stereo else m)
    y = tv_filter(x, fc, 'bp', q, chunk=128)
    return y / (np.sqrt(np.mean(y ** 2)) + 1e-12)


def shepard(m, f_min=27.5, octs=8.0, center=3.3, sigma=1.25, per_oct=1.0, period=10.0,
            direction=-1, rng=None, width=0.8, t_off=0.0):
    """Continuously descending (or rising) Shepard tone, stereo (2,m)."""
    t = np.arange(m) / SR + t_off
    nparts = int(octs * per_oct)
    out = np.zeros((2, m))
    for i in range(nparts):
        pos = (i / per_oct + direction * t / period) % octs
        f = f_min * 2 ** pos
        amp = np.exp(-0.5 * ((pos - center) / sigma) ** 2) * np.sin(np.pi * pos / octs) ** 2
        ph = TAU * np.cumsum(f) / SR + rng.uniform(0, TAU)
        s = np.sin(ph) * amp
        pan = width * np.sin(i * 2.399)
        ang = (pan + 1) * np.pi / 4
        out[0] += s * np.cos(ang)
        out[1] += s * np.sin(ang)
    return out / np.sqrt(nparts) * 2.0


# ----------------------------------------------------------------- reverb
def make_ir(rt_mid, predelay, rng, length=None, tilt=(1.35, 1.0, 0.75, 0.45, 0.25), er=True):
    """Stereo decorrelated noise IR with frequency dependent decay. Unit energy per channel."""
    length = length or min(rt_mid * 1.25 + predelay, 9.0)
    m = ix(length)
    t = np.arange(m) / SR
    edges = [(20, 250), (250, 1000), (1000, 4000), (4000, 10000), (10000, 20000)]
    ir = np.zeros((2, m))
    for (lo, hi), tl in zip(edges, tilt):
        sos = signal.butter(2, [lo, hi], 'bp', fs=SR, output='sos')
        nz = signal.sosfilt(sos, rng.standard_normal((2, m)), axis=-1)
        ir += nz * (10 ** (-3 * t / (rt_mid * tl)))
    ir *= 1 - np.exp(-t / 0.035)
    if er:
        for ch in range(2):
            for _ in range(10):
                p = ix(rng.uniform(0.007, 0.07))
                ir[ch, p] += rng.choice([-1, 1]) * rng.uniform(0.4, 1.0) * ir[ch].std() * 14 * np.exp(-p / SR / 0.04)
    ir *= 1 - 0  # keep
    ir /= np.sqrt(np.sum(ir ** 2, axis=-1, keepdims=True))
    pd = ix(predelay)
    return np.concatenate([np.zeros((2, pd)), ir], axis=1)


def convolve(x, ir):
    """x (2,N) with ir (2,M) -> (2,N) (truncated)"""
    n = x.shape[1]
    out = np.empty((2, n))
    for ch in range(2):
        out[ch] = signal.fftconvolve(x[ch], ir[ch], mode='full')[:n]
    return out


# ----------------------------------------------------------------- metering
def k_weight(x):
    s1 = np.array([[1.53512485958697, -2.69169618940638, 1.19839281085285,
                    1.0, -1.69065929318241, 0.73248077421585]])
    s2 = np.array([[1.0, -2.0, 1.0, 1.0, -1.99004745483398, 0.99007225036621]])
    return signal.sosfilt(np.vstack([s1, s2]), x, axis=-1)


def lufs(x):
    y = k_weight(x)
    z = np.concatenate([np.zeros((y.shape[0], 1)), np.cumsum(y.astype(np.float64) ** 2, axis=1)], axis=1)
    blk, hop = ix(0.4), ix(0.1)
    n = y.shape[1]
    if n < blk:
        return -120.0
    st = np.arange(0, n - blk + 1, hop)
    ms = (z[:, st + blk] - z[:, st]) / blk
    l = -0.691 + 10 * np.log10(ms.sum(0) + 1e-20)
    g1 = l > -70
    if not g1.any():
        return -120.0
    rel = -0.691 + 10 * np.log10(ms[:, g1].sum(0).mean()) - 10
    g2 = g1 & (l > rel)
    return -0.691 + 10 * np.log10(ms[:, g2].sum(0).mean())


def true_peak_db(x):
    up = signal.resample_poly(x, 4, 1, axis=-1)
    return 20 * np.log10(np.abs(up).max() + 1e-12)


# ----------------------------------------------------------------- dynamics
def compress(x, thr_db=-24.0, ratio=1.8, attack=0.03, release=0.45, knee=8.0, makeup=0.0):
    """Stereo-linked feed-forward compressor, 1 ms control rate."""
    blk = ix(0.001)
    p = np.maximum(x[0] ** 2, x[1] ** 2)
    a = np.exp(-1.0 / (0.03 * SR))
    pe = signal.lfilter([1 - a], [1, -a], p)
    pe = pe[:len(pe) // blk * blk].reshape(-1, blk).mean(1)
    lvl = 10 * np.log10(pe + 1e-12)
    over = lvl - thr_db
    gr = np.where(over <= -knee / 2, 0.0,
                  np.where(over >= knee / 2, over * (1 - 1 / ratio),
                           (over + knee / 2) ** 2 / (2 * knee) * (1 - 1 / ratio)))
    ca = np.exp(-1.0 / (attack * 1000))
    cr = np.exp(-1.0 / (release * 1000))
    sm = np.zeros_like(gr)
    s = 0.0
    for i, v in enumerate(gr):
        c = ca if v > s else cr
        s = c * s + (1 - c) * v
        sm[i] = s
    g = 10 ** ((-sm + makeup) / 20)
    xs = np.arange(len(g)) * blk + blk / 2
    gf = np.interp(np.arange(x.shape[1]), xs, g)
    return x * gf


def limiter(x, ceiling_db=-1.5, look=0.004):
    c = 10 ** (ceiling_db / 20)
    blk = 24
    n = x.shape[1]
    nb = n // blk + 1
    pk = np.zeros(nb * blk)
    pk[:n] = np.abs(x).max(0)
    pk = pk.reshape(nb, blk).max(1)
    g = np.minimum(1.0, c / (pk + 1e-12))
    w = max(3, int(look * SR / blk))
    gm = minimum_filter1d(g, size=2 * w + 1, mode='nearest')
    k = np.hanning(w + 2)[1:-1]
    k /= k.sum()
    gs = np.convolve(np.pad(gm, (len(k) // 2, len(k) // 2), mode='edge'), k, mode='valid')[:nb]
    gs = np.minimum(gs, g)
    xs = np.arange(nb) * blk + blk / 2
    gf = np.interp(np.arange(n), xs, gs)
    return x * gf


def mono_below(x, fc=120.0):
    sos = signal.butter(2, fc, 'lp', fs=SR, output='sos')
    low = signal.sosfilt(sos, x, axis=-1)
    mid = low.mean(0, keepdims=True)
    return x - low + mid
