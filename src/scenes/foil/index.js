// Dimensional Strike — the two-dimensionalization of the Solar System.
// Units are schematic (planet sizes exaggerated, distances compressed). The 2D plane is y = 0 and spreads
// outward from the foil's resting point; whatever its edge passes beneath falls in and unrolls into a flat picture.
import * as THREE from 'three';
import { clamp, lerp, smooth, smoother, easeInOut, easeOut, v3lerp, v3add, table, rng, GLSL_NOISE } from '../../core/util.js';
import { makeSpace } from '../../core/space.js';

const TILT = THREE.MathUtils.degToRad(12), H0 = 26, FOIL_X = 182;
const T = { arrive: 8, dim: 11, start: 14, end: 132 };
// collapse radius over time: slow at first, then faster and faster
const RKEYS = [[T.start, 0], [24, 26], [40, 88], [58, 144], [63, 158], [72, 180], [76, 190], [80, 202], [94, 250], [108, 312], [132, 470]];
const Rof = t => table(RKEYS, t);
const tOf = d => { for (let i = 1; i < RKEYS.length; i++) if (d <= RKEYS[i][1]) { const [t0, r0] = RKEYS[i - 1], [t1, r1] = RKEYS[i]; return lerp(t0, t1, (d - r0) / (r1 - r0)); } return 1e6; };

const ecl = (a, deg, up = 0) => { const th = THREE.MathUtils.degToRad(deg), x = a * Math.cos(th), ze = a * Math.sin(th); return [x, H0 + ze * Math.sin(TILT) + up, ze * Math.cos(TILT)]; };

const BODIES = [
  { id: 'sun', zh: '太阳', en: 'The Sun', a: 0, th: 0, r: 9, K: 3.7, fall: 13, type: 9 },
  { id: 'mercury', zh: '水星', en: 'Mercury', a: 20, th: 250, r: 0.9, K: 4.2, fall: 5, type: 0, pal: [[0.36, 0.33, 0.31], [0.22, 0.2, 0.19], [0.5, 0.47, 0.43]],
    flat: [[0.62, [1.0, 0.82, 0.5], 1.6], [0.9, [0.55, 0.3, 0.2], 0.5], [1.0, [0.3, 0.28, 0.27], 0.25]] },
  { id: 'venus', zh: '金星', en: 'Venus', a: 29, th: 320, r: 1.5, K: 4.2, fall: 5.5, type: 4, pal: [[0.78, 0.66, 0.42], [0.62, 0.48, 0.26], [0.9, 0.84, 0.66]],
    flat: [[0.2, [1.0, 0.9, 0.62], 2.0], [0.42, [1.0, 0.55, 0.2], 1.3], [0.76, [0.62, 0.22, 0.1], 0.6], [0.8, [0.2, 0.17, 0.15], 0.2], [1.0, [0.86, 0.72, 0.4], 0.42]] },
  { id: 'earth', zh: '地球', en: 'Earth', a: 40, th: 28, r: 1.7, K: 4.4, fall: 6.5, type: 1, pal: [[0.012, 0.045, 0.14], [0.055, 0.1, 0.04], [0.3, 0.24, 0.15]],
    flat: [[0.13, [1.0, 0.93, 0.7], 2.4], [0.33, [1.0, 0.6, 0.2], 1.5], [0.74, [0.7, 0.2, 0.08], 0.7], [0.78, [0.16, 0.14, 0.13], 0.2], [0.9, [0.05, 0.22, 0.6], 0.55], [1.0, [0.72, 0.9, 1.0], 0.5]] },
  { id: 'moon', zh: '月球', en: 'The Moon', a: 40, th: 28, r: 0.46, K: 4.2, fall: 4.5, type: 0, moon: true, pal: [[0.42, 0.41, 0.4], [0.22, 0.22, 0.23], [0.6, 0.59, 0.57]],
    flat: [[0.2, [1.0, 0.8, 0.5], 1.2], [0.9, [0.4, 0.38, 0.36], 0.3], [1.0, [0.7, 0.7, 0.68], 0.35]] },
  { id: 'mars', zh: '火星', en: 'Mars', a: 52, th: 105, r: 1.2, K: 4.2, fall: 5.5, type: 0, pal: [[0.52, 0.24, 0.12], [0.3, 0.13, 0.08], [0.72, 0.42, 0.24]],
    flat: [[0.28, [1.0, 0.82, 0.5], 1.6], [0.86, [0.6, 0.24, 0.1], 0.55], [1.0, [0.75, 0.33, 0.15], 0.4]] },
  { id: 'jupiter', zh: '木星', en: 'Jupiter', a: 78, th: 150, r: 5, K: 3.0, fall: 9, type: 2, pal: [[0.66, 0.52, 0.38], [0.4, 0.24, 0.15], [0.78, 0.72, 0.62]],
    flat: [[0.1, [0.5, 0.42, 0.36], 0.8], [0.6, [0.55, 0.66, 0.86], 0.75], [0.8, [0.86, 0.72, 0.5], 0.5], [0.92, [0.6, 0.36, 0.2], 0.45], [1.0, [0.9, 0.84, 0.72], 0.4]] },
  { id: 'saturn', zh: '土星', en: 'Saturn', a: 106, th: -22, r: 4.2, K: 5.3, fall: 8.5, type: 2, ring: [1.28, 2.3], pal: [[0.7, 0.6, 0.4], [0.52, 0.42, 0.26], [0.8, 0.74, 0.56]],
    flat: [[0.06, [0.5, 0.42, 0.36], 0.8], [0.3, [0.6, 0.7, 0.86], 0.75], [0.46, [0.9, 0.78, 0.5], 0.55], [0.54, [0.7, 0.56, 0.34], 0.45], [1.0, [0.8, 0.72, 0.58], 0.5]], ringFrom: 0.58 },
  { id: 'uranus', zh: '天王星', en: 'Uranus', a: 134, th: 200, r: 2.6, K: 3.4, fall: 7, type: 3, pal: [[0.4, 0.66, 0.72], [0.3, 0.56, 0.64], [0.56, 0.8, 0.84]],
    flat: [[0.18, [0.5, 0.44, 0.4], 0.7], [0.66, [0.8, 0.94, 0.98], 0.6], [1.0, [0.4, 0.74, 0.8], 0.5]] },
  { id: 'neptune', zh: '海王星', en: 'Neptune', a: 158, th: 6, r: 2.5, K: 3.4, fall: 7, type: 3, pal: [[0.07, 0.17, 0.62], [0.04, 0.1, 0.44], [0.2, 0.36, 0.86]],
    flat: [[0.18, [0.5, 0.44, 0.4], 0.7], [0.62, [0.74, 0.88, 1.0], 0.6], [1.0, [0.12, 0.26, 0.8], 0.55]] },
];
for (const b of BODIES) {
  b.p = ecl(b.a, b.th); if (b.moon) { b.p = v3add(b.p, [-7.6, 1.1, 6.4]); }
  b.d = Math.hypot(b.p[0] - FOIL_X, b.p[2]); b.t0 = tOf(Math.max(0, b.d - b.r * 1.2)); b.Rf = b.r * b.K;
}
const B = Object.fromEntries(BODIES.map(b => [b.id, b]));

// y of a body's centre and how much of it has gone under (0..1)
function bodyState(b, t) {
  const x = clamp((t - b.t0) / b.fall, 0, 1), e = x * x * (2 - x);
  const y = b.p[1] - (b.p[1] + b.r) * e, s = clamp((b.r - y) / (2 * b.r), 0, 1);
  const vol = s * s * (3 - 2 * s), done = b.t0 + b.fall;
  return { y, s, vol, R: b.Rf * Math.sqrt(vol) * (1 + 0.14 * (1 - Math.exp(-Math.max(0, t - done) / 9))) };
}

const PLANE_GLSL = /* glsl */`
uniform vec2 uRk[${RKEYS.length}]; uniform float uTime; uniform vec2 uFoil;
float tOfR(float d){
  for (int i = 1; i < ${RKEYS.length}; i++) { if (d <= uRk[i].y) return mix(uRk[i - 1].x, uRk[i].x, (d - uRk[i - 1].y) / (uRk[i].y - uRk[i - 1].y)); }
  return 1e6;
}
// everything small (belts, orbit lines) pours into the plane once the edge has passed beneath it
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
  const R = rng(404);

  // ---------- planets ----------
  const sphere = new THREE.SphereGeometry(1, 96, 64);
  const planetVS = /* glsl */`varying vec3 vN, vWp, vL; void main(){ vL = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.); vWp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
  const planetFS = /* glsl */`
    precision highp float; varying vec3 vN, vWp, vL;
    uniform vec3 uSunPos, uA, uB, uC; uniform float uSunI, uType, uSeed, uTime, uCut;
    ${GLSL_NOISE}
    void main(){
      if (vWp.y < 0.) discard;                                    // the part already in the plane is gone
      vec3 N = normalize(vN), V = normalize(cameraPosition - vWp), L = normalize(uSunPos - vWp);
      vec3 p = normalize(vL); float lat = p.y; vec3 q = p * 3. + uSeed;
      vec3 alb; float spec = 0., atmo = 0.; vec3 atmoC = vec3(.4, .6, 1.);
      if (uType < .5) {                                           // airless / thin-air rock
        float n = fbm3(q * 1.6), c = fbm3(q * 5.), cr = smoothstep(.62, .7, vnoise3(q * 7.)) * .5;
        alb = mix(uB, uA, smoothstep(.3, .7, n)); alb = mix(alb, uC, smoothstep(.5, .85, c) * .6); alb *= 1. - cr * .4;
      } else if (uType < 1.5) {                                   // Earth
        float land = smoothstep(.52, .56, fbm3(q * 1.25 + 2.) + .1 * fbm3(q * 6.));
        float ice = smoothstep(.78, .9, abs(lat) + .08 * fbm3(q * 4.));
        alb = mix(uA * (.7 + .6 * fbm3(q * 4.)), mix(uB, uC, smoothstep(.4, .7, fbm3(q * 3.3) + .3 * (1. - abs(lat) * 1.6))), land); alb = mix(alb, vec3(.8, .84, .88), ice);
        vec3 cq = q * 2.1 + vec3(uTime * .01, 0., 5.); cq += (vec3(fbm3(cq * 1.3), fbm3(cq * 1.3 + 5.), fbm3(cq * 1.3 + 9.)) - .5) * 1.6;
        float cl = smoothstep(.5, .74, fbm3(cq) * .62 + fbm3(cq * 4. + 9.) * .38);
        spec = (1. - land) * (1. - cl) * .9; alb = mix(alb, vec3(.86), cl * .88); atmo = 1.25; atmoC = vec3(.25, .5, 1.);
      } else if (uType < 2.5) {                                   // gas giant: sheared bands and storms
        float w = fbm3(vec3(p.x * 1.4, lat * 3., p.z * 1.4) + uSeed) - .5;
        float b = sin(lat * 15. + w * 3.2) * .5 + .5, b2 = sin(lat * 37. + w * 7.) * .5 + .5;
        alb = mix(uB, uA, b); alb = mix(alb, uC, b2 * .45);
        alb *= .86 + .28 * fbm3(vec3(p.x * 9., lat * 26., p.z * 9.) + uSeed);
        atmo = .35; atmoC = uC;
      } else if (uType < 3.5) {                                   // ice giant
        float b = sin(lat * 11. + fbm3(q) * 2.4) * .5 + .5; alb = mix(uA, uB, b * .7); alb = mix(alb, uC, smoothstep(.55, .8, fbm3(vec3(p.x * 2., lat * 9., p.z * 2.) + 4.)) * .45);
        alb = mix(alb, uB * .45, smoothstep(.2, .0, length(p - normalize(vec3(.5, -.32, .8)))) * .8);                      // a great dark spot
        atmo = .8; atmoC = uC;
      } else {                                                    // Venus: one continuous cloud deck
        float b = fbm3(vec3(p.x * 2., lat * 5., p.z * 2.) + uSeed + fbm3(q) * 1.5); alb = mix(uB, uA, b); alb = mix(alb, uC, smoothstep(.55, .8, b));
        atmo = .7; atmoC = uA;
      }
      float nl = dot(N, L), day = smoothstep(-.08, .25, nl) ;
      vec3 col = alb * (max(nl, 0.) * 2.9 * uSunI + .006);
      vec3 H = normalize(L + V); col += vec3(1., .95, .85) * pow(max(dot(N, H), 0.), 70.) * spec * day * uSunI * 1.6;
      float rim = pow(1. - max(dot(N, V), 0.), 3.2);
      col += atmoC * rim * atmo * (day * 1.1 * uSunI + .03);
      if (uType > .5 && uType < 1.5) col += vec3(1., .72, .36) * step(.55, fbm3(q * 1.25 + 2.) + .08 * fbm3(q * 6.)) * smoothstep(.72, .95, vnoise3(q * 9.)) * pow(vnoise3(q * 60.), 6.) * (1. - day) * 2.4;   // city lights
      // where the sphere meets the plane its matter is being pulled flat: a hot, bright seam
      float seam = exp(-vWp.y / (.035 + .05 * uCut)) * uCut;
      col += vec3(1., .86, .6) * seam * 5.;
      if (!gl_FrontFacing) col = vec3(1., .8, .5) * (1.5 + 4. * seam);
      gl_FragColor = vec4(col, 1.);
    }`;
  const flatVS = /* glsl */`varying vec2 vUv; void main(){ vUv = position.xz; vec4 w = modelMatrix * vec4(position, 1.); gl_Position = projectionMatrix * viewMatrix * w; }`;
  const flatFS = /* glsl */`
    precision highp float; varying vec2 vUv;
    uniform float uB[6]; uniform vec3 uC[6]; uniform float uE[6]; uniform float uSeed, uTime, uGrow, uRingFrom, uDone, uSunI;
    ${GLSL_NOISE}
    void main(){
      float r = length(vUv), a = atan(vUv.y, vUv.x); vec2 ac = vUv / max(r, 1e-5);
      // the rim is still spreading: slightly ragged, with tongues running outward
      float wob = (fbm(ac * 2.6 + vec2(uSeed, uTime * .05)) - .5) * .09 * (1. - .75 * uDone) + (vnoise(ac * 17. + uSeed) - .5) * .018;
      float rr = r / max(uGrow, 1e-4) + wob * smoothstep(.3, 1., r / max(uGrow, 1e-4));
      if (rr > 1.) discard;
      vec3 col = vec3(0.); float em = 0.; float prev = 0.;
      for (int i = 0; i < 6; i++) {
        float b = uB[i] + (vnoise(ac * 3.5 + float(i) * 7. + uSeed) - .5) * .022 * step(uB[i], .999);
        float m = step(prev, rr) * step(rr, b);
        col += uC[i] * m; em += uE[i] * m; prev = b;
      }
      // growth rings: fine concentric lines that wander a little, like the grain of a felled tree
      float wv = fbm(ac * 1.7 + rr * 2.5 + uSeed) * 2.4;
      float aa = fwidth(rr) * 260.;
      float tr = mix(sin(rr * 260. + wv * 3.) * .5 + .5, .5, clamp(aa * .45, 0., 1.));
      float tr2 = sin(rr * 58. + wv * 2. + vnoise(ac * 2.2 + uSeed) * 3.) * .5 + .5;
      float streak = fbm(ac * 22. + vec2(uSeed * 3., rr * 1.5));                    // radial smearing from the unrolling
      col *= (.62 + .5 * tr) * (.7 + .42 * tr2) * (.78 + .44 * streak);
      float edges = 0.;
      for (int i = 0; i < 5; i++) { edges += exp(-pow((rr - uB[i]) / .005, 2.)); }
      col *= 1. - .6 * clamp(edges, 0., 1.);
      float alpha = 1.;
      if (uRingFrom > 0. && rr > uRingFrom) {                                         // the ring system, flattened into the same sheet
        float u = (rr - uRingFrom) / (1. - uRingFrom);
        float gaps = smoothstep(.02, .05, abs(u - .62)) * smoothstep(.0, .03, u) * (.55 + .45 * vnoise(vec2(u * 60., 3.))) * (.6 + .4 * vnoise(vec2(u * 190., 9.)));
        alpha = gaps * .92; em *= .8;
      }
      float front = smoothstep(1., .94, rr);
      vec3 outc = col * (.22 + em * 1.2) * (.55 + .45 * uSunI) + vec3(1., .9, .7) * (1. - front) * 1.6 * (1. - uDone * .85);
      gl_FragColor = vec4(outc * alpha, alpha);
    }`;

  const objs = {};
  for (const b of BODIES) {
    if (b.id === 'sun') continue;
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSunPos: U.uSunPos, uSunI: U.uSunI, uTime: U.uTime, uA: { value: new THREE.Vector3(...b.pal[0]) }, uB: { value: new THREE.Vector3(...b.pal[1]) }, uC: { value: new THREE.Vector3(...b.pal[2]) }, uType: { value: b.type }, uSeed: { value: R() * 50 }, uCut: { value: 0 } },
      vertexShader: planetVS, fragmentShader: planetFS, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(sphere, mat); mesh.scale.setScalar(b.r); mesh.rotation.set(b.ring ? 0.42 : 0.2 + R() * 0.3, R() * 6, b.ring ? 0.2 : 0.1); mesh.frustumCulled = false;
    const fb = [], fc = [], fe = [];
    for (let i = 0; i < 6; i++) { const L = b.flat[Math.min(i, b.flat.length - 1)]; fb.push(i < b.flat.length ? L[0] : 1.001); fc.push(new THREE.Vector3(...L[1])); fe.push(L[2]); }
    const fmat = new THREE.ShaderMaterial({
      uniforms: { uB: { value: fb }, uC: { value: fc }, uE: { value: fe }, uSeed: { value: R() * 50 }, uTime: U.uTime, uGrow: { value: 0 }, uRingFrom: { value: b.ringFrom || 0 }, uDone: { value: 0 }, uSunI: U.uSunI },
      vertexShader: flatVS, fragmentShader: flatFS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    const disc = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2), fmat); disc.frustumCulled = false; disc.renderOrder = 3;
    scene.add(mesh, disc);
    objs[b.id] = { b, mesh, disc, mat, fmat };
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
  corona.frustumCulled = false; corona.renderOrder = 4; scene.add(corona);
  // the flat Sun: a sea of fire unrolled into spirals
  const flatSunU = { uTime: U.uTime, uGrow: { value: 0 }, uDone: { value: 0 } };
  const flatSun = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: flatSunU, vertexShader: flatVS, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
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
  const planeU = { ...U };
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: planeU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `uniform vec2 uFoil; uniform float uR; varying vec3 vWp; void main(){ vec3 p = vec3(position.x * (uR * 2.3 + 2.) + uFoil.x, 0., position.z * (uR * 2.3 + 2.) + uFoil.y); vWp = p; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
    fragmentShader: /* glsl */`precision highp float; varying vec3 vWp; uniform vec2 uFoil; uniform float uR, uTime; uniform vec3 uSunPos; uniform float uSunI; ${GLSL_NOISE}
      void main(){
        vec2 q = vWp.xz - uFoil; float d = length(q), a = atan(q.y, q.x); if (d > uR * 1.12 + .5) discard;
        vec3 V = normalize(cameraPosition - vWp); float graz = pow(1. - abs(V.y), 4.);
        float inside = smoothstep(uR, uR - .4 - uR * .004, d);
        // a sheet with no thickness: almost nothing head-on, a cold glaze at grazing angles
        float film = (.5 + .5 * fbm(q * .06 + vec2(uTime * .01, 0.))) ;
        vec3 sheen = vec3(.05, .075, .12) * (.25 + 1.6 * graz) * film;
        // starlight that has already fallen in: faint radial smears
        float smear = pow(vnoise(vec2(a * 160., d * .05)), 9.) * .5 + pow(vnoise(vec2(a * 420. + 9., d * .02)), 14.) * .9;
        sheen += vec3(.5, .6, .8) * smear * (.08 + .5 * graz) * smoothstep(0., 30., d);
        // the edge: space pouring over a lip
        float w = .25 + uR * .006, lip = exp(-pow((d - uR) / w, 2.));
        float fallz = exp(-max(uR - d, 0.) / (2. + uR * .04)) * step(d, uR) * (.55 + .45 * vnoise(vec2(a * 90., d * .6 - uTime * 3.)));
        float outer = exp(-max(d - uR, 0.) / (1. + uR * .03)) * step(uR, d) * .35;
        vec3 edge = vec3(.75, .88, 1.) * (lip * 2.6 + fallz * .7 + outer);
        float alpha = inside * (.42 + .4 * graz);
        vec3 col = sheen * inside + edge;
        gl_FragColor = vec4(col, alpha);
      }`,
  }));
  plane.frustumCulled = false; plane.renderOrder = 1; scene.add(plane);

  // ---------- orbits, belts ----------
  const fallVS = (extra, pointSize) => /* glsl */`
    ${PLANE_GLSL} ${extra}
    varying float vFlat; varying vec3 vWp;
    void main(){ vec3 p = position; float y = fallY(p, 4.); vFlat = clamp(1. - abs(y) / max(abs(p.y), 1e-3), 0., 1.); p.y = y + 0.02; vWp = p;
      vec4 mv = viewMatrix * vec4(p, 1.); gl_Position = projectionMatrix * mv; ${pointSize} }`;
  for (const b of BODIES) {
    if (!b.a || b.moon) continue;
    const pts = []; for (let i = 0; i <= 360; i++) pts.push(new THREE.Vector3(...ecl(b.a, i)));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.ShaderMaterial({
      uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: fallVS('', ''), fragmentShader: `precision highp float; varying float vFlat; void main(){ gl_FragColor = vec4(mix(vec3(.16, .2, .3), vec3(.5, .62, .9), vFlat) * (.55 + .7 * vFlat), 1.); }`,
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

  // ---------- Earth's oceans freeze into snowflakes hundreds of kilometres across ----------
  const NS = Math.floor(420 * quality.density), E = B.earth;
  const flakeU = { uTime: U.uTime, uT0: { value: E.t0 + E.fall * 0.55 } };
  {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3)); g.setIndex([0, 2, 1, 0, 3, 2]);
    const a = new Float32Array(NS * 4), c = new Float32Array(NS * 4);
    for (let i = 0; i < NS; i++) {
      const ang = R() * 6.283, rad = E.Rf * (1.02 + 0.75 * Math.pow(R(), 1.6));
      a.set([E.p[0] + Math.cos(ang) * rad, E.p[2] + Math.sin(ang) * rad, 0.1 + 0.5 * Math.pow(R(), 2.2), R() * 6.283], i * 4);
      c.set([R(), R() * 5.5 + (rad / E.Rf - 1) * 5, R(), R()], i * 4);
    }
    g.setAttribute('aA', new THREE.InstancedBufferAttribute(a, 4)); g.setAttribute('aC', new THREE.InstancedBufferAttribute(c, 4)); g.instanceCount = NS;
    const flakes = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: flakeU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      vertexShader: `attribute vec4 aA, aC; uniform float uTime, uT0; varying vec2 vUv; varying float vG, vSeed;
        void main(){ float g = clamp((uTime - uT0 - aC.y) / 3.5, 0., 1.); g = 1. - pow(1. - g, 3.); float cs = cos(aA.w), sn = sin(aA.w);
          vec2 q = vec2(cs * position.x - sn * position.z, sn * position.x + cs * position.z) * aA.z * g;
          vUv = position.xz; vG = g; vSeed = aC.x; gl_Position = projectionMatrix * viewMatrix * vec4(aA.x + q.x, .03, aA.y + q.y, 1.); }`,
      fragmentShader: /* glsl */`precision highp float; varying vec2 vUv; varying float vG, vSeed; uniform float uTime;
        float seg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h); }
        void main(){
          float r = length(vUv); if (r > 1.) discard;
          float a = atan(vUv.y, vUv.x); a = mod(a, 1.0472); a = abs(a - .5236);          // six-fold, mirrored
          vec2 p = vec2(cos(a), sin(a)) * r;
          vec2 ax = vec2(cos(.5236), sin(.5236));                                        // arm direction in the folded wedge
          float d = seg(p, vec2(0.), ax * .95);
          for (int i = 1; i <= 4; i++) {                                                  // side branches, shorter toward the tip
            float t = float(i) * .2 + .02 * sin(vSeed * 40. + float(i)); vec2 o = ax * t; float len = (.34 - .06 * float(i)) * (.7 + .6 * fract(vSeed * 7.3 + float(i) * .37));
            d = min(d, seg(p, o, o + vec2(cos(.5236 - 1.047), sin(.5236 - 1.047)) * len));
          }
          d = min(d, abs(r - .16 - .1 * fract(vSeed * 3.1)) + .012);                     // hexagonal plate at the core
          float line = smoothstep(.03, .004, d) + .35 * smoothstep(.1, .0, d);
          float tw = .75 + .25 * sin(uTime * 2.3 + vSeed * 60.);
          gl_FragColor = vec4(vec3(.72, .9, 1.) * line * (1.3 + 1.2 * tw) * vG, 1.);
        }`,
    }));
    flakes.frustumCulled = false; flakes.renderOrder = 5; scene.add(flakes);
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

  // ---------- per-frame ----------
  const st = {};
  function update(t, env) {
    U.uTime.value = t; U.uPx.value = env.h / 1080; space.setViewport(env.h);
    const Rn = t < T.start ? 0 : Rof(t); U.uR.value = Rn;
    plane.visible = t > T.start;
    for (const b of BODIES) st[b.id] = bodyState(b, t);
    // the Sun
    const ss = st.sun; sunMesh.position.set(0, ss.y, 0); sunMesh.visible = ss.s < 1; sunMesh.rotation.y = t * 0.01;
    U.uSunPos.value.set(0, Math.max(ss.y, 0.5), 0); U.uSunI.value = 1 - 0.25 * ss.s;
    coronaU.uP.value.set(0, ss.y, 0); coronaU.uI.value = 1 - smooth(0.55, 1, ss.s);
    flatSun.position.set(0, 0.012, 0); flatSun.scale.setScalar(sunB.Rf); flatSunU.uGrow.value = ss.R / sunB.Rf; flatSunU.uDone.value = smooth(0.9, 1, ss.s) * smooth(0, 6, t - sunB.t0 - sunB.fall + 1); flatSun.visible = ss.s > 0;
    for (const id in objs) {
      const o = objs[id], s = st[id], b = o.b;
      o.mesh.position.set(b.p[0], s.y, b.p[2]); o.mesh.visible = s.s < 1 || !!b.ring && s.y + b.r * b.ring[1] > 0; o.mesh.rotation.y += 0;
      if (o.ring) o.ring.material.uniforms.uCen.value.set(b.p[0], s.y, b.p[2]);
      o.mat.uniforms.uCut.value = smooth(0, 0.04, s.s) * (1 - smooth(0.97, 1, s.s));
      o.disc.position.set(b.p[0], 0.01 + 0.002 * b.r, b.p[2]); o.disc.scale.setScalar(b.Rf); o.fmat.uniforms.uGrow.value = s.R / b.Rf; o.disc.visible = s.s > 0;
      o.fmat.uniforms.uDone.value = smooth(0.92, 1, s.s) * smooth(0, 5, t - b.t0 - b.fall + 1);
    }
    // the foil glides in, rests, goes dark; the plane starts where it lies
    const fp = foilPos(t); foil.position.set(fp[0], fp[1], fp[2]);
    foil.rotation.set(-1.25 + 0.5 * Math.sin(t * 0.21), t * 0.16, 0.3 * Math.sin(t * 0.13 + 1) * (1 - smooth(T.arrive - 2, T.arrive + 2, t)));
    foilU.uI.value = 1 - 0.985 * smooth(T.dim, T.start, t); foil.visible = t < T.start + 4;
    foilGlow.material.uniforms.uP.value.set(fp[0], fp[1], fp[2]); foilGlow.material.uniforms.uAspect.value = env.w / env.h; foilGlow.visible = foil.visible;
    const cam = env.camera; cam.near = clamp(cam.position.distanceTo(foil.position) * 0.2, 0.01, 0.5); cam.far = 20000;
    if (cam.position.y < 0.08 && Rn > 0) cam.position.y = 0.08;
  }

  function post(t, env) {
    const ss = st.sun || bodyState(sunB, t);
    return { exposure: 1.0, bloom: 0.3, bloomThreshold: 1.4, bloomKnee: 0.9, bloomRadius: 1.2, streak: 0.06, streakColor: [1.0, 0.8, 0.6],
      ca: 0.2, vignette: 0.5, grain: 0.032, saturation: 1.05, contrast: 1.04, tintLo: [0.95, 0.98, 1.07], tintHi: [1.04, 1.0, 0.96] };
  }

  // ---------- anchors ----------
  const at = (id, t) => { const b = B[id], s = bodyState(b, t); return [b.p[0], s.s >= 1 ? 0 : Math.max(s.y, 0), b.p[2]]; };
  const fz = (id, zh, en, k = 1) => ({ id, zh, en, get: t => { const b = B[id], s = bodyState(b, t); return { p: at(id, t), r: Math.max(b.r, s.R * 0.75) * k, dir: [0.55, 0.42, 0.72] }; } });
  const focus = [
    { id: 'foil', zh: '二向箔', en: 'The foil', get: t => ({ p: foilPos(Math.min(t, T.arrive + 1)), r: t < T.start ? 0.8 : Math.max(3, Rof(t) * 0.5), dir: [0.5, 0.35, 0.8] }) },
    fz('neptune', '海王星', 'Neptune'), fz('saturn', '土星', 'Saturn', 1.5), fz('earth', '地球', 'Earth'), fz('sun', '太阳', 'The Sun'), fz('jupiter', '木星', 'Jupiter'),
    { id: 'all', zh: '太阳系全景', en: 'Whole system', get: () => ({ p: [40, 6, 0], r: 150, dir: [0.35, 0.62, 0.7] }) },
  ];

  // ---------- director ----------
  const P = id => B[id].p;
  const orbitShot = (id, t, t0, dist, h, ang0, ang1, dur, fov = 34) => { const u = clamp((t - t0) / dur, 0, 1), a = lerp(ang0, ang1, easeInOut(u)), c = at(id, t), b = B[id], s = bodyState(b, t);
    const look = [c[0], lerp(c[1], 0, s.s), c[2]], k = 1 + 0.085 * s.R / b.r * (dist / (4 * b.r) < 1 ? 1.4 : 1), hh = h + s.R * 0.38;
    return { pos: [c[0] + Math.cos(a) * dist * k, Math.max(0.6, look[1] + hh), c[2] + Math.sin(a) * dist * k], look, fov }; };
  const SHOTS = [
    { a: 0, b: 6, cam: (u, t) => ({ pos: v3lerp([156, 128, 168], [160, 74, 124], easeInOut(u)), look: [34, 10, 0], fov: 32 }) },
    { a: 6, b: T.start + 2, cam: (u, t) => { const f = foilPos(t); return { pos: v3lerp([f[0] + 2.6, f[1] + 0.9, f[2] + 3.4], [FOIL_X + 1.3, 0.55, 2.2], easeInOut(u)), look: f, fov: 30 }; } },
    { a: T.start + 2, b: B.neptune.t0 - 1, cam: (u, t) => ({ pos: v3lerp([FOIL_X + 12, 5, 18], [FOIL_X + 34, 16, 40], easeInOut(u)), look: v3lerp([FOIL_X, 0, 0], [P('neptune')[0], 6, P('neptune')[2]], u), fov: 38 }) },
    { a: B.neptune.t0 - 1, b: B.neptune.t0 + 13, cam: (u, t) => orbitShot('neptune', t, B.neptune.t0 - 1, 15, 3.2, 2.1, 3.0, 14) },
    { a: B.neptune.t0 + 13, b: B.saturn.t0 - 1.5, cam: (u, t) => ({ pos: v3lerp([150, 22, 60], [128, 16, -2], easeInOut(u)), look: v3lerp([150, 0, 10], [P('saturn')[0], 8, P('saturn')[2]], easeInOut(u)), fov: 40 }) },
    { a: B.saturn.t0 - 1.5, b: B.saturn.t0 + 15, cam: (u, t) => orbitShot('saturn', t, B.saturn.t0 - 1.5, 34, 6, 3.5, 2.5, 16.5, 36) },
    { a: B.saturn.t0 + 15, b: B.earth.t0 - 2, cam: (u, t) => ({ pos: v3lerp([96, 30, 10], [50, 13, 34], easeInOut(u)), look: v3lerp([P('saturn')[0], 0, P('saturn')[2]], [P('earth')[0], 16, P('earth')[2]], easeInOut(u)), fov: 40 }) },
    { a: B.earth.t0 - 2, b: B.earth.t0 + 13, cam: (u, t) => orbitShot('earth', t, B.earth.t0 - 2, 11, 2.2, 2.9, 4.2, 15, 34) },
    { a: B.earth.t0 + 13, b: B.sun.t0 + 20, cam: (u, t) => ({ pos: v3lerp([52, 12, 40], [-40, 30, 64], easeInOut(u)), look: v3lerp([20, 14, 6], [0, 2, 0], easeInOut(u)), fov: 42 }) },
    { a: B.sun.t0 + 20, b: T.end + 1, cam: (u, t) => ({ pos: v3lerp([-40, 30, 64], [-230, 210, 250], easeInOut(u)), look: v3lerp([0, 2, 0], [40, 0, 0], u), fov: 40 }) },
  ];
  function director(t) { for (const s of SHOTS) if (t >= s.a && t < s.b) return s.cam((t - s.a) / (s.b - s.a), t); return SHOTS[SHOTS.length - 1].cam(1, t); }

  const moments = [
    { t: 0, id: 'calm', zh: '太阳系', en: 'The Solar System', textZh: '掩体纪元。人类躲在巨行星的背阳面，以为这样就能躲过光粒打击。', textEn: 'The Bunker Era. Humanity shelters behind the giant planets, believing it can survive a photoid strike.' },
    { t: 6, id: 'foil', zh: '一张小纸条', en: 'A slip of paper', textZh: '一片长方形的膜状物滑入太阳系，发出柔和的白光，像一张小纸条。它对周围没有任何作用力。', textEn: 'A small rectangular membrane glides into the system, glowing softly, like a slip of paper. It exerts no force on anything.' },
    { t: T.dim, id: 'dim', zh: '光熄灭了', en: 'The light goes out', textZh: '纸条的光暗了下去。包裹它的力场消失，二维空间与三维空间直接接触。', textEn: 'Its glow fades. The field that wrapped it is gone; two-dimensional space now touches three.' },
    { t: T.start, id: 'start', zh: '跌落', en: 'Collapse', textZh: '三维空间开始向二维跌落。一个没有厚度的平面向外扩张，越来越快。', textEn: 'Three-dimensional space begins to fall into two. A plane with no thickness spreads outward, faster and faster.' },
    { t: B.neptune.t0, id: 'neptune', zh: '海王星', en: 'Neptune', textZh: '海王星坠入平面，摊成一幅巨大的同心圆——每一层物质都被完整地展开。', textEn: 'Neptune drops into the plane and spreads into vast concentric rings — every layer of it laid open.' },
    { t: B.saturn.t0, id: 'saturn', zh: '土星', en: 'Saturn', textZh: '土星和它的光环一同二维化，像一张刚刚锯开的树桩。', textEn: 'Saturn and its rings flatten together, like the face of a freshly sawn tree.' },
    { t: B.earth.t0, id: 'earth', zh: '地球', en: 'Earth', textZh: '地球的一圈圈“年轮”铺开。二维的海洋凝结成直径数百公里的雪花，环绕着它。', textEn: 'Earth unrolls ring by ring. Its two-dimensional oceans freeze into snowflakes hundreds of kilometres across.' },
    { t: B.sun.t0, id: 'sun', zh: '太阳', en: 'The Sun', textZh: '太阳坠落。它在平面上铺成一片旋涡状的火海，像梵高的《星空》。', textEn: 'The Sun falls and unrolls into a swirling sea of fire — Van Gogh\'s Starry Night.' },
    { t: B.jupiter.t0, id: 'jupiter', zh: '木星', en: 'Jupiter', textZh: '木星背后的掩体城市没有任何意义。', textEn: 'The bunker cities in Jupiter\'s shadow mean nothing now.' },
    { t: 116, id: 'painting', zh: '一幅画', en: 'A painting', textZh: '整个太阳系成了一幅没有厚度的画。只有光速才能逃离。', textEn: 'The whole Solar System is now a painting with no thickness. Only lightspeed could have escaped it.' },
  ];

  // ---------- film ----------
  const F = (from, to, st0, st1, cam, ease) => ({ from, to, time: f => lerp(st0, st1, (ease || (x => x))((f - from) / (to - from))), cam });
  const N0 = B.neptune.t0, S0 = B.saturn.t0, E0 = B.earth.t0, U0 = B.sun.t0;
  const filmShots = [
    F(0, 11, 0.5, 7.6, (u, t) => ({ pos: v3lerp([156, 128, 168], [158, 72, 122], easeInOut(u)), look: v3lerp([26, 6, 0], [44, 12, -4], u), fov: 30 })),
    F(11, 17, 7.8, T.start + 3.2, (u, t) => { const f = foilPos(t); return { pos: v3lerp([f[0] + 2.1, f[1] + 0.8, f[2] + 2.9], [FOIL_X + 1.5, 0.5, 2.7], easeInOut(u)), look: v3lerp(f, [FOIL_X, 0, 0], u), fov: 28 }; }),
    F(17, 25, N0 - 1.5, N0 + 9.5, (u, t) => orbitShot('neptune', t, N0 - 1.5, 14.5, 3.0, 2.15, 2.95, 11, 34)),
    F(25, 33, S0 - 1.2, S0 + 12.5, (u, t) => orbitShot('saturn', t, S0 - 1.2, 33, 6.5, 3.5, 2.6, 13.7, 36)),
    F(33, 41, E0 - 1.4, E0 + 12.5, (u, t) => orbitShot('earth', t, E0 - 1.4, 10.5, 2.0, 2.9, 4.1, 13.9, 34)),
    F(41, 50, U0 + 2.5, U0 + 19, (u, t) => ({ pos: v3lerp([46, 9, 44], [58, 20, 62], easeInOut(u)), look: v3lerp([0, 13, 0], [0, 0, 0], smooth(0, 0.75, u)), fov: 42 })),
    F(50, 62, 108, 128, (u, t) => ({ pos: v3lerp([-70, 60, 110], [-250, 250, 290], easeOut(u, 2)), look: v3lerp([10, 0, 0], [50, 0, 0], u), fov: 40 })),
  ];
  const filmDef = {
    duration: 62, shots: filmShots,
    fade: ft => smooth(3.0, 5.6, ft) * (1 - 0.8 * smooth(54.4, 56, ft)) * (1 - smooth(60.8, 61.9, ft)),
    titles: [
      { from: 0.5, to: 4.6, kind: 'title', no: '03', zh: '二向箔', en: 'DIMENSIONAL STRIKE', sub: '太阳系二维化' },
      { from: 11.6, to: 16.2, kind: 'caption', zh: '一张小纸条', en: 'A slip of paper' },
      { from: 18.0, to: 23.0, kind: 'caption', zh: '海王星', en: 'Neptune' },
      { from: 26.0, to: 31.0, kind: 'caption', zh: '土星', en: 'Saturn' },
      { from: 34.0, to: 39.5, kind: 'caption', zh: '地球', en: 'Earth' },
      { from: 43.0, to: 48.0, kind: 'caption', zh: '太阳', en: 'The Sun' },
      { from: 55.2, to: 62, kind: 'end' },
    ],
  };

  return {
    id: 'foil', duration: T.end, scene, moments, focus, update, post, director, film: filmDef,
    resize: () => {},
    orbitLimits: f => (f === 'foil' ? { min: 0.6, max: 2500, minY: 0.1 } : { min: 1.5, max: 2500, minY: 0.1 }),
    debug: { B, bodyState, Rof, anchors: { zero: () => [0, 0, 0], foil: t => foilPos(t), ...Object.fromEntries(BODIES.map(b => [b.id, t => at(b.id, t)])) } },
  };
}
