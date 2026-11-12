// Doomsday Battle — one droplet against two thousand stellar-class warships.
// Units: kilometres. The fleet is a 100 x 20 rectangular formation in the xz plane; the droplet takes the
// first row end to end, turns at an acute angle, and then hunts the scattering fleet down.
// Every ship's fate is a pure function of time (hit time, escape time), so the battle can be scrubbed.
import * as THREE from 'three';
import { clamp, lerp, smooth, smoother, easeInOut, easeOut, easeIn, v3lerp, v3add, v3sub, v3scale, v3norm, v3len, rng, GLSL_NOISE } from '../../core/util.js';
import { makeSpace, makeFarSun } from '../../core/space.js';

const COLS = 100, ROWS = 20, N = COLS * ROWS, DX = 5, DZ = 9;
const T = { halo: 15, go: 18, first: 20, end: 150 };
const BLAST = 0.35, ACC = 0.2, BURN = 11;                     // ships burn hard for BURN seconds, then coast
const SUN_DIR = new THREE.Vector3(0.6, 0.38, -0.7).normalize();

// ---------- fleet plan (deterministic) ----------
function planBattle() {
  const R = rng(2205), pos0 = new Float32Array(N * 3), dir = new Float32Array(N * 3), hit = new Float32Array(N).fill(1e9), esc = new Float32Array(N).fill(1e9), fac = new Float32Array(N).fill(1), seed = new Float32Array(N);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const i = r * COLS + c;
    pos0.set([(c - (COLS - 1) / 2) * DX, (R() - 0.5) * 0.25, (r - (ROWS - 1) / 2) * DZ + (R() - 0.5) * 0.3], i * 3); seed[i] = R();
  }
  const P = i => [pos0[i * 3], pos0[i * 3 + 1], pos0[i * 3 + 2]];
  const posAt = (i, t) => { const te = Math.max(0, t - esc[i]), k = ACC * fac[i] * (te < BURN ? 0.5 * te * te : BURN * (te - BURN / 2)); return [pos0[i * 3] + dir[i * 3] * k, pos0[i * 3 + 1] + dir[i * 3 + 1] * k, pos0[i * 3 + 2] + dir[i * 3 + 2] * k]; };
  const path = [];                                                   // { t, p }
  const p0 = P(0), start = [p0[0] - 16, p0[1], p0[2]];
  path.push({ t: 0, p: start }, { t: T.go, p: start });
  for (let k = 1; k < 8; k++) { const u = k / 8; path.push({ t: lerp(T.go, T.first, u), p: v3lerp(start, p0, u * u) }); }
  let t = T.first;
  const order = [];
  // rows 0..2: straight passes, alternating direction, with an overshoot and an acute turn between them
  for (let r = 0; r < 3; r++) {
    const rev = r % 2 === 1, d0 = [0.112, 0.07, 0.052][r], d1 = [0.07, 0.052, 0.042][r];
    for (let k = 0; k < COLS; k++) {
      const c = rev ? COLS - 1 - k : k, i = r * COLS + c;
      if (!(r === 0 && k === 0)) t += lerp(d0, d1, k / (COLS - 1));
      hit[i] = t; order.push(i); path.push({ t, p: P(i) });
    }
    const last = P(r * COLS + (rev ? 0 : COLS - 1)), over = [last[0] + (rev ? -11 : 11), last[1] + 1.5, last[2] - 1.5];
    t += 0.2; path.push({ t, p: over }); t += 0.28;                  // next row is entered from the overshoot point
  }
  const tScatter = hit[2 * COLS] - 1.5;
  // the rest of the fleet breaks formation
  const two = [(ROWS - 1) * COLS + COLS - 2, (ROWS - 1) * COLS + COLS - 4];   // Quantum, Bronze Age
  for (let i = 3 * COLS; i < N; i++) {
    const p = P(i), surv = two.includes(i);
    let d = [p[0] * 0.25 + (R() - 0.5) * 80, (R() < 0.5 ? -1 : 1) * (40 + R() * 90), p[2] * 0.6 + (R() - 0.5) * 70 + 30];
    if (surv) d = [0.55, 0.38, 0.75];
    d = v3norm(d); dir.set(d, i * 3);
    esc[i] = surv ? tScatter - 3 : tScatter + R() * R() * 26 + (ROWS - 1 - Math.floor(i / COLS)) * 0.0;
    fac[i] = surv ? 5 : 0.45 + R() * 1.1;
  }
  // greedy pursuit: always the nearest surviving ship, accelerating
  const left = []; for (let i = 3 * COLS; i < N; i++) if (!two.includes(i)) left.push(i);
  let cur = path[path.length - 1].p; const tHunt = t;
  const nHunt = left.length;
  while (left.length) {
    let best = -1, bd = 1e18;
    for (let k = 0; k < left.length; k++) { const q = posAt(left[k], t), dd = (q[0] - cur[0]) ** 2 + (q[1] - cur[1]) ** 2 + (q[2] - cur[2]) ** 2; if (dd < bd) { bd = dd; best = k; } }
    const i = left[best]; left[best] = left[left.length - 1]; left.pop();
    t += lerp(0.075, 0.021, 1 - left.length / nHunt);                 // the droplet keeps accelerating; nothing outruns it
    const q = posAt(i, t); hit[i] = t; order.push(i); path.push({ t, p: q }); cur = q;
  }
  const tLast = t;
  const rest = v3add(cur, [26, 9, 22]); path.push({ t: tLast + 2.0, p: rest }, { t: 1e6, p: rest });
  return { pos0, dir, hit, esc, fac, seed, path, order, posAt, tScatter, tHunt, tLast, two };
}

// ---------- warship geometry: flat-shaded plates that can fly apart ----------
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
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('aCen', new THREE.Float32BufferAttribute(C, 3)); g.setAttribute('aRnd', new THREE.Float32BufferAttribute(Rn, 3)); g.setAttribute('aMat', new THREE.Float32BufferAttribute(M, 1));
  return g;
}

const COMMON = /* glsl */`
uniform float uTime;
attribute vec3 iPos, iDir; attribute vec4 iT;     // hit time, escape time, seed, thrust factor
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

export default async function create({ renderer, quality, film }) {
  const plan = planBattle();
  const scene = new THREE.Scene(), nearScene = new THREE.Scene();
  const space = makeSpace({ stars: 11000, seed: 5, galaxyTilt: [0.2, 0.55, 0.81] });
  const sun = makeFarSun(SUN_DIR.toArray(), { color: [1, 0.95, 0.86], size: 0.006, gain: 1.3 });
  scene.add(space.group, sun.mesh);

  const U = { uTime: { value: 0 }, uSunDir: { value: SUN_DIR }, uPx: { value: 1 },
    uLpos: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) }, uLcol: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) } };

  // ---------- ships ----------
  const iPos = new THREE.InstancedBufferAttribute(plan.pos0, 3), iDir = new THREE.InstancedBufferAttribute(plan.dir, 3);
  const iT = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
  for (let i = 0; i < N; i++) iT.setXYZW(i, plan.hit[i], plan.esc[i], plan.seed[i], plan.fac[i]);
  const withInst = g => { g.setAttribute('iPos', iPos); g.setAttribute('iDir', iDir); g.setAttribute('iT', iT); g.instanceCount = N; return g; };
  const shipGeo = withInst(shipGeometry());
  const shipMat = new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */`
      ${COMMON}
      attribute vec3 aCen, aRnd; attribute float aMat;
      varying vec3 vN, vWp, vL; varying float vMat, vU, vThrust, vSeed, vPlate;
      void main(){
        float u = uTime - iT.x, ub = max(0., u - ${BLAST.toFixed(2)});
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
        vec3 wp = shipPos(uTime) + p * ${(1.0).toFixed(1)};
        vN = n; vWp = wp; vL = position; vMat = aMat; vU = u; vSeed = iT.z; vPlate = aRnd.x;
        vThrust = smoothstep(0., 1.5, uTime - iT.y) * smoothstep(${(BURN + 3).toFixed(1)}, ${(BURN - 1).toFixed(1)}, uTime - iT.y) * step(u, 0.) * iT.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.);
      }`,
    fragmentShader: /* glsl */`
      precision highp float;
      uniform vec3 uSunDir; uniform float uTime; uniform vec3 uLpos[8]; uniform vec3 uLcol[8];
      varying vec3 vN, vWp, vL; varying float vMat, vU, vThrust, vSeed, vPlate;
      ${GLSL_NOISE} ${HEAT}
      void main(){
        vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
        N = normalize(N + (hash33(floor(vL * vec3(52., 52., 21.)) + vSeed) - .5) * .16);
        vec3 V = normalize(cameraPosition - vWp);
        int m = int(vMat + .5);
        // armour: panelled gunmetal, slightly different per ship
        vec3 q = vL * vec3(52., 52., 21.);
        float pan = hash13(floor(q) + vSeed * 31.), pan2 = hash13(floor(q * .25) + 7.);
        vec3 alb = mix(vec3(.21, .225, .25), vec3(.34, .355, .38), pan * .6 + pan2 * .4) * (.85 + .3 * vSeed);
        vec3 fq = abs(fract(q) - .5); float fw = clamp(length(fwidth(q)) * 1.5, 0., 1.);
        float groove = smoothstep(.45, .5, max(fq.x, max(fq.y, fq.z))) * (1. - fw);
        alb *= 1. - .5 * groove;
        alb = mix(alb, vec3(.5, .13, .06), step(.93, pan2) * step(abs(vL.z - .05), .06) * .8);          // squadron band on the collar
        if (m == 1) alb = vec3(.07, .075, .085);
        if (m == 3) alb = vec3(.13, .14, .16);
        if (m == 4) alb = vec3(.035, .036, .04);
        float sunD = max(dot(N, uSunDir), 0.);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.), 60.) * .9;
        vec3 col = alb * (vec3(1., .96, .88) * sunD * 2.3 + vec3(.022, .028, .045)) + vec3(1., .95, .85) * spec * sunD * 1.4;
        col += alb * vec3(.07, .09, .14) * pow(1. - max(dot(N, V), 0.), 3.);                   // rim from the galaxy
        for (int i = 0; i < 8; i++) {
          vec3 Lv = uLpos[i] - vWp; float d2 = dot(Lv, Lv);
          col += alb * uLcol[i] * max(dot(N, Lv * inversesqrt(d2 + 1e-6)), 0.) / (1. + d2 * .35);
        }
        // running lights + windows
        vec3 lq = vL * vec3(300., 260., 420.); float lf = 1. - clamp(length(fwidth(lq)) * .7, 0., 1.);
        float lights = step(.988, hash13(floor(lq) + vSeed * 9.)) * step(float(m), .5) * step(abs(fract(lq.z * .125) - .5), .2);
        lights += step(.93, hash13(floor(vL * vec3(240., 300., 500.)))) * float(m == 3);
        vec3 emis = vec3(1., .82, .58) * lights * 3.2 * lf * step(vU, 0.);
        if (m == 4) {                                                                                  // radiators run dull red
          float st = smoothstep(.06, .12, abs(fract(length(vL.xy) * 40.) - .5));
          emis += vec3(1., .16, .03) * (.02 + .5 * (1. - st)) * (.35 + .65 * clamp(vThrust, 0., 1.)) * step(vU, 0.);
        }
        if (m == 2) emis += mix(vec3(.25, .5, 1.) * 2.2, vec3(.7, .88, 1.) * 26., clamp(vThrust, 0., 1.)) * step(vU, 0.);
        // struck: a wave of heat runs through the hull from the puncture, then the plates cool as they scatter
        if (vU > 0.) {
          float front = vU * 5.2, dz = abs(vL.z);
          float T = smoothstep(front, front - .45, dz) * clamp(.35 + vU * 3., 0., 1.);
          float ub = max(0., vU - ${BLAST.toFixed(2)});
          T = mix(T, 1., step(1e-4, ub)) * exp(-ub * (.22 + .5 * vPlate));
          emis += heatColor(clamp(T, 0., 1.)) * 5.;
          col *= 1. - .8 * smoothstep(0., .3, vU);
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
        float u = uTime - iT.x, ub = max(0., u - ${BLAST.toFixed(2)});
        float rf = u < ${BLAST.toFixed(2)} ? .05 + u * .9 : .36 + 1.25 * (1. - exp(-ub * 2.6)) + ub * .06;
        float rr = ub * 3.0 + .36;
        float alive = step(0., u) * step(u, 7.);
        float size = max(rf * 3.2, rr * 1.1 * step(ub, 2.6)) * alive;
        vUv = position.xy; vU = u; vSeed = iT.z; vSize = size; vRf = rf; vRr = rr;
        gl_Position = projectionMatrix * viewMatrix * vec4(bill(shipPos(iT.x), position.xy, size), 1.);
      }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv; varying float vU, vSeed, vSize, vRf, vRr; uniform float uTime;
      ${GLSL_NOISE}
      void main(){
        float r = length(vUv) * vSize; if (r > vSize) discard;
        float ub = max(0., vU - ${BLAST.toFixed(2)});
        float a = atan(vUv.y, vUv.x), rn = r / vRf;
        vec2 pp = vUv * vSize;
        float n = fbm(pp * 1.5 + vSeed * 20. + vec2(0., -ub * .7)), n2 = fbm(pp * 4. - vSeed * 11. + ub);
        // a ball of plasma: hard limb at first, then it frays and thins
        float soft = mix(.035, .95, smoothstep(0., 1.1, ub));
        float body = 1. - smoothstep(1. - soft, 1., rn + (n - .5) * .5 * smoothstep(.05, 1.4, ub));
        float depth = sqrt(max(0., 1. - min(rn, 1.) * min(rn, 1.)));
        float I = (vU < ${BLAST.toFixed(2)}) ? 10. * (.4 + vU * 2.5) : 22. * exp(-ub * 2.6) + 1.8 * exp(-ub * 1.1);
        vec3 hot = mix(vec3(.8, .9, 1.), vec3(1., .8, .46), smoothstep(.0, .7, ub));
        hot = mix(hot, vec3(1., .36, .08), smoothstep(.6, 2.6, ub));
        vec3 col = hot * body * mix(.3 + .95 * depth, 1.6 * depth * depth, smoothstep(.2, 1.2, ub)) * (.55 + .9 * n2) * I;
        // glare + six-point star while it is white-hot
        float gl = exp(-ub * 2.6) * step(1e-4, ub) + step(vU, ${BLAST.toFixed(2)}) * .4;
        float edge = smoothstep(vSize, vSize * .5, r);
        col += hot * gl * (2.2 / (1. + rn * rn * 3.5)) * edge;
        float spikes = pow(abs(cos(a * 3. + vSeed * 6.28)), 90.) + .6 * pow(abs(cos(a * 3. + vSeed * 6.28 + 1.05)), 200.);
        col += hot * gl * spikes * 1.5 / (1. + rn * 1.4) * edge;
        // the shock shell, a faint limb-brightened ring
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
      varying vec2 vUv; varying float vUb, vSeed;
      void main(){
        float ub = uTime - iT.x - ${BLAST.toFixed(2)};
        float size = (1.5 + 7.5 * (1. - exp(-max(ub, 0.) * .05))) * step(.4, ub);
        vUv = position.xy; vUb = ub; vSeed = iT.z;
        vec3 drift = normalize(vec3(fract(iT.z * 17.3), fract(iT.z * 31.7), fract(iT.z * 53.1)) - .5) * max(ub, 0.) * .11;
        gl_Position = projectionMatrix * viewMatrix * vec4(bill(shipPos(iT.x) + drift, position.xy, size), 1.);
      }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv; varying float vUb, vSeed; uniform float uTime;
      ${GLSL_NOISE}
      void main(){
        float r = length(vUv); if (r > 1.) discard;
        vec2 p = vUv * 2.2 + vSeed * 37.; float sw = vUb * .03;
        float n = fbm(p + vec2(sw, -sw) + fbm(p * 1.7 - sw) * .8);
        float d = smoothstep(1., .05, r + (n - .5) * .8) * (.35 + 1.1 * n * n);
        float I = smoothstep(.4, 3., vUb) * (.42 * exp(-vUb / 14.) + .3 * exp(-vUb / 260.));
        vec3 c = mix(vec3(1., .34, .07), vec3(.5, .035, .01), smoothstep(2., 26., vUb)) ;
        gl_FragColor = vec4(c * d * I, 1.);
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
        vec3 tail = vec3(0., 0., -1.);
        if (sl > 1e-4) tail = rotAxis(tail, axT / sl, atan(sl, dot(fwd, iDir)) * turn);
        vec3 c = shipPos(uTime) + tail * mix(.2, 1., step(.02, burn));
        vec4 mv = viewMatrix * vec4(c, 1.); float dist = -mv.z;
        // near: the engine glare. far: a sunlit hull is smaller than a pixel, so draw it as a steady point of light
        float far = smoothstep(14., 60., dist);
        float size = max((.1 + .9 * burn) * (1. - far * (1. - burn)), far * dist * .003 * uPx);
        vUv = position.xy; vI = (.035 + burn) * alive; vFar = far * alive * (1. - min(burn, 1.));
        gl_Position = projectionMatrix * viewMatrix * vec4(bill(c, position.xy, size * alive), 1.);
      }`,
    fragmentShader: /* glsl */`precision highp float; varying vec2 vUv; varying float vI, vFar;
      void main(){ float r = length(vUv); if (r > 1.) discard; float g = exp(-r * r * 9.) * 9. + .7 / (1. + r * r * 30.) * smoothstep(1., .5, r);
        float st = exp(-abs(vUv.y) * 26.) * exp(-abs(vUv.x) * 2.6) * 2.;
        vec3 col = vec3(.5, .74, 1.) * (g + st) * vI * 1.6 * (1. - vFar);
        col += vec3(.9, .93, 1.) * exp(-r * r * 5.) * .8 * vFar;
        gl_FragColor = vec4(col, 1.); }`,
  });
  const flare = new THREE.Mesh(quadGeo(), flareMat); flare.frustumCulled = false; flare.renderOrder = 3;
  scene.add(cloud, flare, fire);

  // ---------- molten debris ----------
  const PER = Math.max(12, Math.floor(44 * quality.density)), ND = N * PER;
  {
    const R = rng(606), a = new Float32Array(ND * 3), b = new Float32Array(ND * 3), c = new Float32Array(ND * 4), d = new Float32Array(ND * 4);
    for (let i = 0; i < N; i++) for (let k = 0; k < PER; k++) {
      const j = i * PER + k; let x, y, z, l; do { x = R() * 2 - 1; y = R() * 2 - 1; z = R() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-3);
      l = Math.sqrt(l); const sp = 0.03 + 0.55 * Math.pow(R(), 2.2);
      a.set([plan.pos0[i * 3], plan.pos0[i * 3 + 1], plan.pos0[i * 3 + 2]], j * 3); b.set([plan.dir[i * 3], plan.dir[i * 3 + 1], plan.dir[i * 3 + 2]], j * 3);
      c.set([plan.hit[i], plan.esc[i], plan.seed[i], plan.fac[i]], j * 4); d.set([x / l * sp, y / l * sp * 0.75, z / l * sp, R()], j * 4);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(ND * 3), 3));
    g.setAttribute('iPos', new THREE.BufferAttribute(a, 3)); g.setAttribute('iDir', new THREE.BufferAttribute(b, 3)); g.setAttribute('iT', new THREE.BufferAttribute(c, 4)); g.setAttribute('aV', new THREE.BufferAttribute(d, 4));
    const debris = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        ${COMMON} ${HEAT}
        attribute vec4 aV; uniform float uPx; varying vec3 vC;
        void main(){
          float ub = uTime - iT.x - ${BLAST.toFixed(2)};
          vec3 p = shipPos(iT.x) + aV.xyz * ub * (1. + 2.4 / (1. + ub * .5));
          float T = exp(-max(ub, 0.) * (.035 + .11 * aV.w)) * (.55 + .45 * aV.w);
          vC = heatColor(T) * (.5 + .6 * aV.w) * step(0., ub);
          vec4 mv = viewMatrix * vec4(p, 1.);
          gl_Position = projectionMatrix * mv;
          float px = uPx * (1.5 + 2.2 * aV.w) * (1. + 60. / (1. + -mv.z * 3.));
          gl_PointSize = clamp(px, 1.2, 26. * uPx) * step(0., ub);
        }`,
      fragmentShader: `precision highp float; varying vec3 vC; void main(){ vec2 q = gl_PointCoord * 2. - 1.; float a = exp(-dot(q, q) * 3.5); gl_FragColor = vec4(vC * a, 1.); }`,
    }));
    debris.frustumCulled = false; debris.renderOrder = 3; scene.add(debris); scene.userData.debris = debris;
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
  const dropDir = t => { const s = dropAt(t).seg, a = path[s], b = path[Math.min(path.length - 1, s + 1)]; let d = v3sub(b.p, a.p); if (v3len(d) < 1e-6) d = [1, 0, 0]; return v3norm(d); };

  // low-passed droplet position: lets a camera ride along without being whipped around by every acute turn
  const dropSmooth = (t, w = 2.5) => { const o = [0, 0, 0]; for (let k = 0; k < 24; k++) { const p = dropAt(t + ((k + 0.5) / 24 * 2 - 1) * w); o[0] += p[0] / 24; o[1] += p[1] / 24; o[2] += p[2] / 24; } return o; };
  const DSCALE = 0.001;                                              // metres -> km
  const prof = []; for (let i = 0; i <= 128; i++) { const s = Math.pow(i / 128, 1.5); prof.push(new THREE.Vector2(1.95 * Math.sqrt(s) * Math.pow(1 - s, 1.25), -3.4 * s + 1.0)); }
  const dropGeo = new THREE.LatheGeometry(prof, 96); dropGeo.rotateX(Math.PI / 2);          // head toward +z
  const cubeRT = new THREE.WebGLCubeRenderTarget(film ? 512 : 256, { type: THREE.HalfFloatType, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const cubeCam = new THREE.CubeCamera(0.02, 30000, cubeRT);
  const dropMat = new THREE.ShaderMaterial({
    uniforms: { uEnv: { value: cubeRT.texture }, uSunDir: U.uSunDir },
    vertexShader: `varying vec3 vN, vWp; void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vWp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`precision highp float; uniform samplerCube uEnv; uniform vec3 uSunDir; varying vec3 vN, vWp;
      void main(){ vec3 N = normalize(vN), V = normalize(cameraPosition - vWp), Rr = reflect(-V, N);
        vec3 env = textureCube(uEnv, Rr).rgb;
        float f = pow(1. - max(dot(N, V), 0.), 5.);
        vec3 col = env * mix(vec3(.93, .95, .98), vec3(1.), f) * 2.2 + vec3(.05, .07, .11) * f;
        col += vec3(1., .96, .88) * pow(max(dot(Rr, uSunDir), 0.), 2600.) * 300.;       // the far Sun, a pin-point highlight
        gl_FragColor = vec4(col, 1.); }`,
  });
  const drop = new THREE.Mesh(dropGeo, dropMat); drop.scale.setScalar(DSCALE); drop.frustumCulled = false;
  // propulsion halo: a ring of blue light around the tail
  const haloU = { uI: { value: 0 }, uTime: U.uTime };
  const halo = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.04, 12, 128), new THREE.ShaderMaterial({
    uniforms: haloU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `precision highp float; uniform float uI, uTime; varying vec3 vP;
      void main(){ float a = atan(vP.y, vP.x); float fl = .8 + .2 * sin(a * 9. + uTime * 40.) * sin(a * 4. - uTime * 23.); gl_FragColor = vec4(vec3(.42, .68, 1.) * 3.2 * uI * fl, 1.); }`,
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
  const trailU = { uTime: U.uTime, uRes: { value: new THREE.Vector2(1920, 1080) }, uTail: { value: 7 }, uWidth: { value: 1.6 } };
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
    const trail = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: trailU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute vec3 aNext; attribute float aT, aSide; uniform vec2 uRes; uniform float uWidth; varying float vT;
        void main(){ vec4 c = projectionMatrix * viewMatrix * vec4(position, 1.), c2 = projectionMatrix * viewMatrix * vec4(aNext, 1.);
          vec2 d = (c2.xy / max(c2.w, 1e-4) - c.xy / max(c.w, 1e-4)) * uRes; d = normalize(d + 1e-5);
          c.xy += vec2(-d.y, d.x) * aSide * uWidth / uRes * c.w; gl_Position = c; vT = aT; }`,
      fragmentShader: `precision highp float; uniform float uTime, uTail; varying float vT;
        void main(){ float age = uTime - vT; if (age < 0.) discard; float k = exp(-age / uTail * 3.);
          gl_FragColor = vec4(mix(vec3(.25, .45, 1.), vec3(.8, .92, 1.), k * k) * (k * 2.6 + .05 * exp(-age / 40.)), 1.); }`,
    }));
    trail.frustumCulled = false; trail.renderOrder = 5; scene.add(trail);
  }

  // ---------- per-frame ----------
  const order = plan.order, hitSorted = order.map(i => plan.hit[i]);
  const tmp = new THREE.Vector3(), q0 = new THREE.Quaternion(), FWD = new THREE.Vector3(0, 0, 1), dv = new THREE.Vector3();
  const dp = [0, 0, 0];
  let frameNo = 0, nearActive = false, camDrop = 1e9, mainNear = 0.05, cubeStamp = -1;
  const destroyed = t => { let lo = 0, hi = hitSorted.length; while (lo < hi) { const m = (lo + hi) >> 1; if (hitSorted[m] <= t) lo = m + 1; else hi = m; } return lo; };

  function update(t, env) {
    U.uTime.value = t; U.uPx.value = env.h / 1080; space.setViewport(env.h);
    const cam = env.camera, asp = env.w / env.h; sun.uniforms.uAspect.value = asp; glintU.uAspect.value = asp; trailU.uRes.value.set(env.w, env.h);
    dropAt(t, dp); const d = dropDir(t);
    drop.position.set(dp[0], dp[1], dp[2]); drop.quaternion.setFromUnitVectors(FWD, dv.set(d[0], d[1], d[2]));
    glintU.uP.value.set(dp[0], dp[1], dp[2]);
    const moving = t > T.go && t < plan.tLast + 1.2;
    haloU.uI.value = smooth(T.halo, T.halo + 1.6, t) * (1 - smooth(plan.tLast + 0.6, plan.tLast + 2.5, t)) * (moving ? 1 : 0.75 + 0.25 * Math.sin(t * 5));
    camDrop = cam.position.distanceTo(drop.position);
    glintU.uI.value = smooth(0.03, 0.6, camDrop) * 0.9; glintU.uSize.value = 0.011;

    // lights: the brightest recent fireballs
    const nd = destroyed(t); let nl = 0;
    for (let k = nd - 1; k >= 0 && nl < 8; k--) {
      const i = order[k], u = t - plan.hit[i]; if (u > 5) break;
      const ub = Math.max(0, u - BLAST), I = u < BLAST ? 6 * (u / BLAST) : 60 * Math.exp(-ub * 1.25) + 3 * Math.exp(-ub * 0.42);
      if (k < nd - 1 && nl >= 3 && (nd - 1 - k) % 3) continue;          // spread the 8 slots over the last few seconds
      const p = plan.posAt(i, plan.hit[i]); U.uLpos.value[nl].set(p[0], p[1], p[2]); U.uLcol.value[nl].set(1.0 * I, 0.62 * I, 0.32 * I); nl++;
    }
    for (; nl < 8; nl++) U.uLcol.value[nl].set(0, 0, 0);

    // clip planes from the nearest thing in view
    let dmin = 1e9; const cp = cam.position, P0 = plan.pos0;
    for (let i = 0; i < N; i++) { const p = plan.esc[i] < t ? plan.posAt(i, Math.min(t, plan.hit[i])) : null; const x = (p ? p[0] : P0[i * 3]) - cp.x, y = (p ? p[1] : P0[i * 3 + 1]) - cp.y, z = (p ? p[2] : P0[i * 3 + 2]) - cp.z, dd = x * x + y * y + z * z; if (dd < dmin) dmin = dd; }
    dmin = Math.sqrt(dmin);
    nearActive = camDrop < 1.5;
    mainNear = clamp(Math.max(0, dmin - 1.2) * 0.3, 0.004, 3);
    cam.near = mainNear; cam.far = 40000;
    frameNo++;
  }

  function render(r, cam, target, env) {
    // mirror: re-capture the surroundings from the droplet when the camera is close enough to see it
    const stamp = Math.round(U.uTime.value * 240);
    if (nearActive && (env.film ? stamp !== cubeStamp : frameNo % 3 === 0)) {
      cubeStamp = stamp;
      const deb = scene.userData.debris; glint.visible = false; deb.visible = false;
      cubeCam.position.copy(drop.position); cubeCam.update(r, scene); glint.visible = true; deb.visible = true;
    }
    r.setRenderTarget(target); r.autoClear = true; r.render(scene, cam);
    if (nearActive) {
      const n = cam.near, f = cam.far;
      cam.near = Math.max(0.0002, camDrop * 0.05); cam.far = camDrop + 4; cam.updateProjectionMatrix();
      r.autoClear = false; r.clearDepth(); r.render(nearScene, cam); r.autoClear = true;
      cam.near = n; cam.far = f; cam.updateProjectionMatrix();
    }
  }

  function post(t, env) {
    // exposure rides down while many suns are burning at once
    const nd = destroyed(t), recent = nd - destroyed(t - 2.5);
    const glare = clamp(recent / 60, 0, 1), dusk = smooth(plan.tLast + 1, plan.tLast + 9, t);
    return { exposure: lerp(1.0, 0.5, glare) * (1 + 0.5 * dusk), bloom: 0.36, bloomThreshold: 1.3, bloomKnee: 0.9, bloomRadius: 1.1, streak: 0.1, streakColor: [0.55, 0.72, 1.0],
      ca: 0.22, vignette: 0.5, grain: 0.035, saturation: 1.04, contrast: 1.06, tintLo: [0.94, 0.98, 1.08], tintHi: [1.04, 1.0, 0.96] };
  }

  // ---------- anchors ----------
  const first = plan.posAt(0, 0), rowMid = [0, 0, plan.pos0[2]], center = [0, 0, 0];
  const shipNow = (i, t) => plan.posAt(i, Math.min(t, plan.hit[i]));
  const focus = [
    { id: 'droplet', zh: '水滴', en: 'The droplet', get: t => ({ p: dropAt(t).slice(0, 3), r: 0.006, dir: [-0.5, 0.25, 0.83] }) },
    { id: 'first', zh: '无限边疆号', en: 'Infinite Frontier', get: () => ({ p: first, r: 1.3, dir: [-0.75, 0.3, 0.6] }) },
    { id: 'row', zh: '第一列', en: 'First row', get: () => ({ p: [first[0] + 40, 0, first[2]], r: 26, dir: [-0.9, 0.2, -0.38] }) },
    { id: 'fleet', zh: '舰队全景', en: 'Whole fleet', get: () => ({ p: center, r: 150, dir: [-0.55, 0.5, -0.67] }) },
    { id: 'quantum', zh: '量子号', en: 'Quantum', get: t => ({ p: shipNow(plan.two[0], t), r: 1.4, dir: [0.5, 0.3, 0.8] }) },
    { id: 'bronze', zh: '青铜时代号', en: 'Bronze Age', get: t => ({ p: shipNow(plan.two[1], t), r: 1.4, dir: [0.5, 0.3, 0.8] }) },
  ];

  // ---------- director ----------
  const D0 = dropAt(0).slice(0, 3);
  // ride ahead of the hunt, looking back at it: the droplet zig-zags toward camera with ships dying behind it
  const chase = (t, dist, up, side, w = 3) => { const p = dropSmooth(t, w), q = dropSmooth(t + 1.2, w); let d = v3sub(q, p); d[1] = 0; d = v3len(d) > 1e-3 ? v3norm(d) : [1, 0, 0];
    return { pos: [p[0] + d[0] * dist + side * d[2], p[1] + up, p[2] + d[2] * dist - side * d[0]], look: [p[0] - d[0] * dist * 0.2, p[1], p[2] - d[2] * dist * 0.2] }; };
  // the droplet at rest, seen side-on, with what is left of the fleet behind it
  const restShot = (st, k, fov) => { const p = dropAt(st).slice(0, 3), d = dropDir(plan.tLast + 1), c = v3norm(v3sub([0, 0, 0], p)), dot = c[0] * d[0] + c[1] * d[1] + c[2] * d[2];
    const w = v3norm([c[0] - d[0] * dot, c[1] - d[1] * dot, c[2] - d[2] * dot]);
    return { pos: [p[0] - w[0] * k + d[0] * k * 0.3, p[1] - w[1] * k + k * 0.16, p[2] - w[2] * k + d[2] * k * 0.3], look: [p[0] - d[0] * 0.0005, p[1], p[2] - d[2] * 0.0005], fov }; };
  const SHOTS = [
    { a: 0, b: 9, cam: u => ({ pos: v3lerp([first[0] + 487.0, 0.34, first[2] - 0.6], [first[0] + 488.8, 1.4, first[2] - 2.5], easeInOut(u)), look: v3lerp([first[0] + 485, 0.02, first[2] + 0.1], [first[0] + 460, -1.0, first[2] + 3], easeInOut(u)), fov: 38 }) },
    { a: 9, b: 15, cam: u => ({ pos: v3lerp([D0[0] - 0.0072, D0[1] + 0.002, D0[2] - 0.0092], [D0[0] + 0.0036, D0[1] + 0.0013, D0[2] - 0.0074], easeInOut(u)), look: D0, fov: 28 }) },
    { a: 15, b: 19.6, cam: u => ({ pos: v3lerp([D0[0] - 0.0085, D0[1] + 0.0026, D0[2] + 0.0052], [D0[0] - 0.012, D0[1] + 0.0034, D0[2] + 0.0046], u), look: [D0[0] + 0.004, D0[1], D0[2]], fov: 32 }) },
    { a: 19.6, b: 30, cam: (u, t) => ({ pos: v3lerp([first[0] + 263.6, 1.15, first[2] - 0.25], [first[0] + 263.0, 0.85, first[2] - 0.35], u), look: [first[0] + 232 + 26 * u * u, -0.4, first[2]], fov: 34 }) },
    { a: 30, b: 46, cam: u => ({ pos: v3lerp([-110, 105, -250], [-10, 140, -270], easeInOut(u)), look: [10, 0, -66], fov: 40 }) },
    { a: 46, b: 70, cam: (u, t) => ({ ...chase(t, 70 + 30 * u, 22 + 10 * u, 30), fov: 50 }) },
    { a: 70, b: 100, cam: u => ({ pos: v3lerp([380, 260, 420], [300, 420, 520], easeInOut(u)), look: [0, 20, 30], fov: 42 }) },
    { a: 100, b: plan.tLast + 2, cam: (u, t) => ({ ...chase(t, 120, 40, -50), fov: 52 }) },
    { a: plan.tLast + 2, b: T.end + 1, cam: (u, t) => restShot(t, lerp(0.0105, 0.022, easeInOut(u)), 32) },
  ];
  function director(t) { for (const s of SHOTS) if (t >= s.a && t < s.b) return s.cam((t - s.a) / (s.b - s.a), t); return SHOTS[SHOTS.length - 1].cam(1, t); }

  const moments = [
    { t: 0, id: 'fleet', zh: '联合舰队', en: 'The Combined Fleet', textZh: '两千艘恒星级战舰排成一百乘二十的矩形方阵，这是人类有史以来最强大的力量。', textEn: 'Two thousand stellar-class warships in a hundred-by-twenty formation: the greatest force humanity has ever assembled.' },
    { t: 9, id: 'drop', zh: '水滴', en: 'The droplet', textZh: '长三点四米，表面是绝对光滑的全反射镜面，映着银河与整支舰队。', textEn: '3.4 metres long, its surface a perfectly smooth mirror reflecting the Milky Way and the entire fleet.' },
    { t: T.halo, id: 'halo', zh: '光环', en: 'The halo', textZh: '水滴尾部出现一圈蓝色光环。', textEn: 'A ring of blue light appears around its tail.' },
    { t: T.first, id: 'first', zh: '无限边疆号', en: 'Infinite Frontier', textZh: '水滴撞穿第一艘战舰，沿着第一列笔直前进。被击穿的战舰先是通体红热，随后核燃料爆炸，变成一颗小太阳。', textEn: 'The droplet punches through the first ship and runs straight down the row. Each pierced ship glows red-hot, then its fusion fuel detonates into a small sun.' },
    { t: plan.hit[COLS - 1], id: 'turn', zh: '锐角转向', en: 'The acute turn', textZh: '一百艘战舰连成一串火球。水滴以不可能的锐角折返，扑向第二列。', textEn: 'A hundred ships have become a string of fireballs. The droplet turns at an impossible angle and takes the second row.' },
    { t: plan.tScatter, id: 'scatter', zh: '方阵瓦解', en: 'The formation breaks', textZh: '舰队开始四散逃离，发动机的光芒布满太空。', textEn: 'The fleet scatters; engine flares fill the dark.' },
    { t: plan.tHunt, id: 'hunt', zh: '追猎', en: 'The hunt', textZh: '水滴不断加速，在逃散的战舰之间折出一条闪电般的路径。', textEn: 'Accelerating all the time, the droplet zig-zags through the fleeing ships like a bolt of lightning.' },
    { t: lerp(plan.tHunt, plan.tLast, 0.55), id: 'two', zh: '两艘幸存者', en: 'Two survivors', textZh: '只有“量子”号和“青铜时代”号提前进入深海状态，全速逃离了战场。', textEn: 'Only Quantum and Bronze Age, already in deep-sea state, escape at full acceleration.' },
    { t: plan.tLast + 2, id: 'after', zh: '金属云', en: 'A cloud of metal', textZh: '战场只剩下一片暗红色的金属岩浆云。水滴悬停在它面前，表面没有一丝划痕。', textEn: 'What remains is a dull red cloud of molten metal. The droplet hangs before it without a scratch.' },
  ];

  // ---------- film ----------
  const F = (from, to, st0, st1, cam, ease) => ({ from, to, time: f => lerp(st0, st1, (ease || (x => x))((f - from) / (to - from))), cam });
  const fx = first[0], fz = first[2], tRow0End = plan.hit[COLS - 1];
  const x52 = plan.pos0[52 * 3], h52 = plan.hit[52], toC = v3norm(v3sub([0, 0, 0], path[path.length - 1].p));
  const filmShots = [
    F(0, 8.6, 0, 5, u => ({ pos: v3lerp([fx + 487.0, 0.34, fz - 0.6], [fx + 488.6, 1.25, fz - 2.3], easeInOut(u)), look: v3lerp([fx + 485, 0.02, fz + 0.1], [fx + 462, -0.9, fz + 2.5], easeInOut(u)), fov: 38 })),
    F(8.6, 13, 5, 8, u => ({ pos: v3lerp([fx + 545, 34, fz - 80], [fx + 573, 62, fz - 118], easeOut(u, 2)), look: [fx + 305, 0, fz + 70], fov: 36 })),
    F(13, 20, 8, 14.6, u => ({ pos: v3lerp([D0[0] - 0.0072, D0[1] + 0.002, D0[2] - 0.0092], [D0[0] + 0.0036, D0[1] + 0.0013, D0[2] - 0.0074], easeInOut(u)), look: [D0[0], D0[1], D0[2] + 0.0002], fov: 28 })),
    F(20, 23, 14.8, T.first - 0.04, u => ({ pos: v3lerp([D0[0] - 0.0085, D0[1] + 0.0026, D0[2] + 0.0052], [D0[0] - 0.012, D0[1] + 0.0034, D0[2] + 0.0046], u), look: [D0[0] + 0.004, D0[1], D0[2]], fov: 32 }), u => 0.62 * u + 0.38 * u * u * u),
    F(23, 31, T.first - 0.04, h52 + 0.75, (u, st) => ({ pos: v3lerp([x52 + 3.6, 1.15, fz - 0.25], [x52 + 3.0, 0.85, fz - 0.35], u), look: [x52 - 28 + 26 * u * u, -0.4, fz], fov: 34 })),
    F(31, 39, tRow0End - 2.2, plan.tScatter + 4.5, u => ({ pos: v3lerp([-90, 105, -250], [-20, 135, -265], easeInOut(u)), look: [10, 0, -70], fov: 38 })),
    F(39, 48, plan.tHunt + 8, plan.tHunt + 26, (u, st) => ({ ...chase(st, 80 + 30 * u, 24 + 8 * u, 34 - 20 * u), fov: 50 })),
    F(48, 62, plan.tLast + 6, plan.tLast + 16, (u, st) => restShot(st, lerp(0.0105, 0.019, easeOut(u, 2)), 30)),
  ];
  const filmDef = {
    duration: 62, shots: filmShots,
    fade: ft => smooth(3.0, 5.6, ft) * (1 - smooth(12.7, 13.0, ft) * (1 - smooth(13.0, 13.4, ft))) * (1 - smooth(47.75, 48.0, ft) * (1 - smooth(48.05, 48.9, ft))) * (1 - 0.78 * smooth(54.4, 56, ft)) * (1 - smooth(60.8, 61.9, ft)),
    titles: [
      { from: 0.5, to: 4.6, kind: 'title', no: '02', zh: '末日战役', en: 'DOOMSDAY BATTLE', sub: '一个水滴 · 两千艘恒星级战舰' },
      { from: 6.2, to: 11.6, kind: 'caption', zh: '人类联合舰队，两千艘', en: 'The Combined Fleet · 2,000 warships' },
      { from: 14.2, to: 19.0, kind: 'caption', zh: '水滴，长 3.4 米', en: 'The droplet · 3.4 metres' },
      { from: 32.2, to: 37.5, kind: 'caption', zh: '第一列，一百艘，无一幸免', en: 'First row · 100 ships · none spared' },
      { from: 49.4, to: 53.6, kind: 'caption', zh: '毫发无损', en: 'Not a scratch' },
      { from: 55.2, to: 62, kind: 'end' },
    ],
  };

  return {
    id: 'droplet', duration: T.end, scene, moments, focus, update, render, post, director, film: filmDef,
    resize: () => {},
    orbitLimits: f => (f === 'droplet' ? { min: 0.005, max: 3000 } : { min: 0.6, max: 4000 }),
    debug: { plan, dropAt, anchors: { smooth: t => dropSmooth(t), drop: t => dropAt(t).slice(0, 3), first: () => first, zero: () => [0, 0, 0] } },
  };
}
