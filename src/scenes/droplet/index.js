// Doomsday Battle — one droplet against two thousand stellar-class warships.
// Units: kilometres. The fleet is a three-dimensional lattice (25 x 8 x 10). The droplet takes the first
// line end to end, turns at an acute angle, takes two more, and then hunts the scattering fleet down.
// Every ship's fate is a pure function of time (hit time, escape time), so the battle can be scrubbed.
import * as THREE from 'three';
import { clamp, lerp, smooth, smoother, easeInOut, easeOut, easeIn, v3lerp, v3add, v3sub, v3scale, v3norm, v3len, rng, GLSL_NOISE } from '../../core/util.js';
import { makeSpace, makeFarSun } from '../../core/space.js';

const NX = 25, NY = 8, NZ = 10, N = NX * NY * NZ, DX = 4.5, DY = 6, DZ = 7;
const T = { halo: 13, go: 16.5, first: 18.5, end: 140 };
const BLAST = 1.0;                                   // seconds between a ship being pierced and its fusion fuel going up
const ACC = 0.2, BURN = 11;                          // fleeing ships burn hard for BURN seconds, then coast
const SUN_DIR = new THREE.Vector3(-0.72, 0.42, 0.55).normalize();
const M2K = 0.001;                                   // metres -> km

// ---------- fleet plan (deterministic) ----------
function planBattle() {
  const R = rng(2205), pos0 = new Float32Array(N * 3), dir = new Float32Array(N * 3), hd = new Float32Array(N * 3);
  const hit = new Float32Array(N).fill(1e9), esc = new Float32Array(N).fill(1e9), fac = new Float32Array(N).fill(1), seed = new Float32Array(N);
  const idx = (ix, iy, iz) => (iz * NY + iy) * NX + ix;
  for (let iz = 0; iz < NZ; iz++) for (let iy = 0; iy < NY; iy++) for (let ix = 0; ix < NX; ix++) {
    const i = idx(ix, iy, iz);
    pos0.set([(ix - (NX - 1) / 2) * DX + (R() - 0.5) * 0.3, (iy - (NY - 1) / 2) * DY + (R() - 0.5) * 0.3, (iz - (NZ - 1) / 2) * DZ + (R() - 0.5) * 0.3], i * 3); seed[i] = R();
  }
  const P = i => [pos0[i * 3], pos0[i * 3 + 1], pos0[i * 3 + 2]];
  const posAt = (i, t) => { const te = Math.max(0, t - esc[i]), k = ACC * fac[i] * (te < BURN ? 0.5 * te * te : BURN * (te - BURN / 2)); return [pos0[i * 3] + dir[i * 3] * k, pos0[i * 3 + 1] + dir[i * 3 + 1] * k, pos0[i * 3 + 2] + dir[i * 3 + 2] * k]; };
  const path = [], order = [];
  const firstI = idx(0, NY - 1, NZ - 1), p0 = P(firstI), start = [p0[0] + 11.25, p0[1] + 1.5, p0[2] + 4.0];
  path.push({ t: 0, p: start }, { t: T.go, p: start });
  for (let k = 1; k < 8; k++) { const u = k / 8; path.push({ t: lerp(T.go, T.first, u), p: v3lerp(start, p0, u * u) }); }
  let t = T.first;
  const strike = (i, q) => { const prev = path[path.length - 1].p, d = v3norm(v3sub(q, prev)); hd.set(d, i * 3); hit[i] = t; order.push(i); path.push({ t, p: q }); };
  // three lines of the front face, alternating direction, with an overshoot and an acute turn between them
  const lines = [];
  for (let r = 0; r < 3; r++) {
    const iy = NY - 1 - r, rev = r % 2 === 1, d0 = [0.17, 0.12, 0.09][r], d1 = [0.12, 0.09, 0.07][r], L = [];
    for (let k = 0; k < NX; k++) {
      const ix = rev ? NX - 1 - k : k, i = idx(ix, iy, NZ - 1);
      if (!(r === 0 && k === 0)) t += lerp(d0, d1, k / (NX - 1));
      strike(i, P(i)); L.push(i);
    }
    lines.push(L);
    const last = P(L[NX - 1]), over = [last[0] + (rev ? -9 : 9), last[1] - 2, last[2] + 3];
    t += 0.2; path.push({ t, p: over }); t += 0.3;
  }
  const tScatter = hit[lines[2][0]] - 1.2;
  const two = [idx(1, 0, 0), idx(4, 1, 0)];                        // Quantum, Bronze Age: already in deep-sea state
  for (let i = 0; i < N; i++) {
    if (hit[i] < 1e8) continue;
    const p = P(i), surv = two.includes(i);
    let d = [p[0] * 0.7 + (R() - 0.5) * 60, p[1] * 1.2 + (R() - 0.5) * 60, p[2] * 0.7 - 22 + (R() - 0.5) * 60];
    if (surv) d = [-0.5, -0.36, -0.79];
    d = v3norm(d); dir.set(d, i * 3);
    esc[i] = surv ? tScatter - 2.5 : tScatter + R() * R() * 26;
    fac[i] = surv ? 5 : 0.45 + R() * 1.1;
  }
  // the hunt: always the nearest surviving ship, faster and faster
  const left = []; for (let i = 0; i < N; i++) if (hit[i] > 1e8 && !two.includes(i)) left.push(i);
  let cur = path[path.length - 1].p; const tHunt = t, nHunt = left.length;
  while (left.length) {
    let best = -1, bd = 1e18;
    for (let k = 0; k < left.length; k++) { const q = posAt(left[k], t), dd = (q[0] - cur[0]) ** 2 + (q[1] - cur[1]) ** 2 + (q[2] - cur[2]) ** 2; if (dd < bd) { bd = dd; best = k; } }
    const i = left[best]; left[best] = left[left.length - 1]; left.pop();
    t += lerp(0.07, 0.02, 1 - left.length / nHunt);
    const q = posAt(i, t); strike(i, q); cur = q;
  }
  // when the last ship is gone it flies back to the edge of the wreck and stops side-on to it, so that its flank mirrors everything it has done
  const C0 = [0, 0, -8], out = v3sub(cur, C0), rest = v3add(C0, v3scale(v3norm([out[0], out[1] * 0.35, out[2]]), 72));
  const toC = v3norm(v3sub(C0, rest)), restAxis = v3norm([-toC[2], 0, toC[0]]);
  const tLast = t, tRest = tLast + 3.5;
  for (let k = 1; k <= 12; k++) { const u = k / 12; path.push({ t: tLast + 3.5 * u, p: v3lerp(cur, rest, 1 - Math.pow(1 - u, 2.2)) }); }
  path.push({ t: 1e6, p: rest });
  return { pos0, dir, hd, hit, esc, fac, seed, path, order, posAt, P, idx, lines, firstI, start, tScatter, tHunt, tLast, tRest, two, rest, restAxis };
}

function shipGeometry() {
  const P = [], Nn = [], C = [], Rn = [], M = [], R = rng(91);
  const tri = (a, b, c, mat, cen, rnd) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let n = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]; const l = Math.hypot(...n) || 1; n = n.map(x => x / l);
    for (const p of [a, b, c]) { P.push(...p); Nn.push(...n); C.push(...cen); Rn.push(...rnd); M.push(mat); }
  };
  const quad = (a, b, c, d, mat) => {
    const cen = [(a[0] + b[0] + c[0] + d[0]) / 4, (a[1] + b[1] + c[1] + d[1]) / 4, (a[2] + b[2] + c[2] + d[2]) / 4], rnd = [R(), R(), R()];
    tri(a, b, c, mat, cen, rnd); tri(a, c, d, mat, cen, rnd);
  };
  const SIDES = 6, FLAT = 0.52;
  const ring = (z, r, rot = 0) => Array.from({ length: SIDES }, (_, i) => { const a = rot + i * Math.PI * 2 / SIDES; return [Math.cos(a) * r, Math.sin(a) * r * FLAT, z]; });
  // a long armoured blade: engine block aft, a thicker collar amidships, needle bow
  const prof = [[-0.86, 0.066], [-0.80, 0.124], [-0.60, 0.134], [-0.52, 0.098], [-0.40, 0.09], [-0.36, 0.104], [-0.05, 0.108], [0.0, 0.126], [0.09, 0.126], [0.14, 0.1], [0.45, 0.082], [0.75, 0.05], [0.95, 0.018], [1.0, 0.004]];
  for (let s = 0; s < prof.length - 1; s++) {
    const [z0, r0] = prof[s], [z1, r1] = prof[s + 1], n = Math.max(1, Math.round((z1 - z0) / 0.07));
    for (let k = 0; k < n; k++) {
      const A = ring(lerp(z0, z1, k / n), lerp(r0, r1, k / n)), B = ring(lerp(z0, z1, (k + 1) / n), lerp(r0, r1, (k + 1) / n));
      for (let i = 0; i < SIDES; i++) {
        const j = (i + 1) % SIDES;
        // split each facet across its width too, so the plates stay small when the hull bursts
        const mA = A[i].map((v, q) => (v + A[j][q]) / 2), mB = B[i].map((v, q) => (v + B[j][q]) / 2);
        quad(A[i], mA, mB, B[i], 0); quad(mA, A[j], B[j], mB, 0);
      }
    }
  }
  { const A = ring(1.0, 0.004), c = [0, 0, 1.0]; for (let i = 0; i < SIDES; i++) tri(c, A[i], A[(i + 1) % SIDES], 0, c, [R(), R(), R()]); }
  // engines: one main bell, six verniers; mat 2 = plasma
  const bell = (ex, ey, r0, r1, z0, z1) => {
    const circle = (z, r) => Array.from({ length: 10 }, (_, i) => { const a = i * Math.PI / 5; return [ex + Math.cos(a) * r, ey + Math.sin(a) * r, z]; });
    const A = circle(z0, r0), B = circle(z1, r1);
    for (let i = 0; i < 10; i++) { const j = (i + 1) % 10; quad(B[i], B[j], A[j], A[i], 1); quad(A[i], A[j], B[j], B[i], 1); tri([ex, ey, z1 + 0.012], B[j], B[i], 2, [ex, ey, z1], [R(), R(), R()]); }
  };
  bell(0, 0, 0.022, 0.05, -0.86, -0.97);
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; bell(Math.cos(a) * 0.078, Math.sin(a) * 0.078 * FLAT * 1.25, 0.01, 0.021, -0.86, -0.915); }
  const box = (cx, cy, cz, sx, sy, sz, mat) => {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], mat); quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], mat);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], mat); quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], mat);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], mat); quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], mat);
  };
  // four swept radiator blades (mat 4), each split into panels
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const tilt = 0.5 * sy, c = Math.cos(tilt), sn = Math.sin(tilt);
    const pt = (r, z) => [sx * c * r, sn * r, z];
    const NP = 5;
    for (let k = 0; k < NP; k++) {
      const u0 = k / NP, u1 = (k + 1) / NP, r0 = lerp(0.1, 0.33, u0), r1 = lerp(0.1, 0.33, u1);
      const zf0 = lerp(-0.42, -0.72, u0), zf1 = lerp(-0.42, -0.72, u1), zb0 = lerp(-0.78, -0.9, u0), zb1 = lerp(-0.78, -0.9, u1);
      const A = pt(r0, zb0), B = pt(r1, zb1), Cc = pt(r1, zf1), D = pt(r0, zf0);
      quad(A, B, Cc, D, 4); quad(D, Cc, B, A, 4);
    }
  }
  // spine, bridge, turrets, sensor boom
  box(0, 0.062, 0.2, 0.05, 0.022, 0.3, 3); box(0, 0.08, 0.26, 0.028, 0.02, 0.09, 3);
  box(0, 0.058, -0.2, 0.026, 0.018, 0.3, 1); box(0, -0.058, -0.02, 0.034, 0.018, 0.62, 1);
  for (const sx of [-1, 1]) { box(sx * 0.112, 0, -0.2, 0.026, 0.03, 0.26, 1); box(sx * 0.088, 0, 0.3, 0.02, 0.022, 0.22, 1); box(sx * 0.13, 0, -0.7, 0.03, 0.05, 0.16, 0); }
  for (let k = 0; k < 5; k++) { const z = -0.3 + k * 0.17; box(0.045 * (k % 2 ? 1 : -1), 0.052, z, 0.022, 0.014, 0.034, 1); box(0.045 * (k % 2 ? -1 : 1), -0.052, z + 0.05, 0.022, 0.014, 0.034, 1); }
  box(0, 0, 1.03, 0.006, 0.006, 0.09, 1);
  // a stockier hull reads as a ship rather than a needle when two thousand of them recede into the distance
  for (const arr of [P, C]) for (let i = 0; i < arr.length; i += 3) { arr[i] *= 1.42; arr[i + 1] *= 1.42; arr[i + 2] *= 0.9; }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('aCen', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('aRnd', new THREE.Float32BufferAttribute(Rn, 3)); g.setAttribute('aMat', new THREE.Float32BufferAttribute(M, 1));
  return g;
}


const COMMON = /* glsl */`
uniform float uTime;
attribute vec3 iPos, iDir, iHd; attribute vec4 iT;     // start position, escape heading, droplet heading at the hit; hit time, escape time, seed, thrust factor
vec3 shipPos(float t){ float te = max(0., min(t, iT.x) - iT.y); float k = te < ${BURN.toFixed(1)} ? .5 * te * te : ${BURN.toFixed(1)} * (te - ${(BURN / 2).toFixed(1)}); return iPos + iDir * (${ACC.toFixed(3)} * iT.w * k); }
vec3 rotAxis(vec3 v, vec3 ax, float a){ float c = cos(a), s = sin(a); return v * c + cross(ax, v) * s + ax * dot(ax, v) * (1. - c); }
`;
const HEAT = /* glsl */`
vec3 heatColor(float T){            // T 0..1 : dull red -> orange -> yellow -> white
  vec3 c = vec3(1., .12, .01) * smoothstep(0., .25, T);
  c = mix(c, vec3(1., .42, .06), smoothstep(.2, .5, T));
  c = mix(c, vec3(1., .82, .45), smoothstep(.45, .8, T));
  c = mix(c, vec3(.92, .95, 1.), smoothstep(.75, 1., T));
  return c * (.2 + 3. * T * T);
}`;
const B = BLAST.toFixed(2);

export default async function create({ renderer, quality, film }) {
  const plan = planBattle();
  const scene = new THREE.Scene(), nearScene = new THREE.Scene();
  const space = makeSpace({ stars: 11000, seed: 5, galaxyTilt: [0.2, 0.55, 0.81] });
  const sun = makeFarSun(SUN_DIR.toArray(), { color: [1, 0.95, 0.86], size: 0.006, gain: 1.3 });
  scene.add(space.group, sun.mesh);

  const U = { uTime: { value: 0 }, uSunDir: { value: SUN_DIR }, uPx: { value: 1 },
    uLpos: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) }, uLcol: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) } };

  // ---------- ships ----------
  const iPos = new THREE.InstancedBufferAttribute(plan.pos0, 3), iDir = new THREE.InstancedBufferAttribute(plan.dir, 3), iHd = new THREE.InstancedBufferAttribute(plan.hd, 3);
  const iT = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  for (let i = 0; i < N; i++) iT.setXYZW(i, plan.hit[i], plan.esc[i], plan.seed[i], plan.fac[i]);
  const withInst = g => { g.setAttribute('iPos', iPos); g.setAttribute('iDir', iDir); g.setAttribute('iHd', iHd); g.setAttribute('iT', iT); g.instanceCount = N; return g; };
  const shipGeo = withInst(shipGeometry());
  const shipMat = new THREE.ShaderMaterial({
    uniforms: U, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      ${COMMON}
      attribute vec3 aCen, aRnd; attribute float aMat;
      varying vec3 vN, vWp, vL, vEntry; varying float vMat, vU, vThrust, vSeed, vPlate;
      void main(){
        float u = uTime - iT.x, ub = max(0., u - ${B});
        vec3 p = position, n = normal;
        if (ub > 0.) {
          vec3 d = normalize(aCen * vec3(1., 1., .32) + (aRnd - .5) * .22);
          vec3 ax = normalize(aRnd - .5 + 1e-3); float spin = ub * (1.5 + 6. * aRnd.y);
          float shrink = 1. - smoothstep(.6, 6. + 5. * aRnd.z, ub);
          p = aCen + rotAxis(p - aCen, ax, spin) * shrink + d * (.35 + 1.6 * aRnd.x * aRnd.x) * (1. - exp(-ub * .9)) * 2.2;
          n = rotAxis(n, ax, spin);
        }
        // turn the bow toward the escape heading
        vec3 fwd = vec3(0., 0., 1.), axT = cross(fwd, iDir); float sl = length(axT), turn = smoothstep(0., 3., uTime - iT.y);
        if (sl > 1e-4) { float ang = atan(sl, dot(fwd, iDir)) * turn; axT /= sl; p = rotAxis(p, axT, ang); n = rotAxis(n, axT, ang); }
        vec3 sp = shipPos(uTime), wp = sp + p;
        vN = n; vWp = wp; vL = position; vMat = aMat; vU = u; vSeed = iT.z; vPlate = aRnd.x;
        vEntry = shipPos(iT.x) - iHd * .15;
        vThrust = smoothstep(0., 1.5, uTime - iT.y) * smoothstep(${(BURN + 3).toFixed(1)}, ${(BURN - 1).toFixed(1)}, uTime - iT.y) * step(u, 0.) * iT.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform vec3 uSunDir; uniform float uTime; uniform vec3 uLpos[8]; uniform vec3 uLcol[8];
      varying vec3 vN, vWp, vL, vEntry; varying float vMat, vU, vThrust, vSeed, vPlate;
      ${GLSL_NOISE} ${HEAT}
      void main(){
        vec3 N = normalize(vN); float inside = gl_FrontFacing ? 0. : 1.; if (inside > .5) N = -N;
        vec3 V = normalize(cameraPosition - vWp);
        int m = int(vMat + .5);
        // armour: two scales of panelling, slightly different per ship; fine detail fades before it can alias
        vec3 q = vL * vec3(52., 52., 21.);
        float pan = hash13(floor(q) + vSeed * 31.), pan2 = hash13(floor(q * .25) + 7.);
        N = normalize(N + (hash33(floor(q) + vSeed) - .5) * .16);
        vec3 alb = mix(vec3(.17, .185, .21), vec3(.31, .325, .35), pan * .6 + pan2 * .4) * (.7 + .5 * vSeed);
        alb *= mix(vec3(1.06, 1., .93), vec3(.93, 1., 1.08), fract(vSeed * 7.13));                        // some hulls run warmer, some colder
        vec3 fq = abs(fract(q) - .5); float fw = clamp(length(fwidth(q)) * 1.5, 0., 1.);
        float groove = smoothstep(.45, .5, max(fq.x, max(fq.y, fq.z))) * (1. - fw);
        vec3 q2 = q * 5.; vec3 fq2 = abs(fract(q2) - .5); float fw2 = clamp(length(fwidth(q2)) * 1.6, 0., 1.);
        float groove2 = smoothstep(.46, .5, max(fq2.x, max(fq2.y, fq2.z))) * (1. - fw2);
        alb *= (1. - .5 * groove) * (1. - .22 * groove2) * (.92 + .16 * hash13(floor(q2) + 3.) * (1. - fw2));
        alb = mix(alb, vec3(.5, .13, .06), step(.93, pan2) * step(abs(vL.z - .05), .06) * .8);          // squadron band on the collar
        if (m == 1) alb = vec3(.07, .075, .085);
        if (m == 3) alb = vec3(.13, .14, .16);
        if (m == 4) alb = vec3(.035, .036, .04);
        float sunD = max(dot(N, uSunDir), 0.);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.), 60.) * .9;
        float occ = .55 + .45 * smoothstep(-.6, .5, dot(N, normalize(vL * vec3(1., 1., .15) + 1e-4)));       // faces turned toward the hull's own axis sit in its shade
        vec3 col = alb * (vec3(1., .96, .88) * sunD * 1.9 * occ + vec3(.022, .028, .045)) + vec3(1., .95, .85) * spec * sunD * 1.4;
        col += alb * vec3(.07, .09, .14) * pow(1. - max(dot(N, V), 0.), 3.);                   // rim from the galaxy
        for (int i = 0; i < 8; i++) {
          vec3 Lv = uLpos[i] - vWp; float d2 = dot(Lv, Lv);
          col += alb * uLcol[i] * max(dot(N, Lv * inversesqrt(d2 + 1e-6)), 0.) / (1. + d2 * .35);
        }
        col *= 1. - .85 * inside;
        // running lights + windows
        vec3 lq = vL * vec3(300., 260., 420.); float lf = 1. - clamp(length(fwidth(lq)) * .7, 0., 1.);
        float lights = step(.988, hash13(floor(lq) + vSeed * 9.)) * step(float(m), .5) * step(abs(fract(lq.z * .125) - .5), .2);
        lights += step(.93, hash13(floor(vL * vec3(240., 300., 500.)))) * float(m == 3);
        vec3 emis = vec3(1., .82, .58) * lights * 3.2 * lf * step(vU, 0.) * (1. - inside);
        if (m == 4) {                                                                                  // radiators run dull red
          float st = smoothstep(.06, .12, abs(fract(length(vL.xy) * 40.) - .5));
          emis += vec3(1., .16, .03) * (.02 + .5 * (1. - st)) * (.35 + .65 * clamp(vThrust, 0., 1.)) * step(vU, 0.);
        }
        if (m == 2) emis += mix(vec3(.25, .5, 1.) * 2.2, vec3(.7, .88, 1.) * 26., clamp(vThrust, 0., 1.)) * step(vU, 0.);
        // struck: heat spreads through the hull from the puncture for one long second, then the fusion fuel goes
        if (vU > 0.) {
          float pre = min(vU, ${B}), d = length(vWp - vEntry), front = .06 + pre * 1.25;
          float T = smoothstep(front, front - .32, d) * (.16 + .36 * pre / ${B}) * (.7 + .6 * pan);
          T += groove * .22 * smoothstep(front, front - .5, d);                                          // seams leak the light of what is inside
          T = max(T, exp(-d * 55.) * 1.1);                                                               // the wound itself is white-hot at once
          float ub = max(0., vU - ${B});
          T = mix(T, 1., step(1e-4, ub)) * exp(-ub * (.22 + .5 * vPlate));
          T = clamp(T, 0., 1.);
          emis += heatColor(T) * mix(1.6, 4., step(1e-4, ub)) * (1. + inside);
          col *= 1. - .93 * smoothstep(0., .3, T);
        }
        gl_FragColor = vec4(col + emis, 1.);
      }`,
  });
  const ships = new THREE.Mesh(shipGeo, shipMat); ships.frustumCulled = false;
  scene.add(ships);

  // ---------- fireballs, shock rings, molten clouds, engine flares (instanced billboards) ----------
  const quadGeo = () => { const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3)); g.setIndex([0, 1, 2, 0, 2, 3]); return withInst(g); };
  const BILL = /* glsl */`
    vec3 bill(vec3 c, vec2 q, float s){ vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]); return c + (r * q.x + u * q.y) * s; }`;
  const fireMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      ${COMMON} ${BILL}
      varying vec2 vUv; varying float vU, vSeed, vSize, vRf, vRr;
      void main(){
        float u = uTime - iT.x, ub = max(0., u - ${B});
        // before the blast: a small fierce glow at the puncture. after: the fireball at the ship's heart
        float rf = u < ${B} ? .02 + .045 * (1. - exp(-u * 5.)) + .03 * u : .36 + 1.25 * (1. - exp(-ub * 2.6)) + ub * .06;
        float rr = ub * 3.0 + .36;
        float alive = step(0., u) * step(u, ${(BLAST + 7).toFixed(1)});
        float size = max(rf * 3.2, rr * 1.1 * step(ub, 2.6) * step(1e-4, ub)) * alive;
        vec3 c = shipPos(iT.x) - iHd * .15 * step(u, ${B});
        vUv = position.xy; vU = u; vSeed = iT.z; vSize = size; vRf = rf; vRr = rr;
        gl_Position = projectionMatrix * viewMatrix * vec4(bill(c, position.xy, size), 1.);
      }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv; varying float vU, vSeed, vSize, vRf, vRr; uniform float uTime;
      ${GLSL_NOISE}
      void main(){
        float r = length(vUv) * vSize; if (r > vSize) discard;
        float ub = max(0., vU - ${B});
        float a = atan(vUv.y, vUv.x), rn = r / vRf;
        vec2 pp = vUv * vSize;
        float n = fbm(pp * 1.5 + vSeed * 20. + vec2(0., -ub * .7)), n2 = fbm(pp * 4. - vSeed * 11. + ub);
        float pre = step(vU, ${B});
        float soft = mix(.035, .95, max(smoothstep(0., 1.1, ub), pre));
        float body = 1. - smoothstep(1. - soft, 1., rn + (n - .5) * .5 * smoothstep(.05, 1.4, ub));
        float depth = sqrt(max(0., 1. - min(rn, 1.) * min(rn, 1.)));
        float I = pre > .5 ? 6. * exp(-vU * 9.) + .5 + .7 * vU : 22. * exp(-ub * 2.6) + 1.8 * exp(-ub * 1.1) + .7 * exp(-ub * .4);
        vec3 hot = mix(vec3(.8, .9, 1.), vec3(1., .8, .46), smoothstep(.0, .7, ub));
        hot = mix(hot, vec3(1., .36, .08), smoothstep(.6, 2.6, ub));
        hot = mix(hot, vec3(1., .72, .4), pre * smoothstep(.05, .5, vU));
        vec3 col = hot * body * mix(.3 + .95 * depth, 1.6 * depth * depth, max(smoothstep(.2, 1.2, ub), pre)) * (.55 + .9 * n2) * I;
        float gl = exp(-ub * 2.6) * step(1e-4, ub) + pre * .35 * exp(-vU * 8.);
        float edge = smoothstep(vSize, vSize * .5, r);
        col += hot * gl * (2.2 / (1. + rn * rn * 3.5)) * edge;
        float spikes = pow(abs(cos(a * 3. + vSeed * 6.28)), 90.) + .6 * pow(abs(cos(a * 3. + vSeed * 6.28 + 1.05)), 200.);
        col += hot * gl * spikes * 1.5 / (1. + rn * 1.4) * edge;
        float w = .07 + ub * .09, ring = exp(-pow((r - vRr) / w, 2.)) + .1 * smoothstep(vRr, vRr * .3, r) * step(r, vRr);
        col += vec3(.5, .7, 1.) * ring * .55 * exp(-ub * 2.6) * step(1e-4, ub) * (.5 + n);
        gl_FragColor = vec4(col, 1.);
      }`,
  });
  const fire = new THREE.Mesh(quadGeo(), fireMat); fire.frustumCulled = false; fire.renderOrder = 4;

  const cloudMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      ${COMMON} ${BILL}
      varying vec2 vUv; varying float vUb, vSeed, vNear, vLod; uniform float uPx;
      void main(){
        float ub = uTime - iT.x - ${B};
        float size = (1.2 + 5.6 * (1. - exp(-max(ub, 0.) * .05))) * step(.4, ub);
        vUv = position.xy; vUb = ub; vSeed = iT.z;
        vec3 drift = normalize(vec3(fract(iT.z * 17.3), fract(iT.z * 31.7), fract(iT.z * 53.1)) - .5) * max(ub, 0.) * .11;
        vec3 cc = shipPos(iT.x) + drift;
        vNear = smoothstep(.25, 1.1, length(cameraPosition - cc) / max(size, 1e-3));          // a camera flying through the wreck passes between the clouds, not through cards
        gl_Position = projectionMatrix * viewMatrix * vec4(bill(cc, position.xy, size), 1.);
        vLod = clamp(size / gl_Position.w * projectionMatrix[1][1] * 540. * uPx / 150., 0., 1.);          // far clouds are smooth glows, near ones have structure
      }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv; varying float vUb, vSeed, vNear, vLod; uniform float uTime;
      ${GLSL_NOISE}
      void main(){
        float r = length(vUv); if (r > 1.) discard;
        vec2 p = vUv * 2.3 + vSeed * 37.; float sw = vUb * .02;
        float w = vnoise(p * .8 - sw);
        float n = fbm(p + vec2(sw, -sw) + w * 1.5);
        float fil = 1. - abs(2. * vnoise(p * 2.1 + w * 2.2 + 11.) - 1.);                    // ridged filaments
        float d = smoothstep(1., 0., r + (n - .5) * .9); d *= d;
        n = mix(.6, n, .4 + .6 * vLod); float dens = d * (.4 + .8 * n * n + .4 * fil * fil * vLod);
        float I = smoothstep(.4, 3., vUb) * (.42 * exp(-vUb / 12.) + .17 * exp(-vUb / 260.));
        float Tc = clamp(dens * (1.3 * exp(-vUb / 10.) + .38), 0., 1.);
        vec3 c = mix(vec3(.42, .03, .008), vec3(1., .3, .06), smoothstep(.1, .6, Tc)); c = mix(c, vec3(1., .7, .35), smoothstep(.6, 1., Tc));
        gl_FragColor = vec4(c * dens * I * vNear, 1.);
      }`,
  });
  const cloud = new THREE.Mesh(quadGeo(), cloudMat); cloud.frustumCulled = false; cloud.renderOrder = 2;

  const flareMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      ${COMMON} ${BILL}
      uniform float uPx;
      varying vec2 vUv; varying float vI, vFar;
      void main(){
        float burn = smoothstep(0., 1.5, uTime - iT.y) * smoothstep(${(BURN + 3).toFixed(1)}, ${(BURN - 1).toFixed(1)}, uTime - iT.y) * min(iT.w, 2.);
        float alive = step(uTime, iT.x);
        vec3 fwd = vec3(0., 0., 1.), axT = cross(fwd, iDir); float sl = length(axT), turn = smoothstep(0., 3., uTime - iT.y);
        vec3 tail = vec3(0., 0., -.9);
        if (sl > 1e-4) tail = rotAxis(tail, axT / sl, atan(sl, dot(fwd, iDir)) * turn);
        vec3 c = shipPos(uTime) + tail * mix(.2, 1., step(.02, burn));
        float aft = smoothstep(-.35, .75, dot(normalize(cameraPosition - c), normalize(tail)));          // the glare belongs to whoever is behind the ship
        vec4 mv = viewMatrix * vec4(c, 1.); float dist = -mv.z;
        // near: the engine glare. far: a sunlit hull is smaller than a pixel, so draw it as a steady point of light
        float far = smoothstep(14., 60., dist);
        float size = max((.07 + .42 * burn * (.35 + .65 * aft)) * (1. - far * (1. - burn)), far * dist * .003 * uPx);
        vUv = position.xy; vI = (.035 + burn * (.1 + .9 * aft)) * alive; vFar = far * alive * (1. - min(burn, 1.));
        gl_Position = projectionMatrix * viewMatrix * vec4(bill(c, position.xy, size * alive), 1.);
      }`,
    fragmentShader: /* glsl */`precision highp float; varying vec2 vUv; varying float vI, vFar;
      void main(){ float r = length(vUv); if (r > 1.) discard; float g = exp(-r * r * 9.) * 9. + .7 / (1. + r * r * 30.) * smoothstep(1., .5, r);
        float st = exp(-abs(vUv.y) * 26.) * exp(-abs(vUv.x) * 2.6) * 2.;
        vec3 col = vec3(.5, .74, 1.) * (g + st) * vI * 1.1 * (1. - vFar);
        col += vec3(.9, .93, 1.) * exp(-r * r * 5.) * .8 * vFar;
        gl_FragColor = vec4(col, 1.); }`,
  });
  const flare = new THREE.Mesh(quadGeo(), flareMat); flare.frustumCulled = false; flare.renderOrder = 3;
  scene.add(cloud, flare, fire);

  // ---------- molten debris: a jet out of the exit wound at once, the rest when the ship bursts ----------
  const PER = Math.max(12, Math.floor(44 * quality.density)), ND = N * PER;
  let debris;
  {
    const R = rng(606), a = new Float32Array(ND * 3), b = new Float32Array(ND * 3), c = new Float32Array(ND * 4), d = new Float32Array(ND * 4), e = new Float32Array(ND * 3);
    for (let i = 0; i < N; i++) for (let k = 0; k < PER; k++) {
      const j = i * PER + k; let x, y, z, l; do { x = R() * 2 - 1; y = R() * 2 - 1; z = R() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-3);
      l = Math.sqrt(l); const sp = 0.03 + 0.55 * Math.pow(R(), 2.2);
      a.set([plan.pos0[i * 3], plan.pos0[i * 3 + 1], plan.pos0[i * 3 + 2]], j * 3); b.set([plan.dir[i * 3], plan.dir[i * 3 + 1], plan.dir[i * 3 + 2]], j * 3);
      c.set([plan.hit[i], plan.esc[i], plan.seed[i], plan.fac[i]], j * 4); d.set([x / l * sp, y / l * sp * 0.75, z / l * sp, R()], j * 4);
      e.set([plan.hd[i * 3], plan.hd[i * 3 + 1], plan.hd[i * 3 + 2]], j * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ND * 3), 3));
    g.setAttribute('iPos', new THREE.BufferAttribute(a, 3)); g.setAttribute('iDir', new THREE.BufferAttribute(b, 3)); g.setAttribute('iT', new THREE.BufferAttribute(c, 4)); g.setAttribute('aV', new THREE.BufferAttribute(d, 4)); g.setAttribute('iHd', new THREE.BufferAttribute(e, 3));
    debris = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        ${COMMON} ${HEAT}
        attribute vec4 aV; uniform float uPx; varying vec3 vC;
        void main(){
          float u = uTime - iT.x, ub = u - ${B};
          float jet = step(aV.w, .12), jw = aV.w / .12;                 // one particle in eight sprays out of the exit wound
          vec3 pj = shipPos(iT.x) + iHd * .16 + (iHd * (.25 + 1.5 * jw) + aV.xyz * .9) * (1. - exp(-max(u, 0.) * 1.6)) * .9;
          vec3 pb = shipPos(iT.x) + aV.xyz * ub * (1. + 2.4 / (1. + max(ub, 0.) * .5));
          vec3 p = mix(pb, pj, jet);
          float age = mix(ub, u, jet);
          float T = exp(-max(age, 0.) * mix(.035 + .11 * aV.w, .9, jet)) * (.55 + .45 * fract(aV.w * 7.));
          vC = heatColor(T) * (.5 + .6 * fract(aV.w * 13.)) * step(0., age);
          vec4 mv = viewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mv;
          float px = uPx * (1.5 + 2.2 * fract(aV.w * 5.)) * (1. + 60. / (1. + -mv.z * 3.));
          gl_PointSize = clamp(px, 1.2, 26. * uPx) * step(0., age);
        }`,
      fragmentShader: `precision highp float; varying vec3 vC; void main(){ vec2 q = gl_PointCoord * 2. - 1.; float a = exp(-dot(q, q) * 3.5); gl_FragColor = vec4(vC * a, 1.); }`,
    }));
    debris.frustumCulled = false; debris.renderOrder = 3; scene.add(debris);
  }

  // ---------- the droplet ----------
  const path = plan.path;
  const dropAt = (t, out = [0, 0, 0]) => {
    let lo = 0, hi = path.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (path[m].t <= t) lo = m; else hi = m; }
    const a = path[lo], b = path[hi], k = clamp((t - a.t) / Math.max(1e-6, b.t - a.t), 0, 1);
    out[0] = lerp(a.p[0], b.p[0], k); out[1] = lerp(a.p[1], b.p[1], k); out[2] = lerp(a.p[2], b.p[2], k);
    out.seg = lo; return out;
  };
  const D0 = plan.start, firstP = plan.P(plan.firstI);
  const toFirst = v3norm(v3sub(firstP, D0));
  // n0: the direction from the resting droplet into the heart of the fleet; the opening shot looks at its mirror image
  const n0 = v3norm([0.36, -0.3, -0.88]);                                        // down the ranks, bows toward us
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const s0 = v3norm(cross(n0, [0, 1, 0])), up0 = v3norm(cross(s0, n0)), a0 = v3scale(s0, -1);   // resting axis: side-on to that view, head already toward the first ship
  const dropDir = t => { const s = dropAt(t).seg, a = path[s], b = path[Math.min(path.length - 1, s + 1)]; let d = v3sub(b.p, a.p); if (v3len(d) < 1e-6) d = toFirst; return v3norm(d); };
  // heading averaged over a blink: the acute turns become whips rather than cuts
  const heading = (t, w = 0.07) => { const a = dropAt(t - w).slice(0, 3), b = dropAt(t + w).slice(0, 3), d = v3sub(b, a); return v3len(d) < 1e-6 ? dropDir(t) : v3norm(d); };
  const dropAxis = t => {
    if (t >= T.go) { if (t < plan.tRest - 1.2) return heading(t); const k = smoother((t - plan.tRest + 1.2) / 1.6), h = t < plan.tRest - 0.1 ? heading(t) : heading(plan.tRest - 0.1); return v3norm(v3lerp(h, plan.restAxis, k)); }
    const k = smoother((t - T.halo - 0.6) / (T.go - T.halo - 1.0));               // it swings its head toward the fleet before it goes
    return v3norm(v3lerp(a0, toFirst, k));
  };
  const dropSmooth = (t, w = 2.5) => { const o = [0, 0, 0]; for (let k = 0; k < 24; k++) { const p = dropAt(t + ((k + 0.5) / 24 * 2 - 1) * w); o[0] += p[0] / 24; o[1] += p[1] / 24; o[2] += p[2] / 24; } return o; };

  // profile listed tail -> head (ascending along the lathe axis) so the outside of the surface is the front face
  const prof = []; for (let i = 128; i >= 0; i--) { const s = Math.pow(i / 128, 1.5); prof.push(new THREE.Vector2(1.95 * Math.sqrt(s) * Math.pow(1 - s, 1.25), -3.4 * s + 1.0)); }
  const dropGeo = new THREE.LatheGeometry(prof, 128); dropGeo.rotateX(Math.PI / 2);          // head toward +z; widest (0.684 m) at z = 0
  const DROP_R = 0.684 * M2K;
  const cubeRT = new THREE.WebGLCubeRenderTarget(film ? 1024 : 256, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const cubeCam = new THREE.CubeCamera(0.02, 30000, cubeRT);
  // a second, much sharper capture of just the part of the surroundings the camera can see mirrored
  const HI = film ? 4096 : quality.name === 'high' ? 2048 : 1024;
  const hiRT = new THREE.WebGLRenderTarget(HI, HI, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, generateMipmaps: false, samples: film ? 0 : 4 });
  const hiCam = new THREE.PerspectiveCamera(118, 1, 0.02, 30000), hiVP = new THREE.Matrix4(), hiRot = new THREE.Matrix4();
  const dropMat = new THREE.ShaderMaterial({
    uniforms: { uEnv: { value: cubeRT.texture }, uHi: { value: hiRT.texture }, uHiVP: { value: hiVP }, uHiOn: { value: 0 }, uSunDir: U.uSunDir, uNM: { value: new THREE.Matrix3() }, uDbg: { value: +(new URLSearchParams(location.search).get('dbgm') || 0) }, uGl: { value: 1 } },
    // Everything in view space: at centimetre range world-space floats are far too coarse. The normal is the
    // analytic normal of the teardrop profile, not the mesh's interpolated one: a mirror shows every facet.
    vertexShader: `varying vec3 vObj, vPv; void main(){ vObj = position; vec4 mv = modelViewMatrix * vec4(position, 1.); vPv = mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`precision highp float; uniform samplerCube uEnv; uniform sampler2D uHi; uniform mat4 uHiVP; uniform mat3 uNM; uniform float uHiOn, uDbg, uGl; uniform vec3 uSunDir; varying vec3 vObj, vPv;
      void main(){
        float s = clamp((1. - vObj.z) / 3.4, 1e-4, 1. - 1e-4);
        float drds = 1.95 * (.5 * pow(s, -.5) * pow(1. - s, 1.25) - 1.25 * sqrt(s) * pow(1. - s, .25));
        vec2 er = normalize(vObj.xy + 1e-9);
        vec3 N = normalize(uNM * vec3(er, drds / 3.4)), V = normalize(-vPv), Rv = reflect(-V, N);
        vec3 Rr = normalize((vec4(Rv, 0.) * viewMatrix).xyz);                         // view -> world (rotation only)
        vec3 env = textureCube(uEnv, Rr).rgb;
        vec4 c = uHiVP * vec4(Rr, 0.);
        if (uHiOn > .5 && c.w > 0.) { vec2 nd = c.xy / c.w; float e = smoothstep(1., .6, max(abs(nd.x), abs(nd.y))); env = mix(env, texture2D(uHi, nd * .5 + .5).rgb, e); }
        float f = pow(1. - max(dot(N, V), 0.), 5.);
        vec3 col = env * mix(vec3(.94, .96, .99), vec3(1.), f) * 1.3 + vec3(.05, .07, .11) * f;
        col += vec3(1., .96, .88) * pow(max(dot(Rr, uSunDir), 0.), 2600.) * 300. * uGl;       // the far Sun, a pin-point highlight
        if (uDbg > .5) col = vec3(c.xy / c.w * .5 + .5, step(c.w, 0.)) * step(-1., -max(abs(c.x / c.w), abs(c.y / c.w)));
        if (uDbg > 1.5) col = N * .5 + .5;
        gl_FragColor = vec4(col, 1.); }`,
  });
  const drop = new THREE.Mesh(dropGeo, dropMat); drop.scale.setScalar(M2K); drop.frustumCulled = false;
  const _mv = new THREE.Matrix4();
  drop.onBeforeRender = (r, sc, cam) => { _mv.multiplyMatrices(cam.matrixWorldInverse, drop.matrixWorld); dropMat.uniforms.uNM.value.getNormalMatrix(_mv); };
  const haloU = { uI: { value: 0 }, uTime: U.uTime };
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.04, 12, 128), new THREE.ShaderMaterial({
    uniforms: haloU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `precision highp float; uniform float uI, uTime; varying vec3 vP;
      void main(){ float a = atan(vP.y, vP.x); float fl = .85 + .15 * sin(a * 9. + uTime * 5.) * sin(a * 4. - uTime * 3.); gl_FragColor = vec4(vec3(.42, .68, 1.) * 3.2 * uI * fl, 1.); }`,
  }));
  halo.position.z = -2.25; drop.add(halo);
  const haloGlow = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShaderMaterial({
    uniforms: haloU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv * 2. - 1.; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `precision highp float; uniform float uI; varying vec2 vUv; void main(){ float r = length(vUv) * 7.; float g = exp(-pow((r - 1.2) / .45, 2.)) * 1.2 + .3 / (1. + r * r); gl_FragColor = vec4(vec3(.3, .55, 1.) * g * uI * .22 * smoothstep(7., 3., r), 1.); }`,
  }));
  haloGlow.position.z = -2.25; drop.add(haloGlow);
  nearScene.add(drop);

  // far marker so the 3.4 m probe can be found from hundreds of kilometres away
  const glintU = { uP: { value: new THREE.Vector3() }, uI: { value: 1 }, uAspect: { value: 16 / 9 }, uSize: { value: 0.012 }, uHalo: haloU.uI };
  const glint = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: glintU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform vec3 uP; uniform float uAspect, uSize; varying vec2 vUv; void main(){ vUv = position.xy; vec4 c = projectionMatrix * viewMatrix * vec4(uP, 1.); c.xy += position.xy * vec2(1., uAspect) * uSize * c.w; gl_Position = c; }`,
    fragmentShader: `precision highp float; uniform float uI, uHalo; varying vec2 vUv;
      void main(){ float r = length(vUv); if (r > 1.) discard; float core = exp(-r * r * 90.) * 5.;
        float st = (exp(-abs(vUv.y) * 70.) * exp(-abs(vUv.x) * 3.2) + exp(-abs(vUv.x) * 70.) * exp(-abs(vUv.y) * 3.2)) * 1.3;
        vec3 c = mix(vec3(.85, .92, 1.), vec3(.4, .65, 1.), uHalo * .7);
        gl_FragColor = vec4(c * (core + st) * uI * (1. + 2.5 * uHalo), 1.); }`,
  }));
  glint.frustumCulled = false; glint.renderOrder = 6; scene.add(glint);

  // trail: the whole path as one ribbon; the shader shows only the last few seconds behind the droplet
  const trailU = { uTime: U.uTime, uRes: { value: new THREE.Vector2(1920, 1080) }, uTail: { value: 2.4 }, uWidth: { value: 1.8 } };
  let trail;
  {
    const n = path.length, pos = new Float32Array(n * 2 * 3), nxt = new Float32Array(n * 2 * 3), tt = new Float32Array(n * 2), sd = new Float32Array(n * 2), idx = [];
    for (let i = 0; i < n; i++) for (let s = 0; s < 2; s++) {
      const j = i * 2 + s, p = path[i].p, q = path[Math.min(n - 1, i + 1)].p, pp = path[Math.max(0, i - 1)].p;
      pos.set(p, j * 3); nxt.set(i < n - 1 ? q : [2 * p[0] - pp[0], 2 * p[1] - pp[1], 2 * p[2] - pp[2]], j * 3); tt[j] = Math.min(path[i].t, 1e5); sd[j] = s ? 1 : -1;
    }
    for (let i = 0; i < n - 2; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aNext', new THREE.BufferAttribute(nxt, 3)); g.setAttribute('aT', new THREE.BufferAttribute(tt, 1)); g.setAttribute('aSide', new THREE.BufferAttribute(sd, 1));
    g.setIndex(idx);
    trail = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: trailU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute vec3 aNext; attribute float aT, aSide; uniform vec2 uRes; uniform float uWidth; varying float vT, vE;
        void main(){ vec4 c = projectionMatrix * viewMatrix * vec4(position, 1.), c2 = projectionMatrix * viewMatrix * vec4(aNext, 1.);
          vec2 d = (c2.xy / max(c2.w, 1e-4) - c.xy / max(c.w, 1e-4)) * uRes; d = normalize(d + 1e-5);
          c.xy += vec2(-d.y, d.x) * aSide * uWidth / uRes * c.w; gl_Position = c; vT = aT; vE = aSide; }`,
      fragmentShader: `precision highp float; uniform float uTime, uTail; varying float vT, vE;
        void main(){ float age = uTime - vT; if (age < 0.) discard; float k = exp(-age / uTail * 3.);
          gl_FragColor = vec4(mix(vec3(.25, .45, 1.), vec3(.8, .92, 1.), k * k) * (k * 1.5) * exp(-vE * vE * 2.4), 1.); }`,
    }));
    trail.frustumCulled = false; trail.renderOrder = 5; scene.add(trail);
  }

  // ---------- per-frame ----------
  const order = plan.order, hitSorted = order.map(i => plan.hit[i]);
  const FWD = new THREE.Vector3(0, 0, 1), dv = new THREE.Vector3(), tmpV = new THREE.Vector3(), tmpU = new THREE.Vector3();
  const dp = [0, 0, 0];
  let trailOn = true, debrisCap = false, frameNo = 0, nearActive = false, hiActive = false, camDrop = 1e9, mainNear = 0.05, cubeStamp = -1;
  const destroyed = t => { let lo = 0, hi = hitSorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (hitSorted[m] <= t) lo = m + 1; else hi = m; } return lo; };
  const shipNow = (i, t) => plan.posAt(i, Math.min(t, plan.hit[i]));

  function update(t, env) {
    U.uTime.value = t; U.uPx.value = env.h / 1080; space.setViewport(env.h);
    const cam = env.camera, asp = env.w / env.h; sun.uniforms.uAspect.value = asp; glintU.uAspect.value = asp; trailU.uRes.value.set(env.w, env.h);
    dropAt(t, dp); const d = dropAxis(t);
    drop.position.set(dp[0], dp[1], dp[2]); drop.quaternion.setFromUnitVectors(FWD, dv.set(d[0], d[1], d[2]));
    glintU.uP.value.set(dp[0], dp[1], dp[2]);
    const moving = t > T.go && t < plan.tRest - 0.8;
    haloU.uI.value = smooth(T.halo, T.halo + 1.6, t) * (1 - smooth(plan.tRest - 1.4, plan.tRest + 0.5, t)) * (moving ? 1 : 0.8 + 0.2 * Math.sin(t * 2.2));
    camDrop = cam.position.distanceTo(drop.position); trailOn = camDrop > 0.05; trail.visible = trailOn; debrisCap = t > plan.tLast;
    glintU.uI.value = smooth(0.03, 0.6, camDrop) * 0.9; glintU.uSize.value = 0.011;

    // lights: the brightest recent fireballs
    const nd = destroyed(t - BLAST); let nl = 0;
    for (let k = nd - 1; k >= 0 && nl < 8; k--) {
      const i = order[k], ub = t - plan.hit[i] - BLAST; if (ub > 5) break;
      const I = 60 * Math.exp(-ub * 1.25) + 3 * Math.exp(-ub * 0.42);
      if (k < nd - 1 && nl >= 3 && (nd - 1 - k) % 3) continue;          // spread the 8 slots over the last few seconds
      const p = plan.posAt(i, plan.hit[i]); U.uLpos.value[nl].set(p[0], p[1], p[2]); U.uLcol.value[nl].set(1.0 * I, 0.62 * I, 0.32 * I); nl++;
    }
    for (; nl < 8; nl++) U.uLcol.value[nl].set(0, 0, 0);

    // clip planes from the nearest ship
    let dmin = 1e9; const cp = cam.position, P0 = plan.pos0;
    for (let i = 0; i < N; i++) { const p = plan.esc[i] < t ? plan.posAt(i, Math.min(t, plan.hit[i])) : null; const x = (p ? p[0] : P0[i * 3]) - cp.x, y = (p ? p[1] : P0[i * 3 + 1]) - cp.y, z = (p ? p[2] : P0[i * 3 + 2]) - cp.z, dd = x * x + y * y + z * z; if (dd < dmin) dmin = dd; }
    dmin = Math.sqrt(dmin);
    nearActive = camDrop < 1.5; hiActive = camDrop < 0.03;
    mainNear = clamp(Math.max(0, dmin - 1.2) * 0.3, 0.0015, 3);
    cam.near = mainNear; cam.far = 40000;
    frameNo++;
  }

  function render(r, cam, target, env) {
    // mirror: re-capture the surroundings from the droplet when the camera is close enough to see it
    const stamp = Math.round(U.uTime.value * 240);
    if (nearActive && (env.film ? stamp !== cubeStamp : frameNo % 3 === 0)) {
      cubeStamp = stamp; glint.visible = false; debris.visible = debrisCap; trail.visible = false;
      cubeCam.position.copy(drop.position); cubeCam.update(r, scene);
      glint.visible = true; debris.visible = true; trail.visible = trailOn;
    }
    dropMat.uniforms.uHiOn.value = hiActive ? 1 : 0; dropMat.uniforms.uGl.value = clamp(camDrop / 0.009, 0.1, 1);
    if (hiActive) {
      // aim the sharp capture where the camera's own mirror image would be: back along the line from droplet to camera
      tmpV.copy(cam.position).sub(drop.position).normalize(); tmpU.set(0, 1, 0).applyQuaternion(cam.quaternion);
      hiCam.position.copy(drop.position); hiCam.up.copy(tmpU); hiCam.lookAt(tmpV.add(drop.position));
      if (env.film) { hiCam.rotateX((((frameNo * 7) % 16) / 16 - 0.5) * 0.00045); hiCam.rotateY((((frameNo * 11) % 16) / 16 - 0.5) * 0.00045); }   // sub-texel jitter: the film's sample accumulation turns it into anti-aliasing
      hiCam.updateMatrixWorld(true); hiCam.updateProjectionMatrix();
      hiRot.extractRotation(hiCam.matrixWorldInverse); hiVP.multiplyMatrices(hiCam.projectionMatrix, hiRot);
      glint.visible = false; debris.visible = debrisCap; trail.visible = false;
      r.setRenderTarget(hiRT); r.autoClear = true; r.render(scene, hiCam);
      glint.visible = true; debris.visible = true; trail.visible = trailOn;
    }
    r.setRenderTarget(target); r.autoClear = true; r.render(scene, cam);
    if (nearActive) {
      const n = cam.near, f = cam.far;
      cam.near = Math.max(3e-6, (camDrop - 0.0012) * 0.3); cam.far = camDrop + 0.03; cam.updateProjectionMatrix();
      r.autoClear = false; r.clearDepth(); r.render(nearScene, cam); r.autoClear = true;
      cam.near = n; cam.far = f; cam.updateProjectionMatrix();
    }
  }

  function post(t, env) {
    // exposure rides down while many suns are burning at once
    const nd = destroyed(t - BLAST), recent = nd - destroyed(t - BLAST - 2.5);
    const glare = clamp(recent / 60, 0, 1), dusk = smooth(plan.tLast + 1, plan.tLast + 9, t);
    const calm = 1 - smooth(T.go - 0.5, T.first + 1.2, t);
    return { exposure: lerp(1.0, 0.62, glare) * (1 + 0.5 * dusk) * (1 + 0.4 * calm), bloom: 0.36, bloomThreshold: 1.3, bloomKnee: 0.9, bloomRadius: 1.1, streak: 0.1, streakColor: [0.55, 0.72, 1.0],
      ca: 0.22, vignette: 0.5, grain: 0.02, saturation: 1.04, contrast: 1.06, tintLo: [0.94, 0.98, 1.08], tintHi: [1.04, 1.0, 0.96] };
  }

  // ---------- camera rigs ----------
  const L = plan.lines, hitT = i => plan.hit[i];
  // the opening: a camera a hand's width from the mirror. d = metres from the surface, s/h = sideways drift in metres
  const mirrorAt = (C, n0_, sv, uv) => (d, s, h, fov, swing = 0, pan = 0) => {
    const c = Math.cos(swing), sn = Math.sin(swing), n = [n0_[0] * c + sv[0] * sn, n0_[1] * c + sv[1] * sn, n0_[2] * c + sv[2] * sn];
    const r = (0.684 + d) * M2K, off = v3add(v3scale(sv, s * M2K), v3scale(uv, h * M2K));
    return { pos: v3add(v3add(C, v3scale(n, r)), off), look: v3add(v3add(C, v3scale(off, d < 0.6 ? 1 : 0.6 / d)), v3scale(sv, pan * M2K)), fov };
  };
  const mirrorCam = mirrorAt(D0, n0, s0, up0);
  // the same trick at the end: the droplet at rest, its flank turned to the wreck
  const R0 = plan.rest, rAx = plan.restAxis;
  const nR = (() => { const c = v3norm(v3sub([0, 0, -8], R0)), k = c[0] * rAx[0] + c[1] * rAx[1] + c[2] * rAx[2]; return v3norm([c[0] - rAx[0] * k, c[1] - rAx[1] * k, c[2] - rAx[2] * k]); })();
  const sR = v3norm(cross(nR, [0, 1, 0])), upR = v3norm(cross(sR, nR));
  const mirrorRest = mirrorAt(R0, nR, sR, upR);
  // a camera clamped to the droplet's back, like an action camera on a bonnet: the mirror fills the bottom of the frame
  const mount = (st, back, up, side, pitch, fov) => { const p = dropAt(st).slice(0, 3), d = heading(st), sd = v3norm(cross(d, [0, 1, 0])), uu = v3norm(cross(sd, d));
    const pos = [0, 1, 2].map(i => p[i] + (-d[i] * back + uu[i] * up + sd[i] * side) * M2K);
    return { pos, look: [0, 1, 2].map(i => pos[i] + (d[i] + uu[i] * pitch) * 0.05), fov }; };
  // bolted to the droplet: behind and above its tail, looking where it is going
  const onboard = (st, back, up, lead, fov, side = 0) => { const p = dropAt(st).slice(0, 3), d = dropDir(st), sd = v3norm(cross(d, [0, 1, 0])), uu = v3norm(cross(sd, d));
    return { pos: [p[0] - d[0] * back * M2K + uu[0] * up * M2K + sd[0] * side * M2K, p[1] - d[1] * back * M2K + uu[1] * up * M2K + sd[1] * side * M2K, p[2] - d[2] * back * M2K + uu[2] * up * M2K + sd[2] * side * M2K], look: v3add(p, v3scale(d, lead)), fov }; };
  // ahead of the hunt, looking back at it
  const chase = (t, dist, up, side, w = 3) => { const p = dropSmooth(t, w), q = dropSmooth(t + 1.2, w); let d = v3sub(q, p); d[1] = 0; d = v3len(d) > 1e-3 ? v3norm(d) : [1, 0, 0];
    return { pos: [p[0] + d[0] * dist + side * d[2], p[1] + up, p[2] + d[2] * dist - side * d[0]], look: [p[0] - d[0] * dist * 0.2, p[1], p[2] - d[2] * dist * 0.2] }; };
  // behind the hunt, flying after it
  const pursue = (t, dist, up, w = 1.6) => { const p = dropSmooth(t, w), q = dropSmooth(t + 1.0, w), b = dropSmooth(t - 1.0, w); let d = v3sub(q, b); d = v3len(d) > 1e-3 ? v3norm(d) : [1, 0, 0];
    return { pos: [b[0] - d[0] * dist, b[1] - d[1] * dist + up, b[2] - d[2] * dist], look: v3add(p, v3scale(d, dist * 0.6)) }; };
  // the droplet at rest, seen side-on, with what is left of the fleet behind it
  const restShot = (st, k, fov) => { const p = dropAt(st).slice(0, 3), d = dropDir(plan.tLast + 1), c = v3norm(v3sub([0, 0, 0], p)), dot = c[0] * d[0] + c[1] * d[1] + c[2] * d[2];
    const w = v3norm([c[0] - d[0] * dot, c[1] - d[1] * dot, c[2] - d[2] * dot]);
    return { pos: [p[0] - w[0] * k + d[0] * k * 0.3, p[1] - w[1] * k + k * 0.16, p[2] - w[2] * k + d[2] * k * 0.3], look: [p[0] - d[0] * 0.0005, p[1], p[2] - d[2] * 0.0005], fov }; };
  // riding a fleeing ship, looking back past its engines at what is coming
  const fromShip = (i, st, fov) => { const p = shipNow(i, st), d = [plan.dir[i * 3], plan.dir[i * 3 + 1], plan.dir[i * 3 + 2]], sd = v3norm(cross(d, [0, 1, 0])), uu = v3norm(cross(sd, d));
    return { pos: [p[0] + d[0] * 1.5 + uu[0] * 0.3 + sd[0] * 0.22, p[1] + d[1] * 1.5 + uu[1] * 0.3 + sd[1] * 0.22, p[2] + d[2] * 1.5 + uu[2] * 0.3 + sd[2] * 0.22], look: [p[0] - d[0] * 4, p[1] - d[1] * 4, p[2] - d[2] * 4], fov }; };

  // landmarks
  const line1 = L[0], line2 = L[1], line3 = L[2];
  const tL1a = hitT(line1[0]), tL1b = hitT(line1[NX - 1]), tL2a = hitT(line2[0]), tL2b = hitT(line2[NX - 1]), tL3a = hitT(line3[0]), tL3b = hitT(line3[NX - 1]);
  const hullI = line3[14], hullP = plan.P(hullI), tHull = hitT(hullI);
  // a ship that runs for a long time before it is caught, for the rear-view shot
  let fleeI = order[Math.floor(order.length * 0.7)];
  for (let k = Math.floor(order.length * 0.62); k < order.length * 0.8; k++) { const i = order[k]; if (plan.hit[i] - plan.esc[i] > 16 && plan.fac[i] > 0.9) { fleeI = i; break; } }
  const tFlee = hitT(fleeI);
  const lineEnd = plan.P(line1[NX - 1]), frontZ = firstP[2], topY = firstP[1];

  // ---------- anchors ----------
  const focus = [
    { id: 'droplet', zh: '水滴', en: 'The droplet', get: t => ({ p: dropAt(t).slice(0, 3), r: 0.006, dir: n0 }) },
    { id: 'first', zh: '无限边疆号', en: 'Infinite Frontier', get: t => ({ p: shipNow(plan.firstI, t), r: 1.3, dir: [-0.75, 0.3, 0.6] }) },
    { id: 'row', zh: '第一列', en: 'First line', get: () => ({ p: [0, topY, frontZ], r: 24, dir: [-0.35, 0.3, 0.89] }) },
    { id: 'fleet', zh: '舰队全景', en: 'Whole fleet', get: () => ({ p: [0, 0, 0], r: 62, dir: [-0.62, 0.42, 0.66] }) },
    { id: 'quantum', zh: '量子号', en: 'Quantum', get: t => ({ p: shipNow(plan.two[0], t), r: 1.4, dir: [-0.5, 0.3, 0.8] }) },
    { id: 'bronze', zh: '青铜时代号', en: 'Bronze Age', get: t => ({ p: shipNow(plan.two[1], t), r: 1.4, dir: [-0.5, 0.3, 0.8] }) },
  ];

  const zL = v3norm(cross([0, 1, 0], toFirst));
  // rear quarter of the resting droplet, the corner of the fleet beyond it; the camera stays put when it goes
  const haloCam = (u, st) => ({ pos: v3add(D0, v3add(v3scale(toFirst, (4.6 - 0.9 * u) * M2K), v3add([0, (0.5 + 0.3 * u) * M2K, 0], v3scale(zL, (3.5 + 0.5 * u) * M2K)))), look: v3add(D0, v3scale(toFirst, -0.0007)), fov: 40 });
  // behind its tail when it goes; the lens crash-zooms after it and arrives at the corner ship as it is pierced
  const launchCam = st => ({ pos: v3add(D0, v3add(v3scale(toFirst, -9 * M2K), v3add([0, 0.9 * M2K, 0], v3scale(zL, 1.3 * M2K)))), look: v3lerp(v3add(D0, v3scale(toFirst, 0.004)), v3add(firstP, [0.2, -0.05, 0]), smoother(clamp((st - T.go + 0.15) / 0.9, 0, 1))), fov: lerp(42, 8.5, smoother(clamp((st - T.go) / 1.75, 0, 1))) });
  // off the far end of the first line: the string of suns runs toward the lens
  const lineCam = u => ({ pos: v3lerp([lineEnd[0] + 9, topY + 8.5, frontZ + 21], [lineEnd[0] + 5, topY + 5, frontZ + 16.5], u), look: [lineEnd[0] - 46 + 22 * u * u, topY - 2.5, frontZ - 5], fov: 38, roll: lerp(-0.1, 0.07, u) });
  // a crane over the back of one ship while its last second crawls by
  const hullOrbit = u => { const b = lerp(0.42, 2.74, smoother(u)), R = lerp(0.42, 0.36, u); return { pos: v3add(hullP, [-R * Math.cos(b), R * Math.sin(b) * 0.75 + 0.03, lerp(0.34, 0.16, u)]), look: v3add(hullP, [0, 0, lerp(-0.22, 0, u)]), fov: 38 }; };
  // dolly-zoom on the whole lattice: it keeps its size while the perspective opens up underneath it
  const vertigo = u => { const C = [4, 5, 18], k = easeInOut(u), d = lerp(200, 84, k), az = lerp(-0.93, -0.66, k), el = 0.28, dir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
    return { pos: v3add(C, v3scale(dir, d)), look: C, fov: 2 * Math.atan(40 / d) * 180 / Math.PI }; };
  // circling the hunt at close range
  const huntOrbit = (u, st) => { const c = dropSmooth(st - 1.15, 0.35), a = 0.6 + 4.4 * u, R = 12 - 2 * u; return { pos: [c[0] + R * Math.cos(a), c[1] + 3 + 2 * Math.sin(a * 0.5), c[2] + R * Math.sin(a)], look: dropSmooth(st - 1.1, 0.2), fov: 58 }; };
  // one move from the whole battlefield, through the wreck, down to the droplet and into its mirror
  const RC = v3len(v3sub(R0, [0, 0, -8]));
  const onerD = (() => { const tab = [], dt = 1 / 60; let d = RC + 150;
    for (let f = 98; f <= 125.05; f += dt) { tab.push(d); const v = lerp(4, 42, smooth(102.5, 104.6, f));
      if (d > 14) d -= v * dt; else d *= Math.exp(-(lerp(3.0, 0.12, smooth(110.1, 111.1, f)) + 1.6 * smooth(113.4, 114.4, f)) * dt);
      d = Math.max(d, 0.000045); }
    return f => { const x = clamp((f - 98) * 60, 0, tab.length - 1.001), i = Math.floor(x); return lerp(tab[i], tab[i + 1], x - i); }; })();
  const oner = (u, st, f) => { const d = onerD(f), lat = 0.3 * (1 - smooth(101, 108.5, f)), dir = v3norm([nR[0] + sR[0] * lat, nR[1] + sR[1] * lat, nR[2] + sR[2] * lat]);
    return { pos: v3add(R0, v3scale(dir, 0.000684 + d)), look: v3lerp([0, 0, -8], R0, smooth(102.5, 106.5, f)), fov: lerp(50, 36, smooth(104, 111, f)), roll: 0.6 * smooth(101, 105, f) * (1 - smooth(106.5, 110.5, f)) }; };
  const restReveal = u => { const k = smoother(clamp((u - 0.1) / 0.4, 0, 1)); return mirrorRest(0.05 * Math.exp(5.0 * k), 0.01 + 0.1 * k, 0.004 + 0.2 * k, 36, 0.06 * k, 0); };

  // ---------- interactive director ----------
  const wideFront = (u) => ({ pos: v3lerp([-98, 44, 96], [-70, 58, 112], easeInOut(u)), look: [4, 6, 18], fov: 40 });
  const SHOTS = [
    { a: 0, b: 6.5, cam: u => mirrorCam(lerp(0.045, 0.06, u), lerp(-0.012, 0.012, u), 0.004, 36) },
    { a: 6.5, b: 13.2, cam: u => mirrorCam(0.06 * Math.exp(5.2 * smoother(u)), 0.012 + 0.3 * smoother(u), 0.004 + 0.25 * smoother(u), 36, 0.14 * smoother(u)) },
    { a: 13.2, b: T.go + 0.012, cam: (u, t) => haloCam(u, t) },
    { a: T.go + 0.012, b: T.first + 0.3, cam: (u, t) => launchCam(t) },
    { a: T.first + 0.3, b: tL1b + 0.6, cam: u => lineCam(u) },
    { a: tL1b + 0.6, b: tL2b - 0.05, cam: (u, t) => mount(t, 1.7, 0.85, 0, 0.14, 84) },
    { a: tL2b - 0.05, b: plan.tHunt + 3, cam: u => wideFront(u) },
    { a: plan.tHunt + 3, b: plan.tHunt + 24, cam: (u, t) => ({ ...chase(t, 70 + 30 * u, 22 + 10 * u, 30), fov: 50 }) },
    { a: plan.tHunt + 24, b: plan.tHunt + 40, cam: (u, t) => ({ ...pursue(t, 26, 7), fov: 62 }) },
    { a: plan.tHunt + 40, b: plan.tHunt + 60, cam: u => ({ pos: v3lerp([-220, 180, 300], [-170, 240, 350], easeInOut(u)), look: [0, 0, -10], fov: 42 }) },
    { a: plan.tHunt + 60, b: plan.tRest, cam: (u, t) => ({ ...chase(t, 120, 40, -50), fov: 52 }) },
    { a: plan.tRest, b: T.end + 1, cam: u => restReveal(u * 0.8) },
  ];
  function director(t) { for (const s of SHOTS) if (t >= s.a && t < s.b) return s.cam((t - s.a) / (s.b - s.a), t); return SHOTS[SHOTS.length - 1].cam(1, t); }

  const moments = [
    { t: 0, id: 'fleet', zh: '联合舰队', en: 'The Combined Fleet', textZh: '两千艘恒星级战舰组成立体方阵，二十五乘八乘十。这是人类有史以来最强大的力量。', textEn: 'Two thousand stellar-class warships in a three-dimensional formation, twenty-five by eight by ten: the greatest force humanity has ever assembled.' },
    { t: 6.5, id: 'drop', zh: '镜中的舰队', en: 'A fleet in a mirror', textZh: '镜头后退——刚才看到的整支舰队，只是水滴表面的倒影。它长三点四米，由强互作用力材料构成，表面是绝对光滑的全反射镜面。', textEn: 'Pull back: the whole fleet was a reflection. The droplet is 3.4 metres long, made of strong-interaction material, its surface a perfectly smooth mirror.' },
    { t: T.halo, id: 'halo', zh: '光环', en: 'The halo', textZh: '水滴尾部出现一圈蓝色光环，它把头转向舰队。', textEn: 'A ring of blue light appears around its tail, and it turns its head toward the fleet.' },
    { t: T.first, id: 'first', zh: '无限边疆号', en: 'Infinite Frontier', textZh: '水滴撞穿第一艘战舰，沿着第一列笔直前进。被击穿的战舰从伤口开始红热，整整一秒之后核燃料爆炸，变成一颗小太阳。', textEn: 'The droplet punches through the first ship and runs straight down the line. Each pierced hull glows red from the wound outward; a full second later its fusion fuel detonates into a small sun.' },
    { t: tL1b + 0.2, id: 'turn', zh: '锐角转向', en: 'The acute turn', textZh: '二十五艘战舰连成一串火球。水滴以不可能的锐角折返，扑向下一列。这里的镜头固定在水滴身上。', textEn: 'Twenty-five ships have become a string of fireballs. The droplet turns at an impossible angle and takes the next line — this camera is bolted to the droplet itself.' },
    { t: plan.tScatter, id: 'scatter', zh: '方阵瓦解', en: 'The formation breaks', textZh: '舰队开始四散逃离，发动机的光芒布满太空。', textEn: 'The fleet scatters; engine flares fill the dark.' },
    { t: plan.tHunt, id: 'hunt', zh: '追猎', en: 'The hunt', textZh: '水滴不断加速，在逃散的战舰之间折出一条闪电般的路径。', textEn: 'Accelerating all the time, the droplet zig-zags through the fleeing ships like a bolt of lightning.' },
    { t: lerp(plan.tHunt, plan.tLast, 0.55), id: 'two', zh: '两艘幸存者', en: 'Two survivors', textZh: '只有“量子”号和“青铜时代”号提前进入深海状态，全速逃离了战场。', textEn: 'Only Quantum and Bronze Age, already in deep-sea state, escape at full acceleration.' },
    { t: plan.tRest, id: 'after', zh: '金属云', en: 'A cloud of metal', textZh: '战场只剩下一片暗红色的金属岩浆云。水滴飞回它的边缘悬停，镜面上映着整片残骸，没有一丝划痕。', textEn: 'What remains is a dull red cloud of molten metal. The droplet flies back to its edge and stops, the whole wreck mirrored in its flank, without a scratch.' },
  ];

  // ---------- film (125 s) ----------
  const F = (from, to, st0, st1, cam, ease) => ({ from, to, time: f => lerp(st0, st1, (ease || (x => x))((f - from) / (to - from))), cam });
  const FT = (from, to, time, cam) => ({ from, to, time, cam });
  // on-board: four ships in extreme slow motion, then the clock winds back up to full speed
  const obA = hitT(line2[3]) - 0.07, obB = hitT(line2[7]) + 0.012, obC = tL3b - 0.25, vSlow = (obB - obA) / 8;
  const filmShots = [
    // the fleet... which turns out to be a reflection
    F(0, 12, 0, 6.2, u => mirrorCam(lerp(0.042, 0.062, u), lerp(-0.02, 0.016, u), lerp(-0.004, 0.006, u), 36)),
    F(12, 22, 6.2, 12.6, u => { const k = smoother(Math.min(1, u * 1.18)); return mirrorCam(0.062 * Math.exp(5.15 * k), 0.016 + 0.3 * k, 0.006 + 0.25 * k, 36, 0.3 * k, 2.5 * k * k * k); }),
    // halo, the head swings round, and it is gone
    F(22, 25.5, 13.1, T.go + 0.012, (u, st) => haloCam(u, st)),
    { ...F(25.5, 28, T.go - 0.22, T.first + 0.5, (u, st) => launchCam(st)), post: () => ({ exposure: 1.7 }) },
    // first line, seen from its far end
    F(28, 36, T.first + 0.3, tL1b + 1.45, u => lineCam(u)),
    // bolted to the droplet
    FT(36, 44, f => obA + vSlow * (f - 36), (u, st) => mount(st, 1.7, 0.85, 0, 0.14, 84)),
    FT(44, 50, f => { const x = (f - 44) / 6; return obB + vSlow * 6 * x + (obC - obB - vSlow * 6) * Math.pow(x, 2.6); }, (u, st, f) => { const x = u * u * u, p = mount(st, 1.7 + 0.5 * u, 0.85 + 0.15 * u, 0, 0.14 + 0.012 * x * Math.sin(f * 61), 84 + 10 * u); p.roll = x * (0.016 * Math.sin(f * 43) + 0.01 * Math.sin(f * 71 + 1)) + 2 * Math.PI * smoother(clamp((st - tL2b + 0.1) / (tL3a - tL2b + 0.3), 0, 1)); return p; }),
    // one hull, one second
    FT(50, 60, f => f < 51.6 ? lerp(tHull - 0.5, tHull - 0.01, (f - 50) / 1.6) : f < 59.55 ? lerp(tHull - 0.01, tHull + BLAST - 0.003, (f - 51.6) / 7.95) : lerp(tHull + BLAST - 0.003, tHull + BLAST + 0.05, (f - 59.55) / 0.45),
      u => hullOrbit(u)),
    // the lattice with three lines burning; the acute turns
    F(60, 70, tL2b - 1.2, plan.tHunt + 5.5, u => vertigo(u)),
    // the rout, at speed
    F(70, 79, plan.tHunt + 9, plan.tHunt + 24, (u, st) => ({ ...pursue(st, 24 + 6 * u, 6 + 2 * u), fov: 64, roll: 0.3 * Math.sin(u * 3.6 - 0.5) })),
    // circling the hunt at close range, at a third of the speed
    { ...F(79, 88, plan.tHunt + 27, plan.tHunt + 29.8, (u, st) => huntOrbit(u, st)), post: () => ({ exposure: 0.6 }) },
    // a fleeing ship looks back
    { from: 88, to: 98, time: f => f < 95 ? lerp(tFlee - 12, tFlee - 0.6, (f - 88) / 7) : lerp(tFlee - 0.6, tFlee + BLAST + 0.04, (f - 95) / 3), cam: (u, st) => fromShip(fleeI, st, 56), post: () => ({ exposure: 1.0 }) },
    // all of it at once
    { from: 98, to: 125, time: f => f < 103 ? lerp(plan.tLast - 26, plan.tLast - 3, (f - 98) / 5) : f < 110 ? lerp(plan.tLast - 3, plan.tRest + 0.3, (f - 103) / 7) : plan.tRest + 0.3 + (f - 110) * 0.6,
      cam: oner, post: (u, st) => ({ exposure: lerp(0.95, 1.5, smooth(plan.tLast, plan.tRest + 1, st)) }) },
  ];
  const filmDef = {
    duration: 125, shots: filmShots,
    fade: ft => (1 - 0.78 * smooth(117.4, 119, ft)) * (1 - smooth(123.8, 124.9, ft)),
    titles: [
      { from: 17.4, to: 21.8, kind: 'title', align: 'left', no: '02', zh: '末日战役', en: 'DOOMSDAY BATTLE', sub: '一个水滴 · 两千艘恒星级战舰' },
      { from: 1.2, to: 6.4, kind: 'caption', zh: '人类联合舰队，两千艘', en: 'The Combined Fleet · 2,000 warships' },
      { from: 12.8, to: 17.0, kind: 'caption', zh: '这是水滴表面的倒影', en: 'A reflection, on the skin of the droplet' },
      { from: 29.0, to: 33.6, kind: 'caption', zh: '第一列，二十五艘', en: 'The first line · 25 ships' },
      { from: 36.8, to: 42.6, kind: 'caption', zh: '水滴视角 · 慢放二十倍', en: 'On board the droplet · 20× slow motion' },
      { from: 44.6, to: 48.6, kind: 'caption', zh: '恢复原速', en: 'Back to full speed' },
      { from: 52.4, to: 57.4, kind: 'caption', zh: '击穿之后的一秒', en: 'The second after it is pierced' },
      { from: 89.0, to: 94.0, kind: 'caption', zh: '逃离中的战舰回望', en: 'Looking back from a fleeing ship' },
      { from: 111.2, to: 115.4, kind: 'caption', zh: '毫发无损', en: 'Not a scratch' },
      { from: 118.2, to: 125, kind: 'end' },
    ],
  };

  return {
    id: 'droplet', duration: T.end, scene, moments, focus, update, render, post, director, film: filmDef,
    resize: () => {},
    orbitLimits: f => (f === 'droplet' ? { min: 0.0012, max: 3000 } : { min: 0.6, max: 4000 }),
    debug: { plan, dropAt, marks: { tL1a, tL1b, tL2a, tL2b, tL3a, tL3b, tHull, tFlee, tHunt: plan.tHunt, tLast: plan.tLast, tScatter: plan.tScatter, obA, obB, obC },
      anchors: { smooth: t => dropSmooth(t), drop: t => dropAt(t).slice(0, 3), first: () => firstP, zero: () => [0, 0, 0], hull: () => hullP } },
  };
}
