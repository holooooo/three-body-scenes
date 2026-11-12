// Dimensional Strike — the two-dimensionalization of the Solar System.
// Units are schematic (planet sizes exaggerated, distances compressed). The 2D plane is y = 0 and spreads outward from
// the foil's resting point; whatever its edge passes beneath falls to it, sinks through it and is poured out flat.
// A body's surface is laid out as a map around the last point to go under, so whatever was flowing on the sphere
// (Jupiter's jets and its Great Red Spot, Earth's cyclones) goes on flowing in the plane.
// One place on Earth is shown from the ground as well: see city.js.
import * as THREE from 'three';
import { clamp, lerp, smooth, smoother, easeInOut, easeOut, v3lerp, v3add, table, rng, GLSL_NOISE } from '../../core/util.js';
import { makeSpace } from '../../core/space.js';
import { SURF_GLSL, FROST_GLSL } from './glsl.js';
import { makeCity, CITY } from './city.js';

const TILT = THREE.MathUtils.degToRad(12), H0 = 26, FOIL_X = 182;
const T = { arrive: 8, dim: 11, start: 14, end: 190 };
// radius of the plane over time. It lingers at Jupiter and at Earth: this is a restoration to look at, not a simulation.
const RKEYS = [[T.start, 0], [22, 27], [36, 88], [52, 128], [88, 146], [118, 159], [126, 171], [136, 189], [141, 201], [160, 311], [T.end, 520]];
const Rof = t => table(RKEYS, t);
const tOf = d => { for (let i = 1; i < RKEYS.length; i++) if (d <= RKEYS[i][1]) { const [t0, r0] = RKEYS[i - 1], [t1, r1] = RKEYS[i]; return lerp(t0, t1, (d - r0) / (r1 - r0)); } return 1e6; };
const ecl = (a, deg, up = 0) => { const th = THREE.MathUtils.degToRad(deg), x = a * Math.cos(th), ze = a * Math.sin(th); return [x, H0 + ze * Math.sin(TILT) + up, ze * Math.cos(TILT)]; };

// what comes up in the middle of a flat body once its surface has been laid out: [outer edge 0..1, colour, glow]
const INNER = {
  rock: [[0.3, [1.0, 0.85, 0.55], 1.7], [0.9, [0.6, 0.26, 0.12], 0.6], [1.0, [0.3, 0.27, 0.25], 0.3]],
  earth: [[0.2, [1.0, 0.9, 0.62], 1.5], [0.52, [1.0, 0.56, 0.18], 1.0], [0.93, [0.66, 0.19, 0.08], 0.6], [1.0, [0.2, 0.17, 0.15], 0.25]],
  gas: [[0.2, [1.0, 0.82, 0.55], 1.3], [0.78, [0.5, 0.58, 0.8], 0.75], [1.0, [0.26, 0.32, 0.5], 0.5]],
  ice: [[0.3, [0.55, 0.47, 0.42], 0.8], [1.0, [0.72, 0.88, 1.0], 0.6]],
};
const ROCK = { K: 3.9, fall: 4, sink: 4, type: 0, rin: 0.45, inner: INNER.rock };
const BODIES = [
  { id: 'sun', zh: '太阳', en: 'The Sun', a: 0, th: 0, r: 9, K: 3.0, fall: 8, sink: 14, type: 9 },
  { id: 'mercury', zh: '水星', en: 'Mercury', a: 20, th: 250, r: 0.9, ...ROCK, pal: [[0.36, 0.33, 0.31], [0.22, 0.2, 0.19], [0.5, 0.47, 0.43]] },
  { id: 'venus', zh: '金星', en: 'Venus', a: 29, th: 320, r: 1.5, K: 4.0, fall: 5, sink: 5, type: 4, rin: 0.5, inner: INNER.earth, pal: [[0.78, 0.66, 0.42], [0.62, 0.48, 0.26], [0.9, 0.84, 0.66]] },
  { id: 'earth', zh: '地球', en: 'Earth', a: 40, th: 28, r: 1.7, K: 4.4, fall: 6, sink: 18, type: 1, rin: 0.4, openAt: 4, inner: INNER.earth, pal: [[0.012, 0.045, 0.14], [0.055, 0.1, 0.04], [0.3, 0.24, 0.15]] },
  { id: 'moon', zh: '月球', en: 'The Moon', of: 'earth', off: [-7.6, 1.1, 6.4], r: 0.46, ...ROCK, pal: [[0.42, 0.41, 0.4], [0.22, 0.22, 0.23], [0.6, 0.59, 0.57]] },
  { id: 'mars', zh: '火星', en: 'Mars', a: 52, th: 105, r: 1.2, ...ROCK, pal: [[0.52, 0.24, 0.12], [0.3, 0.13, 0.08], [0.72, 0.42, 0.24]] },
  { id: 'jupiter', zh: '木星', en: 'Jupiter', a: 78, th: 42, r: 5, K: 3.4, fall: 8, sink: 20, type: 2, vort: 1, flip: true, gain: 1.75, rin: 0.42, inner: INNER.gas, pal: [[0.84, 0.72, 0.55], [0.44, 0.22, 0.12], [0.74, 0.6, 0.46]] },
  { id: 'io', of: 'jupiter', off: [8.2, 0.6, 2.4], r: 0.42, ...ROCK, pal: [[0.86, 0.76, 0.3], [0.6, 0.42, 0.14], [0.95, 0.9, 0.6]] },
  { id: 'europa', of: 'jupiter', off: [-9.6, -0.5, 5.2], r: 0.36, ...ROCK, inner: INNER.ice, pal: [[0.82, 0.8, 0.74], [0.58, 0.5, 0.42], [0.95, 0.95, 0.93]] },
  { id: 'ganymede', of: 'jupiter', off: [4.4, 0.9, -12.4], r: 0.6, ...ROCK, pal: [[0.5, 0.47, 0.43], [0.32, 0.29, 0.26], [0.7, 0.68, 0.64]] },
  { id: 'callisto', of: 'jupiter', off: [-14.2, -1.1, -9.2], r: 0.55, ...ROCK, pal: [[0.3, 0.27, 0.24], [0.18, 0.16, 0.15], [0.5, 0.46, 0.4]] },
  { id: 'saturn', zh: '土星', en: 'Saturn', a: 106, th: -22, r: 4.2, K: 3.2, fall: 6, sink: 9, type: 2, ring: [1.28, 2.3], gain: 2.3, rin: 0.36, inner: INNER.gas, pal: [[0.7, 0.6, 0.4], [0.52, 0.42, 0.26], [0.8, 0.74, 0.56]] },
  { id: 'uranus', zh: '天王星', en: 'Uranus', a: 134, th: 200, r: 2.6, K: 3.4, fall: 5, sink: 6, type: 3, rin: 0.4, inner: INNER.ice, pal: [[0.4, 0.66, 0.72], [0.3, 0.56, 0.64], [0.56, 0.8, 0.84]] },
  { id: 'neptune', zh: '海王星', en: 'Neptune', a: 158, th: 6, r: 2.5, K: 3.4, fall: 5, sink: 6, type: 3, rin: 0.4, inner: INNER.ice, pal: [[0.07, 0.17, 0.62], [0.04, 0.1, 0.44], [0.2, 0.36, 0.86]] },
  { id: 'pluto', zh: '冥王星', en: 'Pluto', a: 205, th: 138, r: 0.5, ...ROCK, inner: INNER.ice, pal: [[0.6, 0.5, 0.42], [0.36, 0.3, 0.27], [0.8, 0.76, 0.7]] },
];
const B = Object.fromEntries(BODIES.map(b => [b.id, b]));
for (const b of BODIES) {
  b.p = b.of ? v3add(B[b.of].p, b.off) : ecl(b.a, b.th);
  b.d = Math.hypot(b.p[0] - FOIL_X, b.p[2]); b.t0 = tOf(Math.max(0, b.d - b.r * 1.2)); b.tT = b.t0 + b.fall; b.done = b.tT + b.sink; b.Rf = b.r * b.K;
}

// where a body is, how much of it has gone under (s), the waterline circle (rc), the rim of its flat image (R),
// the colatitude at the waterline (thW) and how far its interior has welled up in the middle (open)
function bodyState(b, t) {
  const xa = clamp((t - b.t0) / b.fall, 0, 1), xs = clamp((t - b.tT) / b.sink, 0, 1);
  const s = lerp(xs, xs * xs * (3 - 2 * xs), 0.6);
  const y = xs > 0 ? b.r * (1 - 2 * s) : lerp(b.p[1], b.r, xa * xa * (3 - 2 * xa));
  const vol = s * s * (3 - 2 * s), rc = 2 * b.r * Math.sqrt(s * (1 - s));
  const R = Math.sqrt(rc * rc + b.Rf * b.Rf * vol) * (1 + 0.14 * (1 - Math.exp(-Math.max(0, t - b.done) / 9)));
  return { y, s, rc, R, thW: Math.acos(clamp(2 * s - 1, -1, 1)), open: b.rin ? b.rin * smoother((t - b.done - (b.openAt ?? 1)) / 9) : 0 };
}

const PLANE_GLSL = /* glsl */`
uniform vec2 uRk[${RKEYS.length}]; uniform float uTime; uniform vec2 uFoil;
float tOfR(float d){
  for (int i = 1; i < ${RKEYS.length}; i++) { if (d <= uRk[i].y) return mix(uRk[i - 1].x, uRk[i].x, (d - uRk[i - 1].y) / (uRk[i].y - uRk[i - 1].y)); }
  return 1e6;
}
// everything small (belts, orbit lines, ships) pours into the plane once the edge has passed beneath it
float fallY(vec3 p, float dur){ float d = length(p.xz - uFoil); float x = clamp((uTime - tOfR(d)) / dur, 0., 1.); return p.y * (1. - x * x * (2. - x)); }
`;

export default async function create({ renderer, quality, film }) {
  const scene = new THREE.Scene();
  const space = makeSpace({ stars: 8000, seed: 11, galaxyTilt: [0.5, 0.42, 0.75], milky: 1.1 });
  scene.add(space.group);
  const U = {
    uTime: { value: 0 }, uRk: { value: RKEYS.map(k => new THREE.Vector2(k[0], k[1])) }, uFoil: { value: new THREE.Vector2(FOIL_X, 0) },
    uSunPos: { value: new THREE.Vector3(0, H0, 0) }, uSunI: { value: 1 }, uR: { value: 0 }, uPx: { value: 1 },
  };
  const R = rng(404), resU = { value: new THREE.Vector2(1920, 1080) };
  const city = makeCity({ quality, film });
  const W1 = B.earth.done, W0 = W1 - CITY.WIN, cityU = t => (t - W0) / CITY.WIN;

  // ---------- planets ----------
  const sphere = new THREE.SphereGeometry(1, 128, 80);
  const planetVS = /* glsl */`varying vec3 vN, vWp, vL; void main(){ vL = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vWp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
  const planetFS = /* glsl */`
    precision highp float; varying vec3 vN, vWp, vL;
    uniform vec3 uSunPos; uniform float uSunI, uCut, uGain;
    ${SURF_GLSL}
    void main(){
      if (vWp.y < 0.) discard;                                    // the part already in the plane is gone
      vec3 N = normalize(vN), V = normalize(cameraPosition - vWp), L = normalize(uSunPos - vWp);
      vec3 alb, atmoC; float spec, atmo, water, lights; surf(normalize(vL), alb, spec, atmo, atmoC, water, lights);
      float nl = dot(N, L), day = smoothstep(-.08, .25, nl);
      vec3 col = alb * (max(nl, 0.) * uGain * uSunI + .012);
      vec3 H = normalize(L + V); col += vec3(1., .95, .85) * pow(max(dot(N, H), 0.), 70.) * spec * day * uSunI * 1.6;
      float rim = pow(1. - max(dot(N, V), 0.), 3.2);
      col += atmoC * rim * atmo * (day * 1.1 * uSunI + .03);
      col += vec3(1., .72, .36) * lights * (1. - day) * 2.4;                                    // city lights
      // where the sphere meets the plane its matter is being pulled flat: a hot, bright seam
      float seam = exp(-vWp.y / (.035 + .05 * uCut)) * uCut;
      col += vec3(1., .86, .6) * seam * 2.6;
      if (!gl_FrontFacing) col = vec3(1., .8, .5) * (1.2 + 2. * seam);
      gl_FragColor = vec4(col, 1.);
    }`;
  const flatVS = /* glsl */`uniform float uHalf; varying vec2 vP; void main(){ vP = position.xz * uHalf; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }`;
  const flatFS = /* glsl */`
    precision highp float; varying vec2 vP;
    uniform mat3 uInv; uniform float uRc, uRout, uThW, uOpen, uSink, uDone, uSunI, uFrostR, uRing, uDark, uGain;
    uniform float uLb[4]; uniform vec3 uLc[4]; uniform float uLe[4];
    ${SURF_GLSL} ${FROST_GLSL}
    void main(){
      float rho = length(vP), a = atan(vP.y, vP.x); vec2 ac = vP / max(rho, 1e-5);
      float x = (rho - uRc) / max(uRout - uRc, 1e-4);                                  // 0 at the waterline, 1 at the rim
      // the rim is still spreading: slightly ragged, with tongues running outward
      float xe = x + ((fbm(ac * 2.6 + vec2(uSeed, uTime * .05)) - .5) * .09 + (vnoise(ac * 17. + uSeed) - .5) * .02) * (1. - .8 * uDone) * smoothstep(.3, 1., x);
      if (xe > 1.) {
        float u = (rho / uRout - 1.07) / max(.85 * uRing, 1e-4);                         // Saturn's rings, flattened into the same sheet
        if (uRing <= 0. || u < 0. || u > 1.) discard;
        float gaps = smoothstep(.02, .05, abs(u - .62)) * smoothstep(0., .03, u) * smoothstep(1., .96, u) * (.55 + .45 * vnoise(vec2(u * 60., 3.))) * (.6 + .4 * vnoise(vec2(u * 190., 9.)));
        vec3 rc = mix(vec3(.72, .62, .46), vec3(.9, .85, .74), vnoise(vec2(u * 25., 1.))) * (.55 * uSunI + .22);
        gl_FragColor = vec4(rc * gaps * .92, gaps * .92); return;
      }
      if (x < -.03) discard;
      x = clamp(x, 0., 1.);
      // matter streams radially away from the waterline before it settles
      float flow = uSink * (1. - smoothstep(0., .6, x));
      float tongue = (vnoise(vec2(a * 46., rho * .7 - uTime * .9)) - .5) + .5 * (vnoise(vec2(a * 131., rho * 1.6 - uTime * 1.4)) - .5);
      float xs = clamp(x + tongue * .17 * flow, 0., 1.);
      vec3 col;
      if (uDone > .5 && xs < uOpen) {                                                    // the interior, welled up in the middle: the rings of a felled tree
        float xi = xs / uOpen, prev = 0., em = 0.; col = vec3(0.);
        for (int i = 0; i < 4; i++) { float b = uLb[i] + (vnoise(ac * 3.5 + float(i) * 7. + uSeed) - .5) * .03 * step(uLb[i], .999); float m = step(prev, xi) * step(xi, b); col += uLc[i] * m; em += uLe[i] * m; prev = b; }
        float wv = fbm(ac * 1.7 + xi * 2.5 + uSeed) * 2.4, aa = fwidth(xi) * 150.;
        float tr = mix(sin(xi * 150. + wv * 3.) * .5 + .5, .5, clamp(aa * .45, 0., 1.)), tr2 = sin(xi * 34. + wv * 2. + uTime * .05) * .5 + .5;
        float conv = fbm(ac * 3. * xi + vec2(uTime * .03, xi * 4.));                    // it is still hot, and still stirs
        col *= (.62 + .5 * tr) * (.7 + .42 * tr2) * (.7 + .6 * conv) * (.22 + em * 1.2) * (.55 + .45 * uSunI);
      } else {
        float xo = uDone > .5 ? sqrt(max(xs * xs - uOpen * uOpen, 0.) / (1. - uOpen * uOpen)) : xs;
        float th = mix(uThW, 3.14159, xo);
        vec3 alb, atmoC; float spec, atmo, water, lights;
        surf(uInv * vec3(sin(th) * cos(a), cos(th), sin(th) * sin(a)), alb, spec, atmo, atmoC, water, lights);
        col = alb * (.62 * uSunI + .2) * uGain / 2.9;
        if (uType > .5 && uType < 1.5) {
          col += vec3(1., .72, .36) * lights * 2.2 * (1. - uDark);                      // the cities go on shining for a while
          float pxf = length(fwidth(vP)) / uRout * 12.;
          if (uFrostR < 1.3 && water > 0.) {                                             // two-dimensional water freezes
            vec2 fr = frost(vP / uRout * 12., uFrostR * 12., 1.5, pxf);
            col = mix(col, vec3(.2, .33, .5) * (.6 * uSunI + .25), fr.y * water * .8);
            col += vec3(.75, .9, 1.) * fr.x * water * .75 * (.5 * uSunI + .3);
          }
        }
        float aa = fwidth(th) * 90.;
        col *= .9 + .12 * mix(sin(th * 90. + fbm(ac * 2. + uSeed) * 4.) * .5 + .5, .5, clamp(aa * .5, 0., 1.));      // a faint grain
      }
      col += vec3(1., .86, .6) * exp(-x / .03) * 1.3 * uSink;
      col += vec3(1., .9, .7) * smoothstep(.94, 1., xe) * 1.6 * (1. - uDone * .85);
      gl_FragColor = vec4(col, 1.);
    }`;

  const objs = {};
  for (const b of BODIES) {
    if (b.id === 'sun') continue;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSunPos: U.uSunPos, uSunI: U.uSunI, uTime: U.uTime, uA: { value: new THREE.Vector3(...b.pal[0]) }, uB: { value: new THREE.Vector3(...b.pal[1]) }, uC: { value: new THREE.Vector3(...b.pal[2]) },
        uType: { value: b.type }, uSeed: { value: R() * 50 }, uVort: { value: b.vort || 0 }, uCut: { value: 0 }, uGain: { value: b.gain || 2.9 } },
      vertexShader: planetVS, fragmentShader: planetFS, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(sphere, mat); mesh.scale.setScalar(b.r); mesh.frustumCulled = false;
    // Jupiter goes in north pole first, so the Great Red Spot is one of the last things to reach the plane
    if (b.flip) mesh.rotation.set(Math.PI + 0.1, 0.25, 0.06); else if (b.id === 'earth') mesh.rotation.set(0.9, +(new URLSearchParams(location.search).get('ery') ?? 2.2), 0.1); else mesh.rotation.set(b.ring ? 0.42 : 0.2 + R() * 0.3, R() * 6, b.ring ? 0.2 : 0.1);
    mesh.updateMatrix(); const rot = new THREE.Matrix4().extractRotation(mesh.matrix), inv = new THREE.Matrix3().setFromMatrix4(rot).transpose();
    const lb = [], lc = [], le = [];
    for (let i = 0; i < 4; i++) { const L = b.inner[Math.min(i, b.inner.length - 1)]; lb.push(i < b.inner.length ? L[0] : 1.001); lc.push(new THREE.Vector3(...L[1])); le.push(L[2]); }
    const half = b.Rf * 1.2 * (b.ring ? 2.05 : 1);
    const fmat = new THREE.ShaderMaterial({
      uniforms: { ...mat.uniforms, uInv: { value: inv }, uHalf: { value: half }, uRc: { value: 0 }, uRout: { value: 1 }, uThW: { value: Math.PI }, uOpen: { value: 0 }, uSink: { value: 0 }, uDone: { value: 0 },
        uFrostR: { value: 9 }, uRing: { value: 0 }, uDark: { value: 0 }, uLb: { value: lb }, uLc: { value: lc }, uLe: { value: le } },
      vertexShader: flatVS, fragmentShader: flatFS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), fmat); disc.scale.setScalar(half); disc.frustumCulled = false; disc.renderOrder = b.of ? 4 : 3;
    scene.add(mesh, disc);
    objs[b.id] = { b, mesh, disc, mat, fmat, rot };
    if (b.ring) {
      const g = new THREE.RingGeometry(b.ring[0], b.ring[1], 160, 1).rotateX(-Math.PI / 2);
      const ring = new THREE.Mesh(g, new THREE.ShaderMaterial({
        uniforms: { uSunPos: U.uSunPos, uSunI: U.uSunI, uIn: { value: b.ring[0] }, uOut: { value: b.ring[1] }, uCen: { value: new THREE.Vector3() }, uPr: { value: b.r } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        vertexShader: `varying vec3 vWp, vL; void main(){ vL = position; vec4 w = modelMatrix * vec4(position, 1.); vWp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: `precision highp float; varying vec3 vWp, vL; uniform vec3 uSunPos, uCen; uniform float uIn, uOut, uSunI, uPr; ${GLSL_NOISE}
          void main(){ if (vWp.y < 0.) discard; float u = (length(vL.xz) - uIn) / (uOut - uIn);
            float d = (.55 + .45 * vnoise(vec2(u * 60., 3.))) * (.6 + .4 * vnoise(vec2(u * 190., 9.))) * smoothstep(.02, .05, abs(u - .62)) * smoothstep(0., .03, u) * smoothstep(1., .96, u);
            vec3 c = mix(vec3(.72, .62, .46), vec3(.9, .85, .74), vnoise(vec2(u * 25., 1.)));
            // the planet's shadow across the rings
            vec3 L = normalize(uSunPos - vWp); vec3 oc = vWp - uCen; float tca = dot(-oc, L); float d2 = dot(oc, oc) - tca * tca;
            float sh = (tca > 0. && d2 < uPr * uPr) ? .08 : 1.;
            gl_FragColor = vec4(c * (1.5 * uSunI * sh + .03) * d, d * .95); }`,
      }));
      ring.renderOrder = 2; ring.frustumCulled = false; mesh.add(ring);      // unit-sphere space: ring radii are in planet radii
      objs[b.id].ring = ring;
    }
  }

  // ---------- the Sun ----------
  const sunB = B.sun;
  const sunMat = new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime },
    vertexShader: planetVS,
    fragmentShader: /* glsl */`precision highp float; varying vec3 vN, vWp, vL; uniform float uTime; ${GLSL_NOISE}
      void main(){ if (vWp.y < 0.) discard; vec3 N = normalize(vN), V = normalize(cameraPosition - vWp); vec3 p = normalize(vL);
        float g = fbm3(p * 9. + vec3(0., uTime * .05, 0.)) * .6 + fbm3(p * 26. - uTime * .08) * .4;
        float spots = smoothstep(.7, .78, fbm3(p * 2.6 + 7.));
        float mu = max(dot(N, V), 0.);
        vec3 c = mix(vec3(1., .5, .12), vec3(1., .86, .56), pow(mu, .55)) * (.65 + .8 * g) * (1. - .7 * spots);
        float seam = exp(-vWp.y / .5);
        if (!gl_FrontFacing) c = vec3(1., .9, .7);
        gl_FragColor = vec4(c * 5.5 + vec3(1., .95, .8) * seam * 10., 1.); }`,
    side: THREE.DoubleSide,
  });
  const sunMesh = new THREE.Mesh(sphere, sunMat); sunMesh.scale.setScalar(sunB.r); sunMesh.frustumCulled = false; scene.add(sunMesh);
  const coronaU = { uP: { value: new THREE.Vector3() }, uI: { value: 1 }, uSize: { value: sunB.r * 3.2 }, uTime: U.uTime, uClip: { value: 0 } };
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: coronaU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform vec3 uP; uniform float uSize; varying vec2 vUv; varying vec3 vWp;
      void main(){ vUv = position.xy; vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        vWp = uP + (r * position.x + u * position.y) * uSize; gl_Position = projectionMatrix * viewMatrix * vec4(vWp, 1.); }`,
    fragmentShader: `precision highp float; uniform float uI, uTime; varying vec2 vUv; varying vec3 vWp; ${GLSL_NOISE}
      void main(){ float r = length(vUv) * 3.2; if (r > 3.2) discard; float a = atan(vUv.y, vUv.x);
        float rays = .55 + .9 * fbm(vec2(a * 4., r * .6 - uTime * .03)) ;
        float g = (exp(-max(r - 1., 0.) * 3.2) * rays * 1.3 + .06 / (1. + pow(max(r - 1., 0.) * 2., 2.))) * smoothstep(3.2, 1.6, r) * smoothstep(.9, 1.0, r);
        gl_FragColor = vec4(vec3(1., .66, .34) * g * uI * smoothstep(-1.5, 2.5, vWp.y), 1.); }`,
  }));
  corona.frustumCulled = false; corona.renderOrder = 5; scene.add(corona);
  // the flat Sun: a sea of fire unrolled into spirals
  const flatSunU = { uTime: U.uTime, uGrow: { value: 0 }, uDone: { value: 0 } };
  const flatSun = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: flatSunU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `varying vec2 vUv; void main(){ vUv = position.xz; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`precision highp float; varying vec2 vUv; uniform float uTime, uGrow, uDone; ${GLSL_NOISE}
      void main(){
        float r = length(vUv), a = atan(vUv.y, vUv.x), g = max(uGrow, 1e-4); vec2 ac = vUv / max(r, 1e-5);
        float rr = r / g; rr += (fbm(ac * 2.2 + uTime * .03) - .5) * .12 * smoothstep(.4, 1., rr);
        if (rr > 1.) discard;
        // brush-strokes along nested logarithmic spirals, with local whorls: The Starry Night
        float lr = log(rr + .035), rot = uTime * .02;
        float sw = a + 2.3 * lr + rot;                                               // constant along a spiral arm
        vec2 sc = vec2(cos(sw), sin(sw));
        float warp = fbm(sc * 2.4 + lr * 1.7) * 2.2 + fbm(vUv / g * 5. + uTime * .01) * 1.1;
        float arms = sin(sw * 5. + warp * 2.6 + lr * 3.) * .5 + .5;
        float fine = sin(sw * 17. + warp * 5. + rr * 22.) * .5 + .5;
        float strokes = fbm(vec2(sw * 7. + warp, lr * 16. - uTime * .04));          // long streaks: stretched along the arm
        vec2 c = vUv / g * 3.4 + 7.; vec2 id = floor(c); vec2 f = fract(c) - .5; float hsh = hash12(id);
        float lf = length(f), la = atan(f.y, f.x) + (7. * lf - uTime * .12) * (hsh > .5 ? 1. : -1.);
        float whorl = (sin(la * 2. + hsh * 6.) * .5 + .5) * smoothstep(.48, .12, lf) * step(.45, hsh) * smoothstep(.12, .3, rr);
        float v = arms * .46 + fine * .2 + strokes * .46 + whorl * .4 - .12;
        v = clamp(v, 0., 1.2);
        vec3 hot = mix(vec3(.42, .03, .005), vec3(1., .3, .04), smoothstep(.12, .45, v));
        hot = mix(hot, vec3(1., .66, .16), smoothstep(.4, .72, v));
        hot = mix(hot, vec3(1., .95, .72), smoothstep(.7, 1.05, v) * smoothstep(1.05, .0, rr));
        float I = (.7 + 3.4 * pow(1. - rr, 1.4)) * (.3 + 1.5 * v * v);
        float front = smoothstep(1., .95, rr);
        vec3 col = hot * I + vec3(1., .85, .6) * (1. - front) * 3. * (1. - uDone * .7);
        float alpha = smoothstep(1., .98, rr);
        gl_FragColor = vec4(col * alpha, alpha);
      }`,
  }));
  flatSun.frustumCulled = false; flatSun.renderOrder = 3; scene.add(flatSun);

  // ---------- the plane itself ----------
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `uniform vec2 uFoil; uniform float uR; varying vec3 vWp; void main(){ vec3 p = vec3(position.x * (uR * 2.3 + 2.) + uFoil.x, 0., position.z * (uR * 2.3 + 2.) + uFoil.y); vWp = p; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
    fragmentShader: /* glsl */`precision highp float; varying vec3 vWp; uniform vec2 uFoil; uniform float uR, uTime; uniform vec3 uSunPos; uniform float uSunI; ${GLSL_NOISE}
      void main(){
        vec2 q = vWp.xz - uFoil; float d = length(q), a = atan(q.y, q.x); if (d > uR * 1.12 + .5) discard;
        vec3 V = normalize(cameraPosition - vWp); float graz = pow(1. - abs(V.y), 4.);
        float inside = smoothstep(uR, uR - .4 - uR * .004, d);
        // a sheet with no thickness: almost nothing head-on, a cold glaze at grazing angles
        float film = (.5 + .5 * fbm(q * .06 + vec2(uTime * .01, 0.))) ;
        vec3 sheen = vec3(.05, .075, .12) * (.25 + 1.1 * graz) * film;
        // starlight that has already fallen in: faint radial smears
        float smear = pow(vnoise(vec2(a * 160., d * .05)), 9.) * .5 + pow(vnoise(vec2(a * 420. + 9., d * .02)), 14.) * .9;
        sheen += vec3(.5, .6, .8) * smear * (.08 + .5 * graz) * smoothstep(0., 30., d);
        // the edge: space pouring over a lip
        float w = .25 + uR * .006, lip = exp(-pow((d - uR) / w, 2.));
        float fallz = exp(-max(uR - d, 0.) / (1.2 + uR * .012)) * step(d, uR) * (.55 + .45 * vnoise(vec2(a * 90., d * .6 - uTime * 3.)));
        float outer = exp(-max(d - uR, 0.) / (.6 + uR * .006)) * step(uR, d) * .3;
        vec3 edge = vec3(.75, .88, 1.) * (lip * 1.5 + fallz * .22 + outer * .5);
        float alpha = inside * (.42 + .4 * graz);
        vec3 col = sheen * inside + edge;
        gl_FragColor = vec4(col, alpha);
      }`,
  }));
  plane.frustumCulled = false; plane.renderOrder = 1; scene.add(plane);

  // ---------- orbits, belts, ships ----------
  const fallVS = (extra, pointSize, move = '') => /* glsl */`
    ${PLANE_GLSL} ${extra}
    varying float vFlat; varying vec3 vWp;
    void main(){ vec3 p = position; ${move} float y = fallY(p, 4.); vFlat = clamp(1. - abs(y) / max(abs(p.y), 1e-3), 0., 1.); p.y = y + 0.02; vWp = p;
      vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv; ${pointSize} }`;
  // orbit lines as screen-space ribbons with a Gaussian profile: a 1-pixel GL line crawls as the camera moves
  for (const b of BODIES) {
    if (!b.a || b.of) continue;
    const NO = 360, pos = new Float32Array((NO + 1) * 6), nxt = new Float32Array((NO + 1) * 6), sd = new Float32Array((NO + 1) * 2), idx = [];
    for (let i = 0; i <= NO; i++) { const p = ecl(b.a, i), q = ecl(b.a, i + 1); for (let k = 0; k < 2; k++) { pos.set(p, (i * 2 + k) * 3); nxt.set(q, (i * 2 + k) * 3); sd[i * 2 + k] = k ? 1 : -1; } if (i < NO) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aNext', new THREE.BufferAttribute(nxt, 3)); g.setAttribute('aSide', new THREE.BufferAttribute(sd, 1)); g.setIndex(idx);
    const line = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { ...U, uRes: resU }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: /* glsl */`
        ${PLANE_GLSL}
        attribute vec3 aNext; attribute float aSide; uniform vec2 uRes; varying float vFlat, vE;
        void main(){ vec3 p = position, q = aNext; float y = fallY(p, 4.); vFlat = clamp(1. - abs(y) / max(abs(p.y), 1e-3), 0., 1.); p.y = y + .02; q.y = fallY(q, 4.) + .02;
          vec4 a = projectionMatrix * viewMatrix * vec4(p, 1.), c = projectionMatrix * viewMatrix * vec4(q, 1.);
          vec2 d = normalize((c.xy / max(c.w, 1e-4) - a.xy / max(a.w, 1e-4)) * uRes + 1e-6); a.xy += vec2(-d.y, d.x) * aSide * 4.2 / uRes * a.w; vE = aSide; gl_Position = a; }`,
      fragmentShader: `precision highp float; varying float vFlat, vE; void main(){ gl_FragColor = vec4(mix(vec3(.16, .2, .3), vec3(.5, .62, .9), vFlat) * (.55 + .7 * vFlat) * exp(-vE * vE * 4.5) * .7, 1.); }`,
    }));
    line.frustumCulled = false; scene.add(line);
  }
  const belt = (n, a0, a1, thick, size, col) => {
    const pos = new Float32Array(n * 3), sd = new Float32Array(n);
    for (let i = 0; i < n; i++) { const a = lerp(a0, a1, Math.pow(R(), 0.8)), p = ecl(a, R() * 360, (R() - 0.5) * thick * (R() + 0.3)); pos.set(p, i * 3); sd[i] = R(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aS', new THREE.BufferAttribute(sd, 1));
    const m = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { ...U, uCol: { value: new THREE.Color(...col) }, uSize: { value: size } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: fallVS('attribute float aS; uniform float uPx, uSize; varying float vS;', 'vS = aS; gl_PointSize = clamp(uSize * uPx * (.6 + aS) * 260. / -mv.z, 1., 5. * uPx);'),
      fragmentShader: `precision highp float; uniform vec3 uCol; varying float vFlat, vS; void main(){ vec2 q = gl_PointCoord * 2. - 1.; float a = exp(-dot(q, q) * 3.);
        gl_FragColor = vec4(mix(uCol, vec3(.75, .88, 1.) * 1.6, vFlat) * a * (.4 + .9 * vS), 1.); }`,
    }));
    m.frustumCulled = false; scene.add(m);
  };
  belt(Math.floor(5000 * quality.density), 60, 70, 3, 1.0, [0.5, 0.45, 0.38]);
  belt(Math.floor(9000 * quality.density), 172, 240, 14, 1.0, [0.4, 0.46, 0.56]);
  // the ships that ran: none of them is fast enough. Each one ends as a small bright mark in the plane.
  {
    const n = Math.floor(900 * quality.density), pos = new Float32Array(n * 3), vel = new Float32Array(n * 4), sd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const src = R() < 0.55 ? B.earth : R() < 0.75 ? B.jupiter : B.saturn, rr = src.r * (1.3 + R() * 2.2), a = R() * 6.283;
      const p = [src.p[0] + Math.cos(a) * rr, src.p[1] + (R() - 0.5) * src.r, src.p[2] + Math.sin(a) * rr]; pos.set(p, i * 3);
      let d = [p[0] - FOIL_X + (R() - 0.5) * 60, (R() - 0.3) * 30, p[2] + (R() - 0.5) * 60]; const l = Math.hypot(...d), sp = 0.25 + R() * 0.75;
      vel.set([d[0] / l * sp, d[1] / l * sp, d[2] / l * sp, lerp(T.start + 2, src.t0 - 2, Math.pow(R(), 0.6))], i * 4); sd[i] = R();
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aV', new THREE.BufferAttribute(vel, 4)); g.setAttribute('aS', new THREE.BufferAttribute(sd, 1));
    const m = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: fallVS('attribute vec4 aV; attribute float aS; uniform float uPx; varying float vS, vOn;', 'vS = aS; gl_PointSize = clamp(uPx * (1. + aS) * 150. / -mv.z, 1.2, 4. * uPx) * vOn;', 'float tt = max(uTime - aV.w, 0.); vOn = step(1e-3, tt); p += aV.xyz * tt;'),
      fragmentShader: `precision highp float; varying float vFlat, vS, vOn; void main(){ vec2 q = gl_PointCoord * 2. - 1.; float a = exp(-dot(q, q) * 3.);
        gl_FragColor = vec4(mix(vec3(1., .82, .55), vec3(.8, .9, 1.) * 1.5, vFlat) * a * (.5 + .8 * vS) * vOn, 1.); }`,
    }));
    m.frustumCulled = false; scene.add(m);
  }

  // ---------- Earth's oceans: a crown of snowflakes hundreds of kilometres across ----------
  const NS = Math.floor(520 * quality.density), E = B.earth;
  const flakeU = { uTime: U.uTime, uT0: { value: E.done + 3 } };
  {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3)); g.setIndex([0, 2, 1, 0, 3, 2]);
    const a = new Float32Array(NS * 4), c = new Float32Array(NS * 4), Rm = E.Rf * 1.14;
    for (let i = 0; i < NS; i++) {
      const ang = R() * 6.283, k = Math.pow(R(), 1.6), rad = Rm * (1.03 + 0.8 * k);
      a.set([E.p[0] + Math.cos(ang) * rad, E.p[2] + Math.sin(ang) * rad, (0.12 + 0.6 * Math.pow(R(), 2.2)) * (1 + k * 0.5), R() * 6.283], i * 4);
      c.set([R(), R() * 4 + k * 7, R(), R()], i * 4);
    }
    g.setAttribute('aA', new THREE.InstancedBufferAttribute(a, 4)); g.setAttribute('aC', new THREE.InstancedBufferAttribute(c, 4)); g.instanceCount = NS;
    const flakes = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: flakeU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute vec4 aA, aC; uniform float uTime, uT0; varying vec2 vUv; varying float vG, vSeed;
        void main(){ float g = clamp((uTime - uT0 - aC.y) / 4.5, 0., 1.); g = 1. - pow(1. - g, 3.); float cs = cos(aA.w), sn = sin(aA.w);
          vec2 q = vec2(cs * position.x - sn * position.z, sn * position.x + cs * position.z) * aA.z * g;
          vUv = position.xz; vG = g; vSeed = aC.x; gl_Position = projectionMatrix * viewMatrix * vec4(aA.x + q.x, .03, aA.y + q.y, 1.); }`,
      fragmentShader: /* glsl */`precision highp float; varying vec2 vUv; varying float vG, vSeed; uniform float uTime;
        float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h); }
        void main(){
          float r = length(vUv); if (r > 1.) discard;
          float a = atan(vUv.y, vUv.x); a = mod(a, 1.0472); a = abs(a - .5236);          // six-fold, mirrored
          vec2 p = vec2(cos(a), sin(a)) * r; const vec2 ax = vec2(.8660, .5), bx = vec2(.8660, -.5);
          float d = seg(p, vec2(0.), ax * .95);
          for (int i = 1; i <= 5; i++) {                                                  // side branches, shorter toward the tip, each with twigs of its own
            float t = float(i) * .165 + .02 * sin(vSeed * 40. + float(i)), len = (.36 - .055 * float(i)) * (.7 + .6 * fract(vSeed * 7.3 + float(i) * .37)); vec2 o = ax * t;
            d = min(d, seg(p, o, o + bx * len)); d = min(d, seg(p, o + bx * len * .5, o + bx * len * .5 + ax * len * .34)); d = min(d, seg(p, o + bx * len * .75, o + bx * len * .75 + ax * len * .18));
          }
          d = min(d, abs(r - .14 - .1 * fract(vSeed * 3.1)) + .01);                      // hexagonal plate at the core
          float px = fwidth(d), w = max(.008, px);
          float line = smoothstep(w * 2., w * .3, d) * min(1., .02 / w) + .07 * smoothstep(.12, .0, d);
          gl_FragColor = vec4(mix(vec3(.6, .82, 1.), vec3(.9, .97, 1.), fract(vSeed * 9.7)) * line * 1.25 * vG, 1.);
        }`,
    }));
    flakes.frustumCulled = false; flakes.renderOrder = 6; scene.add(flakes);
  }

  // ---------- the foil ----------
  const foilPos = t => { const k = easeOut(clamp(t / T.arrive, 0, 1), 2.4); return [lerp(FOIL_X + 70, FOIL_X, k), lerp(9, 0, k), lerp(-26, 0, k)]; };
  const foilU = { uI: { value: 1 }, uTime: U.uTime };
  const foil = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.44, 1, 1), new THREE.ShaderMaterial({
    uniforms: foilU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`,
    fragmentShader: `precision highp float; varying vec2 vUv; uniform float uI, uTime;
      void main(){ vec2 e = min(vUv, 1. - vUv); float edge = smoothstep(0., .04, min(e.x, e.y * 2.));
        float rim = 1. - smoothstep(0., .1, min(e.x, e.y * 2.));
        float sh = .5 + .5 * sin((vUv.x * 3. + vUv.y * 5.) * 6.283 + uTime * 1.3);
        vec3 tint = mix(vec3(.86, .93, 1.), vec3(1., .96, .9), sh);
        gl_FragColor = vec4(tint * (1.15 + 1.5 * rim + .25 * sh) * edge * uI * (.92 + .08 * sin(uTime * 3.)), 1.); }`,
  }));
  const foilGlow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { ...foilU, uP: { value: new THREE.Vector3() }, uAspect: { value: 16 / 9 }, uMin: { value: 0.01 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform vec3 uP; uniform float uAspect, uMin; varying vec2 vUv; void main(){ vUv = position.xy; vec4 c = projectionMatrix * viewMatrix * vec4(uP, 1.);
      float s = max(uMin * c.w, 1.6 * projectionMatrix[1][1]); c.xy += position.xy * vec2(1. / uAspect, 1.) * s; gl_Position = c; }`,
    fragmentShader: `precision highp float; varying vec2 vUv; uniform float uI; void main(){ float r = length(vUv); if (r > 1.) discard;
      gl_FragColor = vec4(vec3(.8, .88, 1.) * (.22 / (1. + r * r * 60.)) * smoothstep(1., .3, r) * uI, 1.); }`,
  }));
  foil.frustumCulled = false; foilGlow.frustumCulled = false; foilGlow.renderOrder = 6; scene.add(foil, foilGlow);

  // ---------- the one ship that gets away: only lightspeed is fast enough ----------
  const TH = { go: 164, jump: 168.5 }, haloDir = new THREE.Vector3(0.12, 0.8, 0.5).normalize(), halo0 = v3add(B.pluto.p, [0.2, 0.9, 0.3]);
  const haloAt = t => { const x = Math.max(0, Math.min(t, TH.jump) - TH.go), j = Math.max(0, t - TH.jump), d = 0.12 * x * x + j * j * 260 + j * 30; return [halo0[0] + haloDir.x * d, halo0[1] + haloDir.y * d, halo0[2] + haloDir.z * d]; };
  const haloLine = new THREE.Mesh(new THREE.PlaneGeometry(1, 2, 1, 1).translate(0.5, 0, 0), new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 }, uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uRes: { value: new THREE.Vector2(1920, 1080) } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: `uniform vec3 uA, uB; uniform vec2 uRes; varying vec2 vQ;
      void main(){ vec4 a = projectionMatrix * viewMatrix * vec4(uA, 1.), b = projectionMatrix * viewMatrix * vec4(uB, 1.); vec4 c = mix(a, b, position.x);
        vec2 d = normalize((b.xy / max(b.w, 1e-4) - a.xy / max(a.w, 1e-4)) * uRes + 1e-5); c.xy += vec2(-d.y, d.x) * position.y * 3.4 / uRes * c.w; vQ = position.xy; gl_Position = c; }`,
    fragmentShader: `precision highp float; varying vec2 vQ; uniform float uI; void main(){ gl_FragColor = vec4(vec3(.7, .86, 1.) * (.15 + 3.2 * vQ.x * vQ.x * vQ.x) * exp(-vQ.y * vQ.y * 3.) * uI, 1.); }` }));
  haloLine.frustumCulled = false; scene.add(haloLine);
  const haloGlint = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uP: { value: new THREE.Vector3() }, uAspect: { value: 16 / 9 }, uI: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform vec3 uP; uniform float uAspect; varying vec2 vUv; void main(){ vUv = position.xy; vec4 c = projectionMatrix * viewMatrix * vec4(uP, 1.); c.xy += position.xy * vec2(1. / uAspect, 1.) * .05 * c.w; gl_Position = c; }`,
    fragmentShader: `precision highp float; varying vec2 vUv; uniform float uI; void main(){ float r = length(vUv); if (r > 1.) discard;
      float st = exp(-abs(vUv.y) * 60.) * exp(-abs(vUv.x) * 3.) + exp(-abs(vUv.x) * 60.) * exp(-abs(vUv.y) * 3.);
      gl_FragColor = vec4(vec3(.8, .9, 1.) * (exp(-r * r * 70.) * 5. + st * 1.4) * uI, 1.); }`,
  }));
  haloGlint.frustumCulled = false; haloGlint.renderOrder = 7; scene.add(haloGlint);

  // ---------- per-frame ----------
  const st = {};
  function update(t, env) {
    if (env.realm === 'city') { city.update(cityU(t), t, env); return; }
    U.uTime.value = t; U.uPx.value = env.h / 1080; space.setViewport(env.h); resU.value.set(env.w, env.h);
    const Rn = t < T.start ? 0 : Rof(t); U.uR.value = Rn;
    plane.visible = t > T.start;
    for (const b of BODIES) st[b.id] = bodyState(b, t);
    // the Sun
    const ss = st.sun; sunMesh.position.set(0, ss.y, 0); sunMesh.visible = ss.s < 1; sunMesh.rotation.y = t * 0.01;
    U.uSunPos.value.set(0, Math.max(ss.y, 0.5), 0); U.uSunI.value = 1 - 0.25 * ss.s;
    coronaU.uP.value.set(0, ss.y, 0); coronaU.uI.value = 1 - smooth(0.55, 1, ss.s);
    flatSun.position.set(0, 0.012, 0); flatSun.scale.setScalar(sunB.Rf); flatSunU.uGrow.value = ss.R / sunB.Rf; flatSunU.uDone.value = smooth(0.9, 1, ss.s) * smooth(0, 6, t - sunB.done + 1); flatSun.visible = ss.s > 0;
    for (const id in objs) {
      const o = objs[id], s = st[id], b = o.b, fu = o.fmat.uniforms;
      o.mesh.position.set(b.p[0], s.y, b.p[2]); o.mesh.visible = s.s < 1 || (!!b.ring && s.y + b.r * b.ring[1] > 0);
      if (o.ring) o.ring.material.uniforms.uCen.value.set(b.p[0], s.y, b.p[2]);
      const sinking = smooth(0, 0.03, s.s) * (1 - smooth(0.97, 1, s.s));
      o.mat.uniforms.uCut.value = sinking;
      o.disc.position.set(b.p[0], 0.01 + 0.002 * b.r + (b.of ? 0.004 : 0), b.p[2]); o.disc.visible = s.s > 0;
      fu.uRc.value = s.rc; fu.uRout.value = Math.max(s.R, 1e-3); fu.uThW.value = s.thW; fu.uOpen.value = s.open; fu.uSink.value = sinking; fu.uDone.value = s.s >= 1 ? 1 : 0;
      if (b.ring) fu.uRing.value = smooth(0.35, 1, s.s);
      if (id === 'earth') { fu.uFrostR.value = 1.25 - 1.3 * smooth(b.done + 1.5, b.done + 12, t); fu.uDark.value = smooth(b.done + 2, b.done + 11, t); }
    }
    // the foil glides in, rests, goes dark; the plane starts where it lies
    const fp = foilPos(t); foil.position.set(fp[0], fp[1], fp[2]);
    foil.rotation.set(-1.25 + 0.5 * Math.sin(t * 0.21), t * 0.16, 0.3 * Math.sin(t * 0.13 + 1) * (1 - smooth(T.arrive - 2, T.arrive + 2, t)));
    foilU.uI.value = 1 - 0.985 * smooth(T.dim, T.start, t); foil.visible = t < T.start + 4;
    foilGlow.material.uniforms.uP.value.set(fp[0], fp[1], fp[2]); foilGlow.material.uniforms.uAspect.value = env.w / env.h; foilGlow.visible = foil.visible;
    // Halo
    const hp = haloAt(t), ht = haloAt(Math.max(TH.go, t - (t > TH.jump ? 0.6 : 2.5))), hu = haloLine.material.uniforms;
    hu.uA.value.set(ht[0], ht[1], ht[2]); hu.uB.value.set(hp[0], hp[1], hp[2]); hu.uRes.value.set(env.w, env.h);
    const hI = smooth(TH.go, TH.go + 1.5, t) * (1 - smooth(TH.jump + 1.2, TH.jump + 2.4, t));
    haloLine.material.uniforms.uI.value = hI * (t > TH.jump ? 3.5 : 0.8); haloGlint.material.uniforms.uP.value.set(hp[0], hp[1], hp[2]);
    haloGlint.material.uniforms.uAspect.value = env.w / env.h; haloGlint.material.uniforms.uI.value = hI * (1 + 5 * Math.exp(-Math.abs(t - TH.jump) * 4));
    const cam = env.camera; cam.near = clamp(cam.position.distanceTo(foil.position) * 0.2, 0.01, 0.5); cam.far = 20000;
    if (cam.position.y < 0.08 && Rn > 0) cam.position.y = 0.08;
  }
  function render(r, cam, target, env) { r.setRenderTarget(target); r.autoClear = true; r.render(env.realm === 'city' ? city.scene : scene, cam); }
  function post(t, env) {
    if (env.realm === 'city') return city.post();
    return { exposure: 1.0, bloom: 0.3, bloomThreshold: 1.4, bloomKnee: 0.9, bloomRadius: 1.2, streak: 0.06, streakColor: [1.0, 0.8, 0.6],
      ca: 0.2, vignette: 0.5, grain: 0.032, saturation: 1.05, contrast: 1.04, tintLo: [0.95, 0.98, 1.07], tintHi: [1.04, 1.0, 0.96] };
  }

  // ---------- anchors ----------
  const S = (id, t) => bodyState(B[id], t);
  const at = (id, t) => { const b = B[id], s = bodyState(b, t); return [b.p[0], s.s >= 1 ? 0 : Math.max(s.y, 0), b.p[2]]; };
  const fz = (id, zh, en, k = 1, dir = [0.55, 0.42, 0.72]) => ({ id, zh, en, get: t => { const b = B[id], s = bodyState(b, t); return { p: at(id, t), r: Math.max(b.r, s.R * 0.75) * k, dir }; } });
  // where the Great Red Spot lies in the flat Jupiter
  const grsFlat = t => { const o = objs.jupiter, s = S('jupiter', t), lon = 2.2 - t * 0.004, v = new THREE.Vector3(Math.cos(-0.38) * Math.cos(lon), Math.sin(-0.38), Math.cos(-0.38) * Math.sin(lon)).applyMatrix4(o.rot);
    const xo = Math.acos(clamp(v.y, -1, 1)) / Math.PI, a = Math.atan2(v.z, v.x), rho = s.R * Math.sqrt(s.open * s.open + (1 - s.open * s.open) * xo * xo); return [B.jupiter.p[0] + Math.cos(a) * rho, 0, B.jupiter.p[2] + Math.sin(a) * rho]; };
  const focus = [
    { id: 'foil', zh: '二向箔', en: 'The foil', get: t => ({ p: foilPos(Math.min(t, T.arrive + 1)), r: t < T.start ? 0.8 : Math.max(3, Rof(t) * 0.5), dir: [0.5, 0.35, 0.8] }) },
    fz('neptune', '海王星', 'Neptune'), fz('saturn', '土星', 'Saturn', 1.5), fz('jupiter', '木星', 'Jupiter', 1, [-0.2, 0.5, -0.84]),
    { id: 'grs', zh: '大红斑', en: 'Great Red Spot', get: t => { const s = S('jupiter', t); return s.s >= 1 ? { p: grsFlat(t), r: 2.6, dir: [0.1, 0.9, -0.42] } : { p: at('jupiter', t), r: B.jupiter.r, dir: [-0.15, 0.45, -0.88] }; } },
    fz('earth', '地球', 'Earth', 1, [-0.4, 0.5, -0.77]),
    { id: 'witness', zh: '见证者', en: 'The witness', realm: 'city', get: t => ({ p: v3add(city.figure(cityU(t)), [0, 1.2, 0]), r: 2.4, dir: [0.3, 0.22, -0.93] }) },
    fz('sun', '太阳', 'The Sun'),
    { id: 'all', zh: '太阳系全景', en: 'Whole system', get: () => ({ p: [40, 6, 0], r: 150, dir: [0.35, 0.62, 0.7] }) },
  ];

  // ---------- cameras ----------
  const orb = (c, az, el, d, fov, extra) => ({ pos: [c[0] + Math.cos(az) * Math.cos(el) * d, Math.max(0.25, c[1] + Math.sin(el) * d), c[2] + Math.sin(az) * Math.cos(el) * d], look: c, fov, ...extra });
  const J = B.jupiter, Sa = B.saturn, Nn = B.neptune, Su = B.sun;
  const body = (id, t, k = 0.5) => { const b = B[id], s = S(id, t); return [b.p[0], s.s >= 1 ? 0 : Math.max(s.y, 0) * k, b.p[2]]; };
  const C = {
    hook: u => orb([0, 2.5, 0], lerp(0.85, 1.05, u), 0.13, lerp(44, 38, u), 44),
    calm: u => ({ pos: v3lerp([156, 128, 168], [158, 72, 122], easeInOut(u)), look: v3lerp([26, 6, 0], [44, 12, -4], u), fov: 30 }),
    // home, a little before: the Earth on the right of the frame, the Moon, the Sun beyond
    home: u => { const az = lerp(-2.5, -2.3, u), d = lerp(8.6, 7.6, u), c = E.p; return { pos: [c[0] + Math.cos(az) * d, c[1] + 0.9, c[2] + Math.sin(az) * d], look: [c[0] - Math.sin(az) * 2.6, c[1] - 0.1, c[2] + Math.cos(az) * 2.6], fov: 34 }; },
    foil: (u, t) => { const f = foilPos(t); return { pos: v3lerp([f[0] + 2.1, f[1] + 0.8, f[2] + 2.9], [FOIL_X + 1.8, 0.55, 3.2], easeInOut(u)), look: v3lerp(f, [FOIL_X, 0, 0], u), fov: 28 }; },
    neptune: (u, t) => orb(body('neptune', t), lerp(2.15, 2.95, easeInOut(u)), lerp(0.2, 0.42, u), 15 + 0.5 * S('neptune', t).R, 34),
    saturn: (u, t) => orb(body('saturn', t), lerp(3.5, 2.6, easeInOut(u)), lerp(0.18, 0.5, u), 30 + 0.7 * S('saturn', t).R, 36),
    // Jupiter: coming down; skimming the plane toward the waterline; rising over it; the flat storm
    jApproach: (u, t) => ({ pos: [J.p[0] + Math.cos(lerp(-1.95, -1.7, u)) * 25, lerp(1.4, 3, u), J.p[2] + Math.sin(lerp(-1.95, -1.7, u)) * 25], look: [J.p[0], Math.max(S('jupiter', t).y, 0) * 0.8 + 1, J.p[2]], fov: 46 }),
    jSkim: (u, t) => { const az = lerp(-1.75, -1.4, u), d = lerp(22, 12.5, easeInOut(u)), rc = S('jupiter', t).rc; return { pos: [J.p[0] + Math.cos(az) * d, lerp(2.2, 4.2, u), J.p[2] + Math.sin(az) * d], look: [J.p[0] + Math.cos(az) * rc * 0.6, lerp(1.2, 0.6, u), J.p[2] + Math.sin(az) * rc * 0.6], fov: 44 }; },
    jRise: (u, t) => orb(body('jupiter', t, 0.35), lerp(-1.45, -0.55, easeInOut(u)), lerp(0.1, 1.12, easeInOut(u)), lerp(19, 31, u), 40),
    jFlat: (u, t) => { const k = smoother(clamp((u - 0.2) / 0.8, 0, 1)), g = grsFlat(t), c = v3lerp([J.p[0], 0, J.p[2]], g, k); return orb(c, lerp(-0.55, -0.2, u), lerp(1.12, 0.95, k), lerp(31, 7.2, k), 40, { roll: 0.25 * k }); },
    eApproach: (u, t) => orb(body('earth', t, 1), lerp(-2.25, -1.95, u), lerp(0.1, 0.2, u), lerp(8.6, 7.4, u), 36),
    eSkim: (u, t) => { const az = lerp(-1.95, -1.6, u), d = lerp(8, 4.6, easeInOut(u)), rc = S('earth', t).rc; return { pos: [E.p[0] + Math.cos(az) * d, lerp(0.3, 0.85, u), E.p[2] + Math.sin(az) * d], look: [E.p[0] + Math.cos(az) * rc * 0.7, lerp(0.7, 1.0, u), E.p[2] + Math.sin(az) * rc * 0.7], fov: 42 }; },
    eCap: (u, t) => { const y = Math.max(S('earth', t).y + E.r, 0); return orb([E.p[0], y * 0.8, E.p[2]], lerp(-1.6, -1.1, u), lerp(0.5, 1.3, easeInOut(u)), lerp(7.5, 1.9, easeInOut(u)), 36); },
    eFlat: u => { const h = 2.4 * Math.exp(2.85 * (1 - (1 - u) * (1 - u))); return { pos: [E.p[0] + h * 0.05, h, E.p[2] - h * 0.04], look: [E.p[0], 0, E.p[2] + h * 0.06], fov: 40, roll: 0.5 + 0.35 * u }; },
    sunLow: (u, t) => orb([0, Math.max(S('sun', t).y, 0) * 0.5 + 1, 0], lerp(0.75, 1.0, u), lerp(0.1, 0.2, u), lerp(52, 44, u), 44),
    sunTop: u => orb([0, 0, 0], lerp(1.0, 1.6, easeInOut(u)), lerp(0.2, 1.2, easeInOut(u)), lerp(44, 86, easeInOut(u)), 44),
    painting: u => ({ pos: v3lerp([135, 50, 135], [262, 176, 262], easeOut(u, 2)), look: v3lerp([24, 0, 14], [-20, 0, 0], u), fov: 40 }),
  };

  // ---------- interactive director ----------
  const figU = x => (x < 0.6 ? lerp(0.883, 1, x / 0.6) : lerp(1, 1.14, (x - 0.6) / 0.4));
  const SH = (a, b, cam) => ({ a, b, cam });
  const SHOTS = [
    SH(0, 5, u => C.home(u)), SH(5, T.start + 4, (u, t) => C.foil(u, t)),
    SH(T.start + 4, Nn.t0 + 1, (u, t) => ({ pos: v3lerp([FOIL_X + 12, 5, 18], [FOIL_X + 34, 16, 40], easeInOut(u)), look: v3lerp([FOIL_X, 0, 0], [Nn.p[0], 6, Nn.p[2]], u), fov: 38 })),
    SH(Nn.t0 + 1, Nn.done + 3, (u, t) => C.neptune(u, t)),
    SH(Nn.done + 3, Sa.done + 6, (u, t) => C.saturn(u, t)),
    SH(Sa.done + 6, J.tT + 1.5, (u, t) => C.jApproach(u, t)), SH(J.tT + 1.5, J.tT + 11, (u, t) => C.jSkim(u, t)), SH(J.tT + 11, J.done + 0.5, (u, t) => C.jRise(u, t)), SH(J.done + 0.5, E.t0 + 2, (u, t) => C.jFlat(Math.min(1, u * 1.6), t)),
    SH(E.t0 + 2, E.tT + 2, (u, t) => C.eApproach(u, t)), SH(E.tT + 2, W0 + 3, (u, t) => C.eSkim(u, t)),
    // on the ground, for the last of it
    SH(W0 + 3, W0 + 0.62 * CITY.WIN, u => city.cams.shoulder(u)), SH(W0 + 0.62 * CITY.WIN, W0 + 0.87 * CITY.WIN, u => city.cams.towers(u)),
    SH(W0 + 0.87 * CITY.WIN, W1 + 2.2, (u, t) => city.cams.figure(clamp((cityU(t) - 0.87) / (1.14 - 0.87), 0, 1), cityU(t))), SH(W1 + 2.2, W1 + 5, u => city.cams.crane(u * 0.8)),
    SH(W1 + 5, Su.t0 + 1, u => C.eFlat(0.25 + 0.75 * u)),
    SH(Su.t0 + 1, Su.tT + 8, (u, t) => C.sunLow(u, t)), SH(Su.tT + 8, Su.done + 10, u => C.sunTop(u)),
    SH(Su.done + 10, T.end + 1, u => C.painting(u)),
  ];
  function director(t) { for (const s of SHOTS) if (t >= s.a && t < s.b) return s.cam((t - s.a) / (s.b - s.a), t); return SHOTS[SHOTS.length - 1].cam(1, t); }

  const moments = [
    { t: 0, id: 'calm', zh: '太阳系', en: 'The Solar System', textZh: '掩体纪元。人类躲在巨行星的背阳面，以为这样就能躲过光粒打击。', textEn: 'The Bunker Era. Humanity shelters behind the giant planets, believing it can survive a photoid strike.' },
    { t: 6, id: 'foil', zh: '一张小纸条', en: 'A slip of paper', textZh: '一片长方形的膜状物滑入太阳系，发出柔和的白光，像一张小纸条。它对周围没有任何作用力。', textEn: 'A small rectangular membrane glides into the system, glowing softly, like a slip of paper. It exerts no force on anything.' },
    { t: T.dim, id: 'dim', zh: '光熄灭了', en: 'The light goes out', textZh: '纸条的光暗了下去。包裹它的力场消失，二维空间与三维空间直接接触。', textEn: 'Its glow fades. The field that wrapped it is gone; two-dimensional space now touches three.' },
    { t: T.start, id: 'start', zh: '跌落', en: 'Collapse', textZh: '三维空间开始向二维跌落。一个没有厚度的平面向外扩张。', textEn: 'Three-dimensional space begins to fall into two. A plane with no thickness spreads outward.' },
    { t: Nn.tT, id: 'neptune', zh: '海王星', en: 'Neptune', textZh: '海王星沉入平面。它的表面被摊开成一张以最后入水点为中心的地图，大暗斑仍在缓缓转动。', textEn: 'Neptune sinks into the plane. Its surface is laid out as a map around the last point to go under; the Great Dark Spot is still slowly turning.' },
    { t: Sa.tT, id: 'saturn', zh: '土星', en: 'Saturn', textZh: '土星和它的光环一同二维化，像一张刚刚锯开的树桩。', textEn: 'Saturn and its rings flatten together, like the face of a freshly sawn tree.' },
    { t: J.tT, id: 'jupiter', zh: '木星', en: 'Jupiter', textZh: '木星用了很久才沉下去。大气从水线处向外倾泻，条带一圈圈铺开。', textEn: 'Jupiter takes a long time to go under. Its atmosphere pours outward from the waterline, band after band.' },
    { t: J.done + 1, id: 'grs', zh: '风暴仍在旋转', en: 'The storm still turns', textZh: '在二维里，大红斑还在转。平面中的风暴没有第三个维度可以耗散——它会一直转下去。随后，木星的深处从中心涌出。', textEn: 'In two dimensions the Great Red Spot is still turning. A storm in a plane has no third dimension to dissipate into; it will turn for ever. Then Jupiter\'s depths well up in the middle.' },
    { t: E.tT, id: 'earth', zh: '地球', en: 'Earth', textZh: '地球触到了平面。海洋与大陆从水线向外流淌，气旋仍在旋转。', textEn: 'Earth touches the plane. Oceans and continents stream outward from the waterline; the cyclones keep turning.' },
    { t: W0 + 3, id: 'witness', zh: '见证者', en: 'The witness', textZh: '地面上最后一块三维的土地。平面的边缘从四面八方的地平线合拢过来：海水瞬间冻结成二维的冰晶，高楼沉入平面，每一层、每一扇亮着的窗都被摊开。最后是山，是露台，是人。', textEn: 'The last patch of three-dimensional ground. The edge of the plane closes in from every horizon at once: the sea freezes into flat crystals, towers sink and every floor and every lit window is laid out. Last of all the hill, the terrace, and the one who watched.' },
    { t: W1 + 5, id: 'snow', zh: '雪花', en: 'Snowflakes', textZh: '二维的海洋冻结。地球周围长出一圈直径数百公里的雪花。地核从中心涌出，像年轮。', textEn: 'The two-dimensional oceans freeze, and a crown of snowflakes hundreds of kilometres across grows around the Earth. Its core wells up in the middle like the rings of a tree.' },
    { t: Su.tT, id: 'sun', zh: '太阳', en: 'The Sun', textZh: '太阳坠落。它在平面上铺成一片旋涡状的火海，像梵高的《星空》。', textEn: 'The Sun falls and unrolls into a swirling sea of fire — Van Gogh\'s Starry Night.' },
    { t: TH.go, id: 'halo', zh: '只有光速', en: 'Only lightspeed', textZh: '整个太阳系成了一幅没有厚度的画。从冥王星出发的“星环”号以光速逃离——只有光速才能逃离。', textEn: 'The whole Solar System is now a painting with no thickness. From Pluto, the ship Halo escapes at lightspeed: nothing slower could.' },
  ];

  // ---------- film (150 s) ----------
  const F = (from, to, st0, st1, cam, ease) => ({ from, to, time: f => lerp(st0, st1, (ease || (x => x))((f - from) / (to - from))), cam });
  const CU = (from, to, u0, u1, cam) => ({ from, to, time: f => W0 + lerp(u0, u1, (f - from) / (to - from)) * CITY.WIN, cam });
  const filmShots = [
    F(0, 5, Su.tT + 5.5, Su.tT + 11, u => C.hook(u)),
    F(5, 11, 0.5, 4.5, u => C.home(u)),
    F(11, 22, 4.5, T.start + 6, (u, t) => C.foil(u, t)),
    F(22, 30, Nn.t0 + 2, Nn.done + 4, (u, t) => C.neptune(u, t)),
    F(30, 40, Sa.t0 + 3, Sa.done + 6, (u, t) => C.saturn(u, t)),
    F(40, 46, J.t0 + 3, J.tT + 1.5, (u, t) => C.jApproach(u, t)),
    F(46, 54, J.tT + 1.5, J.tT + 11.5, (u, t) => C.jSkim(u, t)),
    F(54, 60, J.tT + 11.5, J.done + 0.5, (u, t) => C.jRise(u, t)),
    F(60, 66, J.done + 0.5, J.done + 11, (u, t) => C.jFlat(u, t)),
    F(66, 72, E.t0 + 3, E.tT + 2, (u, t) => C.eApproach(u, t)),
    F(72, 78, E.tT + 2, E.tT + 9.5, (u, t) => C.eSkim(u, t)),
    F(78, 82, E.tT + 9.5, E.tT + 13.5, (u, t) => C.eCap(u, t)),
    CU(82, 88, 0.03, 0.28, u => city.cams.shoulder(u)),
    CU(88, 94, 0.585, 0.8, u => city.cams.bay(u)),
    CU(94, 100, 0.75, 0.883, u => city.cams.towers(u)),
    { from: 100, to: 106, time: f => W0 + figU((f - 100) / 6) * CITY.WIN, cam: (u, t) => city.cams.figure(u, cityU(t)) },
    CU(106, 110, 1.14, 1.4, u => city.cams.crane(u)),
    F(110, 118, E.done + 0.6, E.done + 13, u => C.eFlat(u)),
    F(118, 124, Su.tT + 1, Su.tT + 9, (u, t) => C.sunLow(u, t)),
    F(124, 130, Su.tT + 9, Su.done + 8, u => C.sunTop(u)),
    F(130, 150, TH.go - 4, T.end - 2, u => C.painting(u)),
  ];
  const filmDef = {
    duration: 150, shots: filmShots,
    fade: ft => (1 - 0.8 * smooth(141.4, 143, ft)) * (1 - smooth(148.8, 149.9, ft)),
    titles: [
      { from: 5.8, to: 10.4, kind: 'title', align: 'left', no: '03', zh: '二向箔', en: 'DIMENSIONAL STRIKE', sub: '太阳系二维化' },
      { from: 12.0, to: 17.0, kind: 'caption', zh: '一张小纸条', en: 'A slip of paper' },
      { from: 23.0, to: 28.0, kind: 'caption', zh: '海王星', en: 'Neptune' },
      { from: 31.0, to: 36.5, kind: 'caption', zh: '土星', en: 'Saturn' },
      { from: 41.0, to: 45.2, kind: 'caption', zh: '木星', en: 'Jupiter' },
      { from: 47.4, to: 52.6, kind: 'caption', zh: '大气从水线向外倾泻', en: 'Its atmosphere pours out from the waterline' },
      { from: 60.8, to: 65.4, kind: 'caption', zh: '在二维里，风暴仍在旋转', en: 'In two dimensions, the storm still turns' },
      { from: 67.0, to: 71.2, kind: 'caption', zh: '地球', en: 'Earth' },
      { from: 78.4, to: 81.6, kind: 'caption', zh: '最后一块三维的土地', en: 'The last patch of three dimensions' },
      { from: 83.0, to: 87.4, kind: 'caption', zh: '地平线上有一条亮线', en: 'A bright line on the horizon' },
      { from: 89.0, to: 93.2, kind: 'caption', zh: '海水瞬间冻结', en: 'The sea freezes in an instant' },
      { from: 95.0, to: 99.2, kind: 'caption', zh: '每一扇亮着的窗都被摊开', en: 'Every lit window, laid out flat' },
      { from: 106.6, to: 109.6, kind: 'caption', zh: '一座城，一幅画', en: 'A city, a picture' },
      { from: 111.0, to: 116.4, kind: 'caption', zh: '二维的海洋凝成雪花', en: 'Two-dimensional oceans freeze into snowflakes' },
      { from: 119.0, to: 123.4, kind: 'caption', zh: '太阳', en: 'The Sun' },
      { from: 125.4, to: 129.4, kind: 'caption', zh: '星空', en: 'The Starry Night' },
      { from: 134.0, to: 139.6, kind: 'caption', zh: '只有光速才能逃离', en: 'Only lightspeed escapes' },
      { from: 142.2, to: 150, kind: 'end' },
    ],
  };

  return {
    id: 'foil', duration: T.end, scene, moments, focus, update, render, post, director, film: filmDef,
    resize: () => {},
    orbitLimits: f => (f === 'witness' ? { min: 1.2, max: 9000, minY: 0.5 } : f === 'foil' ? { min: 0.6, max: 2500, minY: 0.1 } : { min: 1.5, max: 2500, minY: 0.1 }),
    debug: { B, bodyState, Rof, W0, W1, anchors: { zero: () => [0, 0, 0], foil: t => foilPos(t), ...Object.fromEntries(BODIES.map(b => [b.id, t => at(b.id, t)])) } },
  };
}
