// Gaillard Cut: terrain, jungle, sky, sun, water with planar reflection, the two pillars and the filaments.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smooth, rng, GLSL_NOISE } from '../../core/util.js';
import { WIRES, SHIP, SUN_DIR, shared, patchStd, SKY_GLSL, SKY_CLOUD_GLSL } from './common.js';

// ---------- deterministic JS noise (terrain is baked on the CPU so the sheets can drape over it) ----------
const h2 = (x, z) => { let n = (Math.imul(x | 0, 374761393) + Math.imul(z | 0, 668265263)) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
const vn = (x, z) => {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz, ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  return lerp(lerp(h2(ix, iz), h2(ix + 1, iz), ux), lerp(h2(ix, iz + 1), h2(ix + 1, iz + 1), ux), uz);
};
const fbm = (x, z, o = 5) => { let a = 0.5, s = 0; for (let i = 0; i < o; i++) { s += a * vn(x, z); x = x * 2.03 + 17.1; z = z * 2.03 + 9.7; a *= 0.5; } return s; };

export const canalCenter = x => { const d = Math.max(0, x - 170); return -0.0015 * d * d / (1 + d / 900); };
const HW = 76;                                           // half width of the water at the cut
export const bermWidth = (x, s) => s > 0 ? 26 + 130 * smooth(230, 400, x) * (1 - smooth(700, 900, x)) : 30;

export function terrainH(x, z) {
  const s = z - canalCenter(x), d = Math.abs(s);
  if (d < HW - 22) return -13;
  if (d < HW) return lerp(-13, -0.25, smooth(HW - 22, HW, d));
  const bw = bermWidth(x, s), n1 = fbm(x * 0.004 + 3, z * 0.004 + 8, 4), n2 = fbm(x * 0.02, z * 0.02, 4);
  let h = lerp(-0.25, 4.2, smooth(HW, HW + 15, d)) + (n2 - 0.5) * 0.5 * smooth(HW + 6, HW + 16, d);
  const e = d - (HW + 15 + bw);
  if (e > 0) {
    const env = s > 0 ? 62 + 62 * Math.exp(-(((x + 60) / 420) ** 2)) : 52 + 46 * Math.exp(-(((x - 120) / 380) ** 2));
    const Hm = env * (0.55 + 0.9 * n1) * (0.55 + 0.45 * smooth(2600, 900, Math.abs(x)));
    let hh = Hm * (1 - Math.exp(-e * 0.92 / Hm));
    // stepped excavation benches low on the slope, the hallmark of the cut
    const step = 13, tt = hh / step, fl = Math.floor(tt), fr = tt - fl;
    const terr = (fl + smooth(0.12, 0.62, fr)) * step, tw = (1 - smooth(34, 62, hh)) * smooth(1800, 700, Math.abs(x - 80));
    hh = lerp(hh, terr, tw * 0.85);
    h += hh + (n2 - 0.5) * 7 * smooth(0, 30, e) + (fbm(x * 0.07, z * 0.07, 3) - 0.5) * 1.6 * smooth(0, 10, e);
  }
  return h;
}

export const HEIGHT_RECT = { x0: -800, z0: -1024, size: 2048, res: 1024 };
export function bakeHeight() {
  const { x0, z0, size, res } = HEIGHT_RECT, data = new Uint16Array(res * res);
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) data[j * res + i] = THREE.DataUtils.toHalfFloat(terrainH(x0 + (i + 0.5) / res * size, z0 + (j + 0.5) / res * size));
  const t = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.HalfFloatType);
  t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
  return { tex: t, rect: new THREE.Vector4(x0, z0, 1 / size, 1 / size) };
}

// ---------- terrain ----------
const INNER = { x0: -600, x1: 800, z0: -420, z1: 420 };
const TERRAIN_SURFACE = /* glsl */`{
  vec3 N = normalize(vTN); float slope = 1. - N.y; vec2 q = vWp.xz; float y = vWp.y;
  float lodG = 1. - smoothstep(.12, .5, fwidth(q.x) + fwidth(q.y));
  float n1 = fbm(q * .035), n2 = fbm(q * .21 + 11.), n3 = mix(.5, vnoise(q * 1.7), lodG);
  vec3 strata = mix(vec3(.26, .20, .155), vec3(.38, .31, .24), smoothstep(.35, .65, vnoise(vec2(n1 * 3., y * .32 + n2 * 2.))));
  strata = mix(strata, vec3(.15, .135, .13), smoothstep(.6, .85, vnoise(q * .012 + 40.)) * .7);          // dark basalt
  vec3 rock = strata * (.7 + .5 * n3) * (.75 + .5 * vnoise(vec2(q.x * .6 + q.y * .6, y * 2.2)));
  vec3 soil = mix(vec3(.27, .14, .075), vec3(.36, .25, .15), n2);                                         // laterite
  float cell = vnoise(q * .13) * .6 + vnoise(q * .31 + 5.) * .4;                                          // canopy clumps
  vec3 jungle = mix(vec3(.016, .036, .012), vec3(.05, .085, .022), smoothstep(.25, .8, cell)) * (.8 + .4 * n3);
  vec3 gravel = vec3(.33, .30, .26) * (.75 + .4 * n3);
  float steep = smoothstep(.16, .34, slope + (n2 - .5) * .12);
  float veg = smoothstep(4.8, 6.6, y + n1 * 2.) * (1. - steep * .9);
  vec3 c = mix(soil, rock, steep);
  c = mix(c, jungle, veg);
  float berm = smoothstep(3.6, 4.0, y) * smoothstep(5.0, 4.6, y) * (1. - smoothstep(.02, .08, slope));
  c = mix(c, gravel, berm * .9);
  c = mix(c, vec3(.44, .42, .38), berm * lineAAt(abs(fract(vWp.z * .02) - .5) * 0., 1.) * 0.);
  float riprap = smoothstep(3.7, 2.9, y);
  float stones = mix(.5, vnoise(q * 1.9) * .6 + vnoise(q * 4.7) * .4, lodG);
  c = mix(c, vec3(.25, .24, .225) * (.45 + .9 * stones), riprap);
  c = mix(c, c * vec3(.28, .30, .27), smoothstep(.9, .05, y));                                            // wet band at the waterline
  c = mix(c, vec3(.04, .05, .035), smoothstep(-.1, -1.5, y));
  diffuseColor.rgb = c; gRough = mix(.95, .5, smoothstep(.9, .0, y));
  gBump = vec3(vnoise(q * .9) - .5, 0., vnoise(q * .9 + 31.) - .5) * (.5 * veg + .35 * riprap + .2) * lodG;
  if (uOuter > .5 && vWp.x > ${INNER.x0 + 4}. && vWp.x < ${INNER.x1 - 4}. && vWp.z > ${INNER.z0 + 4}. && vWp.z < ${INNER.z1 - 4}.) discard;
}`;
function terrainMesh(xs, zs, outer) {
  const NX = xs.length - 1, NZ = zs.length - 1, pos = new Float32Array((NX + 1) * (NZ + 1) * 3), nor = new Float32Array((NX + 1) * (NZ + 1) * 3), idx = [];
  let p = 0;
  for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
    const x = xs[i], z = zs[j], e = outer ? 6 : 1.5, h = terrainH(x, z);
    const nx = terrainH(x - e, z) - terrainH(x + e, z), nz = terrainH(x, z - e) - terrainH(x, z + e), l = Math.hypot(nx, 2 * e, nz);
    nor[p] = nx / l; nor[p + 1] = 2 * e / l; nor[p + 2] = nz / l;
    pos[p++] = x; pos[p++] = h; pos[p++] = z;
  }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setIndex(idx);
  const mat = patchStd(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 }), {
    key: 'terrain' + (outer ? 'O' : 'I'), uniforms: { uOuter: { value: outer ? 1 : 0 } },
    vertPars: 'varying vec3 vTN;', vertDeform: 'vec3 dP = position; vec3 dN = normal; vTN = normal;',
    fragPars: 'varying vec3 vTN; uniform float uOuter; float lineAAt(float a, float b){ return 0.; }', fragSurface: TERRAIN_SURFACE,
  });
  const m = new THREE.Mesh(g, mat); m.receiveShadow = !outer; m.castShadow = false; m.frustumCulled = false;
  return m;
}
function makeTerrain() {
  const lin = (a, b, n) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);
  const warp = (c, half, n, k) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n * 2 - 1; return c + Math.sign(u) * Math.pow(Math.abs(u), k) * half; });
  const g = new THREE.Group();
  g.add(terrainMesh(lin(INNER.x0, INNER.x1, 420), lin(INNER.z0, INNER.z1, 340), false));
  g.add(terrainMesh(warp(100, 9000, 240, 1.7), warp(0, 9000, 220, 1.7), true));
  return g;
}

function makeTrees(quality) {
  const R = rng(20070), count = Math.floor(34000 * quality.density);
  const g = mergeVertices(new THREE.IcosahedronGeometry(1, 1));
  const p = g.attributes.position, col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 0.8 + 0.4 * h2(Math.round(x * 40) + 7, Math.round(y * 53 + z * 31));
    p.setXYZ(i, x * k, y * k * 0.72 + 0.2, z * k);
    const ao = 0.4 + 0.6 * smooth(-0.6, 0.9, y); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = ao;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  const mat = patchStd(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true }), {
    key: 'tree',
    fragSurface: `{ float lodT = 1. - smoothstep(90., 380., length(vWp - cameraPosition));
      float n = vnoise3(vWp * .55) * .6 + mix(.5, vnoise3(vWp * 1.7 + 9.), lodT) * .4; diffuseColor.rgb *= .5 + 1.0 * mix(.5, n, .35 + .65 * lodT);
      gBump = (vec3(vnoise3(vWp * 1.1), vnoise3(vWp * 1.1 + 7.), vnoise3(vWp * 1.1 + 19.)) - .5) * 1.1 * lodT; gRough = .8; }`,
  });
  const mesh = new THREE.InstancedMesh(g, mat, count);
  const M = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 60) {
    const x = lerp(INNER.x0, INNER.x1, R()), side = R() < 0.5 ? -1 : 1, z = canalCenter(x) + side * (HW + 30 + Math.pow(R(), 1.35) * 380);
    if (z < INNER.z0 || z > INNER.z1) continue;
    const h = terrainH(x, z); if (h < 6.0) continue;
    const e = 2.5, sl = Math.hypot(terrainH(x + e, z) - terrainH(x - e, z), terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e);
    if (sl > 0.7 + 0.3 * R()) continue;
    const sz = 2.8 + 3.4 * R() * R() + (R() < 0.05 ? 3.5 : 0);
    v.set(x, h + sz * 0.75 + 1.5 + 3 * R(), z); q.setFromAxisAngle(up, R() * 6.28); s.set(sz * (0.9 + 0.45 * R()), sz * (0.85 + 0.6 * R()), sz * (0.9 + 0.45 * R()));
    M.compose(v, q, s); mesh.setMatrixAt(n, M);
    const t = R(); c.setRGB(lerp(0.04, 0.11, t) * (0.7 + 0.6 * R()), lerp(0.085, 0.17, t) * (0.75 + 0.5 * R()), lerp(0.022, 0.04, t));
    mesh.setColorAt(n, c); n++;
  }
  mesh.count = n; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  return mesh;
}

// ---------- sky dome ----------
function makeSky() {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSunDir: shared.uSunDir, uTime: shared.uTime, uDisc: { value: 1 } }, side: THREE.BackSide, depthWrite: false, depthTest: true,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * viewMatrix * vec4(position * 30000. + cameraPosition, 1.); gl_Position = p.xyww; }`,
    fragmentShader: `precision highp float; varying vec3 vDir; uniform vec3 uSunDir; uniform float uTime, uDisc;\n${GLSL_NOISE}\n${SKY_GLSL}\n${SKY_CLOUD_GLSL}
      void main(){ gl_FragColor = vec4(skyFull(normalize(vDir), uSunDir, uTime, uDisc), 1.); }`,
  });
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 4), mat); m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

// ---------- pillars + filaments ----------
function makePillars() {
  const g = new THREE.Group();
  const paint = patchStd(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.2 }), {
    key: 'pillar', fragSurface: `{ float b = step(.5, fract(vWp.y / 6.4)); diffuseColor.rgb = mix(vec3(.74,.73,.7), vec3(.5,.06,.04), b) * (.8 + .3 * vnoise(vWp.xy * 3.)); gRough = .5; }`,
  });
  const conc = patchStd(new THREE.MeshStandardMaterial({ color: 0x8d8a84, roughness: 0.9 }), { key: 'conc' });
  for (const sgn of [-1, 1]) {
    const z = sgn * WIRES.span;
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.8, 29.5, 14), paint); col.position.set(0, 13.75, z); col.castShadow = true;
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 3.1, 4, 16), conc); foot.position.set(0, -0.6, z); foot.castShadow = true; foot.receiveShadow = true;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.3, 14), conc); cap.position.set(0, 28.6, z);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(7, 1.2, 0.5) })); lamp.position.set(0, 29.4, z);
    // tension frame on the canal side that holds the fifty anchor points
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.25, 25.5, 0.25), conc); rail.position.set(0, 13, z - sgn * 0.95); rail.castShadow = true;
    g.add(col, foot, cap, lamp, rail);
  }
  return g;
}

function makeWires() {
  const SEG = 48, n = WIRES.n, pos = [], side = [], idx = [], wid = [];
  for (let w = 0; w < n; w++) for (let s = 0; s <= SEG; s++) for (const sd of [-1, 1]) {
    pos.push(0, WIRES.y0 + w * WIRES.h, lerp(-WIRES.span + 0.95, WIRES.span - 0.95, s / SEG)); side.push(sd); wid.push(w);
  }
  for (let w = 0; w < n; w++) for (let s = 0; s < SEG; s++) { const a = (w * (SEG + 1) + s) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1)); g.setAttribute('aWire', new THREE.Float32BufferAttribute(wid, 1));
  g.setIndex(idx);
  const uniforms = { ...shared, uRes: { value: new THREE.Vector2(1920, 1080) }, uShow: { value: 0 }, uVib: { value: 0 }, uVibTop: { value: 60 }, uWidth: { value: 4.2 }, uRise: { value: 1 }, uWet: { value: 0 } };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      attribute float aSide, aWire; uniform vec2 uRes; uniform float uTime, uVib, uVibTop, uWidth, uRise;
      varying vec3 vWp; varying float vWire; varying float vVib; varying float vFade; varying float vEdge;
      vec3 wirePos(vec3 p){
        float span = ${WIRES.span.toFixed(1)}, u = p.z / span;
        float env = (1. - u * u) * uVib * step(aWire, uVibTop);
        float ph = aWire * 1.7;
        p.x += env * (sin(uTime * 2.3 + ph) * .03 + sin(uTime * 3.7 + u * 9. + ph) * .015);     // a slow visible sway; the real ringing is far too fast to see
        p.y += env * sin(uTime * 2.9 + ph * 1.3 + u * 6.) * .008;
        // before the operation the filaments lie on the canal bed; uRise lifts them into place
        float sag = (1. - uRise); p.y = mix(p.y, -12.4 + aWire * .004, sag * (1. - pow(abs(u), 6.)));
        return p;
      }
      void main(){
        vec3 p = wirePos(position), p2 = wirePos(position + vec3(0., 0., .5));
        vec4 c = projectionMatrix * viewMatrix * vec4(p, 1.), c2 = projectionMatrix * viewMatrix * vec4(p2, 1.);
        vec2 d = normalize((c2.xy / c2.w - c.xy / c.w) * uRes + 1e-6);
        c.xy += vec2(-d.y, d.x) * aSide * uWidth / uRes * c.w;
        gl_Position = c; vWp = p; vWire = aWire; vVib = uVib * step(aWire, uVibTop); vEdge = aSide;
        // half a metre apart: once neighbours are closer than a few pixels the strings must fade, not fuse into a sheet
        float px = ${WIRES.h.toFixed(2)} * uRes.y * projectionMatrix[1][1] / (2. * max(c.w, 1e-3));
        vFade = pow(clamp(px / 3.5, 0., 1.), 1.6) * exp(-max(c.w - 110., 0.) / 80.);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir, uFogSun; uniform float uShow, uTime, uWet; varying vec3 vWp; varying float vWire; varying float vVib; varying float vFade; varying float vEdge;
      ${GLSL_NOISE}
      void main(){
        if (vWp.y < 0.02) discard;
        vec3 V = normalize(cameraPosition - vWp), H = normalize(V + uSunDir);
        float g = exp(-pow(H.z * 26., 2.));                               // a fibre only glints where the half-vector is square to it
        float lz = fwidth(vWp.z);                                         // metres of filament under one pixel: detail along it must fade before it can crawl
        float tw = mix(.03, pow(vnoise(vec2(vWp.z * 1.3 + uTime * .35, vWire * 3.)), 6.) * 1.5, 1. - smoothstep(.12, .4, lz * 1.3));
        float dist = length(cameraPosition - vWp);
        float base = .003 + .016 * exp(-dist / 45.);
        // fresh from the canal bed the filaments carry beads of water that catch the low sun
        float beads = mix(.06, pow(vnoise(vec2(vWp.z * 5. - uTime * .3, vWire * 7.)), 5.), 1. - smoothstep(.1, .35, lz * 5.)) * uWet;
        float gw = exp(-pow(H.z * 7., 2.));
        vec3 col = vec3(1., .8, .52) * (g * (1.0 + tw) + base * 2. * (1. + 2.5 * uWet) + beads * (.2 + 1.2 * gw)) + vec3(1., .82, .55) * vVib * (.05 + .3 * g);
        col = min(col, vec3(1.25));                                        // never brighter than the anti-aliasing can resolve
        col += vec3(.25, .8, 1.) * uShow * (.55 + .25 * sin(vWp.z * .6 - uTime * 4. + vWire));
        // a Gaussian 0.7 px wide (the ribbon is its 3-sigma support): narrow enough to read as a hair, wide enough that pixel centres sample it without beating
        gl_FragColor = vec4(col * vFade * exp(-vEdge * vEdge * 4.5) * .62, 1.);
      }`,
  });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 5;
  return { mesh: m, uniforms };
}

// ---------- water ----------
const WATER_VS = /* glsl */`
varying vec3 vWp; varying vec4 vRefl; uniform mat4 uReflMatrix;
void main(){ vec4 w = modelMatrix * vec4(position, 1.); vWp = w.xyz; vRefl = uReflMatrix * w; gl_Position = projectionMatrix * viewMatrix * w; }`;
const WATER_FS = /* glsl */`
precision highp float;
varying vec3 vWp; varying vec4 vRefl;
uniform sampler2D uRefl, uHeight; uniform vec4 uHeightRect; uniform vec3 uSunDir, uFogColor, uFogSun, uSunColor; uniform float uFogDensity, uTime;
uniform float uShipX, uWake, uBaseX; uniform vec4 uFan;          // fan: xFrom, xTo, zMid, intensity
uniform vec4 uSplash[4];                                          // x, z, radius, intensity
${GLSL_NOISE}
${SKY_GLSL}
float waveH(vec2 p, float t){
  float h = 0.;
  h += vnoise(p * .045 + vec2(t * .10, t * .03)) * 1.0;
  h += vnoise(p * .13 + vec2(-t * .12, t * .16)) * .42;
  h += vnoise(mat2(.8, -.6, .6, .8) * p * .41 + vec2(t * .35, -t * .22)) * .16;
  h += vnoise(mat2(.6, .8, -.8, .6) * p * 1.3 + vec2(-t * .7, t * .5)) * .05;
  return h;
}
float hb(float lx){ float p = 1.; if (lx > 60.) p = pow(max(0., 1. - pow(clamp((lx - 60.) / 57., 0., 1.), 2.3)), .56); if (lx < -76.) p = 1. - .45 * pow(clamp((-76. - lx) / 44., 0., 1.), 2.); return 17. * p * step(abs(lx), 120.); }
void main(){
  vec3 Vv = cameraPosition - vWp; float dist = length(Vv); vec3 V = Vv / dist;
  vec2 p = vWp.xz;
  float e = max(.12, dist * .004), amp = 1. / (1. + dist * .0016);
  float h0 = waveH(p, uTime), hx = waveH(p + vec2(e, 0.), uTime), hz = waveH(p + vec2(0., e), uTime);
  vec2 grad = vec2(hx - h0, hz - h0) / e;

  // --- wake: Kelvin arms from the bow, turbulent wash behind the stern ---
  float lx = p.x - uShipX, a = (uShipX + 118.) - p.x, b = abs(p.y);
  float foam = 0.;
  if (uWake > .001) {
    float arm = .34 * a + 9. * smoothstep(0., 60., a), wd = 1.6 + .035 * a;
    float r = exp(-pow((b - arm) / wd, 2.)) * smoothstep(-2., 10., a) * exp(-a / 300.) * uWake;
    grad += vec2(-.5, sign(p.y)) * (-(b - arm) / wd) * r * 1.3;
    foam += r * exp(-a / 70.) * smoothstep(.35, .7, vnoise(p * .9 + uTime * vec2(-1.2, 0.)));
    float inner = smoothstep(arm, arm * .5, b) * smoothstep(0., 40., a) * exp(-a / 240.) * uWake;
    grad.x += sin(a * .55 + b * .12) * .1 * inner;
    float edge = hb(lx); float bow = smoothstep(40., 118., lx);
    foam += smoothstep(2.2 + 2.5 * bow, 0., b - edge) * step(edge, b + .01) * (.35 + .9 * bow) * uWake * (.5 + .5 * vnoise(p * 1.4 - uTime * vec2(2., 0.))) * step(.5, edge);
    float a2 = (uShipX - 119.) - p.x;
    float wash = smoothstep(0., 8., a2) * exp(-a2 / 170.) * smoothstep(13. + .05 * a2, 4., b) * uWake;
    foam += wash * smoothstep(.3, .75, fbm(p * .22 + vec2(uTime * .6, 0.))) * 1.1;
    grad += (vec2(vnoise(p * .5 + uTime), vnoise(p * .5 + 31. - uTime)) - .5) * wash * 1.6;
  }
  // sheets ploughing into the water ahead of the hull
  if (uFan.w > .001) {
    vec2 fc = vec2((uFan.x + uFan.y) * .5, uFan.z), fh = vec2((uFan.y - uFan.x) * .5 + 26., 40.);
    float fe = length((p - fc) / fh) + (fbm(p * .035) - .5) * .7;
    float churn = smoothstep(1., .35, fe) * uFan.w;
    foam += churn * smoothstep(.42, .72, fbm(p * vec2(.3, .55) + vec2(uTime * .25, uTime * .1))) * (.5 + .5 * vnoise(p * 2.1));
    grad += (vec2(vnoise(p * .33 + uTime * .9), vnoise(p * .33 + 17. - uTime * .9)) - .5) * churn * 1.3;
  }
  for (int i = 0; i < 4; i++) {
    vec4 s = uSplash[i]; if (s.w < .001) continue;
    float d = length(p - s.xy), ring = exp(-pow((d - s.z) / (2.5 + s.z * .12), 2.));
    grad += normalize(p - s.xy + 1e-4) * ring * s.w * sin(d * 1.1 - s.z * 1.1) * 1.4;
    foam += s.w * (ring * .8 + smoothstep(s.z * .8, 0., d) * .9) * smoothstep(.25, .7, fbm(p * .5 + s.xy));
  }

  vec3 N = normalize(vec3(-grad.x * amp * 1.1, 1., -grad.y * amp * 1.1));
  float ndv = max(dot(N, V), 0.);
  float F = .02 + .98 * pow(1. - ndv, 5.);
  vec2 ruv = vRefl.xy / vRefl.w + N.xz * (.045 + .5 / (dist + 8.));
  vec3 refl = min(texture2D(uRefl, clamp(ruv, .001, .999)).rgb, vec3(7.));
  refl *= .75 + .5 * vnoise(p * 1.9 + uTime * vec2(.6, -.4));
  float depth = -texture2D(uHeight, (p - uHeightRect.xy) * uHeightRect.zw).r;
  vec3 body = mix(vec3(.085, .085, .04), vec3(.012, .04, .034), smoothstep(.2, 7., depth));
  float sunL = max(uSunDir.y, 0.) * 2.4 + .55;
  body *= sunL * (.8 + .5 * max(dot(N, uSunDir), 0.));
  vec3 col = mix(body, refl, F);
  vec3 H = normalize(uSunDir + V);
  col += uSunColor * pow(max(dot(N, H), 0.), 520.) * 16. * F;
  float shore = smoothstep(.55, .0, depth) * (.35 + .65 * vnoise(p * 1.1 + uTime * .3)) * .5;
  foam = clamp(foam + shore, 0., 1.);
  col = mix(col, vec3(.72, .70, .66) * (sunL * .5 + .25) * (uSunColor * .22 + .6), foam * .85);
  float hf = 1.;
  float ff = 1. - exp(-dist * uFogDensity * hf);
  vec3 fcol = skyBase(normalize(vec3(-V.x, .03, -V.z)), uSunDir) * .92;
  col = mix(col, fcol, clamp(ff, 0., 1.));
  gl_FragColor = vec4(col, 1.);
}`;

export function makeWorld({ renderer, quality, heightTex, heightRect }) {
  const scene = new THREE.Scene();
  const sky = makeSky(); scene.add(sky);
  // image-based ambient from the sky itself (sun disc excluded; the directional light carries it)
  const pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene(), sky2 = makeSky();
  sky2.material = sky.material.clone(); sky2.material.uniforms.uSunDir = shared.uSunDir; sky2.material.uniforms.uDisc = { value: 0 };
  sky2.material.vertexShader = `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * viewMatrix * vec4(position * 500., 1.); }`;
  envScene.add(sky2);
  const envRT = pm.fromScene(envScene, 0, 1, 2000); scene.environment = envRT.texture; scene.environmentIntensity = 1.25; pm.dispose();

  const sun = new THREE.DirectionalLight(new THREE.Color(1.0, 0.58, 0.30), 5.6);
  sun.castShadow = true; sun.shadow.mapSize.set(quality.shadow, quality.shadow);
  const sc = sun.shadow.camera; sc.left = -300; sc.right = 300; sc.top = 200; sc.bottom = -200; sc.near = 50; sc.far = 2800;
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.14; sun.shadow.radius = 1.6;
  scene.add(sun, sun.target);

  const terrain = makeTerrain(), trees = makeTrees(quality), pillars = makePillars(), wires = makeWires();
  scene.add(terrain, trees, pillars, wires.mesh);

  const reflRT = new THREE.WebGLRenderTarget(960, 540, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, samples: quality.msaa ? 2 : 0 });
  const wu = {
    ...shared, uRefl: { value: reflRT.texture }, uReflMatrix: { value: new THREE.Matrix4() }, uHeight: { value: heightTex }, uHeightRect: { value: heightRect },
    uSunColor: { value: new THREE.Color(1.0, 0.62, 0.33) }, uShipX: { value: -400 }, uWake: { value: 1 }, uBaseX: { value: 0 }, uFan: { value: new THREE.Vector4(0, 0, 0, 0) },
    uSplash: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
  };
  const water = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000, 1, 1).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ uniforms: wu, vertexShader: WATER_VS, fragmentShader: WATER_FS }));
  water.frustumCulled = false; water.position.x = 200;
  scene.add(water);

  // planar reflection (after three's Reflector, with a global clip plane instead of an oblique frustum)
  const vcam = new THREE.PerspectiveCamera(), clip = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.02)];
  const N = new THREE.Vector3(0, 1, 0), rp = new THREE.Vector3(), cp = new THREE.Vector3(), rot = new THREE.Matrix4(), look = new THREE.Vector3(), view = new THREE.Vector3(), tgt = new THREE.Vector3();
  const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
  function renderReflection(camera, hide) {
    cp.setFromMatrixPosition(camera.matrixWorld); rp.set(cp.x, 0, cp.z);
    view.subVectors(rp, cp).reflect(N).negate().add(rp);
    rot.extractRotation(camera.matrixWorld);
    look.set(0, 0, -1).applyMatrix4(rot).add(cp);
    tgt.subVectors(rp, look).reflect(N).negate().add(rp);
    vcam.position.copy(view); vcam.up.set(0, 1, 0).applyMatrix4(rot).reflect(N); vcam.lookAt(tgt);
    vcam.near = camera.near; vcam.far = camera.far; vcam.updateMatrixWorld(); vcam.projectionMatrix.copy(camera.projectionMatrix); vcam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    wu.uReflMatrix.value.copy(bias).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
    const vis = hide.map(o => o.visible); hide.forEach(o => { o.visible = false; });
    const prevClip = renderer.clippingPlanes;
    renderer.clippingPlanes = clip;
    renderer.setRenderTarget(reflRT); renderer.clear(); renderer.render(scene, vcam);
    renderer.clippingPlanes = prevClip;
    hide.forEach((o, i) => { o.visible = vis[i]; });
  }
  function resize(w, h) { reflRT.setSize(Math.max(64, Math.floor(w * quality.reflect)), Math.max(64, Math.floor(h * quality.reflect))); wires.uniforms.uRes.value.set(w, h); }

  return { scene, sky, sun, terrain, trees, pillars, wires, water, wu, renderReflection, resize, reflRT };
}
