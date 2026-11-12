// The witness. A harbour city at dusk on the last patch of three-dimensional Earth: the edge of the plane closes in
// from every horizon at once, and everything it passes sinks into the plane and is laid out flat. Units: metres.
// u is the city's own clock: 0 when the edge is RHO0 away, 1 when it reaches the terrace.
import * as THREE from 'three';
import { clamp, lerp, smooth, smoother, easeInOut, v3lerp, rng, GLSL_NOISE } from '../../core/util.js';
import { makeSpace } from '../../core/space.js';
import { FROST_GLSL } from './glsl.js';

export const CITY = { RHO0: 9000, P: 1, HILL_R: 340, HILL_H: 64, TER_R: 14, SHORE: 2250, WIN: 16, FIG: [0, 64, 11.7] };
const { RHO0, P, HILL_R, HILL_H, TER_R, SHORE, FIG } = CITY;
export const rhoAt = u => (u < 0 ? RHO0 * (1 - P * u) : RHO0 * Math.pow(Math.max(0, 1 - u), P));
const BL = 118;

const COMMON = /* glsl */`
${GLSL_NOISE}
uniform float uU, uWin, uAir, uPx; uniform vec3 uSunD;
const float RHO0 = ${RHO0.toFixed(1)}, PW = ${P.toFixed(3)}, SHORE = ${SHORE.toFixed(1)};
// seconds since the edge passed a point d metres from the terrace (negative: it has not arrived)
float ageAt(float d){ float x = d / RHO0; float ud = x < 1. ? 1. - pow(x, 1. / PW) : -(x - 1.) / PW; return (uU - ud) * uWin; }
float rhoNow(){ return uU < 0. ? RHO0 * (1. - PW * uU) : RHO0 * pow(max(1. - uU, 0.), PW); }
// dusk: orange only where the Sun is going down, blue-violet everywhere else
vec3 skyCol(vec3 d){
  float h = max(d.y, 0.), mu = max(dot(d, uSunD), 0.), az = max(dot(normalize(d.xz + 1e-5), normalize(uSunD.xz)), 0.);
  vec3 c = mix(mix(vec3(.11, .14, .25), vec3(.95, .46, .19), az * az * az), vec3(.012, .03, .1), pow(h, .36));
  c += vec3(1., .42, .16) * exp(-h * 14.) * az * az * .3;
  c += vec3(1., .6, .3) * pow(mu, 60.) * .3 + vec3(1., .8, .55) * pow(mu, 900.) * .8;
  return c * uAir * .8;
}
`;
const FCOMMON = COMMON + /* glsl */`
// a line that never gets thinner than a pixel, and dims instead
float lineAA(float d, float w){ float ww = max(w, fwidth(d) * 1.1); return smoothstep(ww, ww * .3, abs(d)) * sqrt(min(1., w / ww)); }`;

export function makeCity({ quality, film }) {
  const scene = new THREE.Scene();
  const space = makeSpace({ stars: 7000, seed: 23, galaxyTilt: [0.5, 0.42, 0.75], milky: 1.1 });
  scene.add(space.group);
  const sunD = new THREE.Vector3(0.1, 0.034, 1).normalize();
  const U = { uU: { value: -1 }, uWin: { value: CITY.WIN }, uAir: { value: 1 }, uPx: { value: 1 }, uSunD: { value: sunD }, uTime: { value: 0 } };
  const R = rng(77);

  // ---------- sky ----------
  const sky = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,       // opaque pass, added over the stars and under everything else
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * viewMatrix * vec4(position * 1000. + cameraPosition, 1.); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`precision highp float; varying vec3 vDir; ${FCOMMON}
      void main(){
        vec3 d = normalize(vDir); vec3 c = skyCol(d);
        vec2 cp = d.xz / (abs(d.y) + .14) * 1.3; float cl = smoothstep(.5, .82, fbm(cp * vec2(.55, 1.6) + 3.)) * smoothstep(.015, .22, d.y);
        float toSun = pow(max(dot(normalize(d.xz), normalize(uSunD.xz)), 0.), 3.);
        c += (vec3(.1, .1, .16) + vec3(1., .42, .24) * toSun) * cl * .5 * uAir;
        c += vec3(1., .66, .36) * smoothstep(.99990, .99996, dot(d, uSunD)) * 9. * step(0., d.y);       // the Sun itself needs no air
        gl_FragColor = vec4(c, 1.);
      }`,
  }));
  sky.frustumCulled = false; sky.renderOrder = -15; scene.add(sky);

  // ---------- the city plan ----------
  const lots = [];                                      // x, z, rot, seed, w, h, d, kind (0 tower, 1 house, 2 ship, 3 pier)
  const core = (x, z) => Math.exp(-(((x - 1060) / 470) ** 2 + ((z - 1400) / 520) ** 2)) + 0.85 * Math.exp(-(((x + 1000) / 450) ** 2 + ((z - 1500) / 440) ** 2));      // two clusters, and between them a view of the bay
  for (let gx = -17; gx <= 17; gx++) for (let gz = 0; gz <= 13; gz++) {
    const bx = gx * BL, bz = 560 + gz * BL;
    if (R() < 0.08) continue;                                                              // a square, a park
    for (const [ox, oz] of [[-27, -27], [27, -27], [-27, 27], [27, 27]]) {
      const x = bx + ox, z = bz + oz;
      if (Math.abs(x) < 64 || z > SHORE - 90 || Math.hypot(x, z) < HILL_R + 60 || R() < 0.12) continue;
      const c = core(x, z), tall = Math.pow(R(), 2.2), w = 30 + R() * 16, d = 30 + R() * 16;
      const h = 12 + 46 * R() * (0.3 + c) + 330 * Math.pow(c, 1.6) * tall;
      lots.push([x + (R() - 0.5) * 6, z + (R() - 0.5) * 6, 0, R(), w, h, d, 0]);
    }
  }
  for (let i = 0; i < 3000; i++) {                      // low houses in every other direction: the edge comes from all sides
    const a = R() * Math.PI * 2, r = HILL_R + 50 + Math.pow(R(), 0.7) * 3600;
    let x = Math.cos(a) * r, z = Math.sin(a) * r;
    x = (Math.round(x / 36 - 0.5) + 0.5) * 36 + (R() - 0.5) * 5; z = (Math.round(z / 36 - 0.5) + 0.5) * 36 + (R() - 0.5) * 5;
    if ((z > 480 && Math.abs(x) < 2100) || z > SHORE - 90 || Math.hypot(x, z) < HILL_R + 40 || Math.abs(x) < 34) continue;
    lots.push([x, z, 0, R(), 13 + R() * 12, 6 + R() * R() * 24, 13 + R() * 12, 1]);
  }
  for (let i = 0; i < 9; i++) { const x = -1750 + i * 430 + (R() - 0.5) * 60; if (Math.abs(x) < 150) continue; lots.push([x, SHORE + 130, 0, R(), 14, 2.2, 300, 3]); }
  for (let i = 0; i < 18; i++) { const x = (R() - 0.5) * 5200; lots.push([x + Math.sign(x) * 520, SHORE + 260 + R() * R() * 2600, R() * 3.1, R(), 16 + R() * 14, 9 + R() * 8, 70 + R() * 150, 2]); }
  const NB = lots.length;
  const iA = new Float32Array(NB * 4), iS = new Float32Array(NB * 4);
  lots.forEach((l, i) => { iA.set([l[0], l[1], l[2], l[3]], i * 4); iS.set([l[4], l[5], l[6], l[7]], i * 4); });
  const inst = g => { g.setAttribute('iA', new THREE.InstancedBufferAttribute(iA, 4)); g.setAttribute('iS', new THREE.InstancedBufferAttribute(iS, 4)); g.instanceCount = NB; return g; };

  const bg = inst(new THREE.InstancedBufferGeometry().copy(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)));
  const bldg = new THREE.Mesh(bg, new THREE.ShaderMaterial({
    uniforms: U,
    vertexShader: /* glsl */`
      ${COMMON}
      attribute vec4 iA, iS; varying vec3 vWp, vN, vL, vNl; varying vec4 vS; varying float vSeed, vSink;
      void main(){
        float age = ageAt(length(iA.xy)), dur = .9 + iS.y / 200.;
        float sink = clamp(age / dur, 0., 1.); sink = sink * sink * (3. - 2. * sink);
        vec3 p = position * iS.xyz;
        p.xz *= 1. - position.y * .3 * step(.55, fract(iA.w * 3.7)) * step(60., iS.y);          // some of the tall ones taper
        float c = cos(iA.z), s = sin(iA.z);
        vec3 w = vec3(c * p.x + s * p.z + iA.x, p.y - (iS.y + .5) * sink, -s * p.x + c * p.z + iA.y);
        vN = vec3(c * normal.x + s * normal.z, normal.y, -s * normal.x + c * normal.z); vNl = normal; vL = position * iS.xyz; vWp = w; vS = iS; vSeed = iA.w;
        vSink = sink * (1. - sink) * 4.;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
      }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec3 vWp, vN, vL, vNl; varying vec4 vS; varying float vSeed, vSink;
      ${FCOMMON}
      void main(){
        if (vWp.y < 0.) discard;
        vec3 N = normalize(vN), V = normalize(cameraPosition - vWp); float dist = length(cameraPosition - vWp);
        float tower = step(vS.w, .5), glassy = tower * step(.35, vSeed);
        vec3 base = mix(vec3(.13, .12, .11), vec3(.03, .04, .055), glassy);
        vec3 amb = skyCol(normalize(vec3(N.x, .3 + .7 * max(N.y, 0.), N.z))) * .6 + .004 + vec3(.3, .2, .1) * .02 * (1. - uAir);
        vec3 col = base * (amb + vec3(1., .5, .24) * 2.4 * max(dot(N, uSunD), 0.));
        if (abs(N.y) < .5) {
          float al = abs(vNl.x) > .5 ? vL.z : vL.x;
          vec2 cell = mix(vec2(2.8, 3.1), vec2(3.3, 3.7), tower), wc = vec2(al, vL.y) / cell, id = floor(wc), f = fract(wc);
          float thr = .7 + .18 * step(.75, fract(vSeed * 7.3));
          float lit = step(thr, hash12(id + vSeed * 91.)) * step(.3, hash11(id.y * 3.1 + vSeed * 17.)) * step(.9, wc.y);
          float pane = smoothstep(.07, .12, f.x) * smoothstep(.93, .88, f.x) * smoothstep(.22, .28, f.y) * smoothstep(.84, .78, f.y) * (1. - .7 * smoothstep(.035, .015, abs(f.x - .5)));
          float lod = 1. - smoothstep(.3, .85, max(fwidth(wc.x), fwidth(wc.y)));
          vec3 warm = mix(vec3(1., .7, .38), vec3(.74, .86, 1.), step(.8, hash11(id.y * 1.7 + vSeed * 13.)));
          col += warm * mix((1. - thr) * .32, lit * pane * (.5 + .9 * hash12(id * 1.3 + 5.)), lod) * 1.5;
          float fr = pow(1. - max(dot(N, V), 0.), 4.);
          col += skyCol(reflect(-V, N)) * (.05 + .6 * fr) * mix(.2, 1., glassy) * mix(.6, pane * (1. - lit) + .15, lod);       // glass
          col *= 1. - .35 * smoothstep(.06, .0, f.y) * lod;                                                              // floor slabs
        } else col += vec3(1., .2, .1) * step(.994, hash12(floor(vL.xz / 3.) + vSeed)) * tower * 2.;                      // roof beacons
        col += vec3(1., .86, .6) * exp(-vWp.y / 2.2) * vSink * 3.;                                    // where it meets the plane
        col = mix(col, skyCol(-V), (1. - exp(-dist / 12000.)) * .8);
        gl_FragColor = vec4(col, 1.);
      }`,
  }));
  bldg.frustumCulled = false; scene.add(bldg);

  // flat images of the buildings: floor after floor laid out as nested rectangles, every lit window kept
  const qg = new THREE.InstancedBufferGeometry(); qg.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3)); qg.setIndex([0, 2, 1, 0, 3, 2]); inst(qg);
  const plans = new THREE.Mesh(qg, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      ${COMMON}
      attribute vec4 iA, iS; varying vec2 vUv; varying float vG, vSeed, vM0, vFl, vKind;
      void main(){
        float age = ageAt(length(iA.xy));
        float g = clamp((age - .1) / (1.6 + iS.y / 120.), 0., 1.); g = 1. - pow(1. - g, 2.4);
        float K = min(1.5 + iS.y / 80., 4.4); vec2 halfK = iS.xz * .5 * K;
        float c = cos(iA.z), s = sin(iA.z); vec2 q = position.xz * halfK;
        vUv = position.xz; vG = g * step(0., age); vSeed = iA.w; vM0 = 1. / K; vFl = clamp(floor(iS.y / 7.), 2., 26.); vKind = iS.w;
        gl_Position = projectionMatrix * viewMatrix * vec4(c * q.x + s * q.y + iA.x, .05, -s * q.x + c * q.y + iA.y, 1.);
      }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv; varying float vG, vSeed, vM0, vFl, vKind;
      ${FCOMMON}
      void main(){
        if (vG <= 0.) discard;
        vec2 a = abs(vUv); float m = max(a.x, a.y), reach = mix(vM0, 1., vG);
        if (m > reach) discard;
        float side = a.x > a.y ? (vUv.x > 0. ? 0. : 1.) : (vUv.y > 0. ? 2. : 3.), along = a.x > a.y ? vUv.y / a.x : vUv.x / a.y;
        vec3 line = mix(vec3(1., .8, .52), vec3(.66, .82, 1.), step(.8, fract(vSeed * 5.7)));
        float pm = fwidth(m);
        vec3 col = line * (lineAA(m - vM0, .012) * 1.2 + lineAA(m - reach + pm, .008) * .9);              // the footprint and the outer edge always read
        if (m < vM0) {                                                                    // the footprint: core and column grid
          vec2 g = vUv / vM0 * 3., fg = abs(fract(g) - .5);
          col += line * (.06 + .4 * lineAA(max(fg.x, fg.y) - .5, .03) + .3 * step(max(a.x, a.y), vM0 * .3));
        } else {
          float rr = (m - vM0) / (1. - vM0), ring = rr * vFl, k = floor(ring), fr = fract(ring), nc = 3. + floor(k * .8);
          float cc = (along * .5 + .5) * nc, cid = floor(cc), cf = fract(cc);
          float lodR = 1. - smoothstep(.25, .7, fwidth(ring)), lodC = 1. - smoothstep(.2, .6, fwidth(cc));
          float ln = max(lineAA(min(fr, 1. - fr), .045) * lodR, .45 * lineAA(min(cf, 1. - cf), .03) * lodC * lodR);
          float lit = step(.6, hash12(vec2(k * 7. + side, cid) + vSeed * 53.));
          vec3 warm = mix(vec3(1., .66, .3), vec3(.6, .8, 1.), step(.8, hash11(k * 1.7 + vSeed * 13.)));
          col += line * ln * .9 + warm * mix(.025, lit * .5, lodR * lodC) + vec3(.02, .017, .013);
        }
        col += vec3(1., .9, .7) * smoothstep(reach - .08, reach, m) * (1. - vG) * 1.4;
        gl_FragColor = vec4(col * (.5 + .5 * vM0 * 2.), 1.);
      }`,
  }));
  plans.frustumCulled = false; plans.renderOrder = 2; scene.add(plans);

  // ---------- ground and sea: one sheet ----------
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90000, 90000).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: U, depthWrite: false,
    vertexShader: `varying vec3 vWp; void main(){ vWp = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec3 vWp; uniform float uTime;
      ${FCOMMON} ${FROST_GLSL}
      float hillH(float r){ float k = 1. - smoothstep(${(TER_R + 3).toFixed(1)}, ${HILL_R.toFixed(1)}, r); return ${HILL_H.toFixed(1)} * k * sqrt(k); }
      void main(){
        vec2 p = vWp.xz; float d = length(p), rho = rhoNow(), age = ageAt(d), flat2 = smoothstep(0., .5, age);
        vec3 V = normalize(cameraPosition - vWp); float dist = length(cameraPosition - vWp), graz = pow(1. - abs(V.y), 4.);
        float shoreD = p.y - SHORE - 18. * (vnoise(vec2(p.x * .004, 3.)) - .5), sea = smoothstep(-3., 3., shoreD);
        // --- streets ---
        vec2 fb = (fract(p / ${BL.toFixed(1)}) - .5) * ${BL.toFixed(1)}; float downtown = step(480., p.y) * step(abs(p.x), 2100.) * step(${(HILL_R + 30).toFixed(1)}, d);
        vec2 f2 = (fract(p / 36.) - .5) * 36.; float suburb = (1. - step(480., p.y) * step(abs(p.x), 2100.)) * step(${(HILL_R + 20).toFixed(1)}, d);
        float rdist = min(abs(fb.x), abs(fb.y)), ldist = min(abs(f2.x), abs(f2.y));
        float asphalt = (1. - smoothstep(6.5, 8., rdist)) * downtown + (1. - smoothstep(2.5, 3.5, ldist)) * suburb * .6;
        float avenue = (1. - smoothstep(26., 30., abs(p.x))) * step(${HILL_R.toFixed(1)}, d) * step(0., p.y);
        float lamp = (exp(-pow((fract(p.x / 29.) - .5) * 29. / 2.2, 2.)) * step(abs(fb.y), 8.) + exp(-pow((fract(p.y / 29.) - .5) * 29. / 2.2, 2.)) * step(abs(fb.x), 8.)) * downtown
                   + exp(-pow((fract(p.y / 24.) - .5) * 24. / 2., 2.)) * exp(-pow((abs(p.x) - 24.) / 2., 2.)) * avenue;
        float lodL = 1. - smoothstep(.12, .5, fwidth(p.x) / 29.);
        vec3 lamps = vec3(1., .62, .26) * (lamp * lodL * 1.6 + .1 * (1. - lodL) * max(asphalt * downtown, avenue * .5));
        vec3 skyUp = skyCol(vec3(0., 1., 0.)) + skyCol(normalize(vec3(uSunD.x, .25, uSunD.z))) * .25;
        vec3 land3 = (vec3(.05, .055, .05) + vec3(.07, .068, .066) * max(asphalt, avenue)) * skyUp * 2. + .003 + lamps;
        // flat land: the street plan as a drawing of light
        float kerbs = lineAA(rdist - 7., .5) * downtown + lineAA(ldist - 3., .4) * suburb * .7 + (lineAA(abs(p.x) - 28., .6) + .5 * lineAA(abs(p.x) - 1.2, .4) * step(.5, fract(p.y / 18.))) * avenue;
        vec3 land2 = vec3(.004, .005, .007) + vec3(1., .8, .52) * kerbs * .55 + lamps * .8;
        // the hill, laid flat, is its own contour map
        float hh = hillH(d); land2 += vec3(.62, .86, .66) * lineAA((fract(hh / 4.) - .5) * 4. / max(length(vec2(dFdx(hh), dFdy(hh))) / max(fwidth(d), 1e-4), .05), .35) * .55 * step(.4, hh) * step(d, ${HILL_R.toFixed(1)});
        land2 += vec3(1., .85, .6) * lineAA(shoreD, 1.2) * .5;                                       // the old shoreline, kept as a line
        vec3 land = mix(land3, land2, flat2);
        // --- sea ---
        vec2 wp = p * vec2(.09, .05); float t = uTime * .35;
        vec2 wn = vec2(fbm(wp + vec2(t, 0.)) - fbm(wp + vec2(.6, .3) + vec2(0., t)), fbm(wp * 2.3 - vec2(t * .7, 0.)) - fbm(wp * 2.3 + vec2(.5, .8)));
        float rough = clamp(dist / 3000., 0., 1.);
        vec3 Nw = normalize(vec3(wn.x * mix(.22, .04, rough), 1., wn.y * mix(.22, .04, rough)));
        vec3 Rv = reflect(-V, Nw); Rv.y = abs(Rv.y);
        float fres = .03 + .97 * pow(1. - max(dot(V, Nw), 0.), 5.);
        vec3 sea3 = mix(vec3(.004, .012, .022) * (.3 + uAir), skyCol(Rv), fres);
        sea3 += vec3(1., .6, .28) * pow(max(dot(Rv, uSunD), 0.), mix(320., 110., rough)) * mix(3., 1.4, rough) * uAir;          // sun glitter
        // 2D water freezes at once: crystals at three scales, so it reads from the rail and from orbit
        float pxw = length(fwidth(p)), lod1 = 1. - smoothstep(.02, .09, fwidth(p.x) / 60.);
        vec2 f1 = vec2(0.), fm = f1, fl = f1;
        if (flat2 * sea > 0.) { if (lod1 > 0.) f1 = frost(p / 60., rho / 60., .45, pxw / 60.); fm = frost(p / 210. + 7.3, rho / 210., .9, pxw / 210.); fl = frost(p / 760. + 3.1, rho / 760., 1.6, pxw / 760.); }
        float ice = max(fl.y, max(fm.y * .8, f1.y * .6 * lod1));
        vec3 sea2 = vec3(.003, .008, .015) + vec3(.05, .11, .2) * ice + vec3(.74, .9, 1.) * (f1.x * .4 * lod1 + fm.x * .3 + fl.x * .36);
        sea2 += vec3(.8, .92, 1.) * pow(vnoise(p * .9), 14.) * f1.y * lod1 * 2.;
        vec3 water = mix(sea3, sea2, flat2);
        vec3 col = mix(land, water, sea);
        col += (skyCol(reflect(-V, vec3(0., 1., 0.))) * .22 + vec3(.01, .014, .022)) * graz * flat2;       // a sheet with no thickness: a cold glaze at grazing angles
        // the edge itself
        float w = 1.5 + rho * .002 + dist * .0015, lip = exp(-pow((d - rho) / w, 2.));
        float wake = exp(-max(d - rho, 0.) / (12. + rho * .02)) * step(rho, d);
        col += vec3(.85, .93, 1.) * (lip * 2.4 + wake * .16) * smoothstep(0., 90., rho);
        col = mix(col, skyCol(-V), (1. - exp(-dist / 12000.)) * .8 * (1. - flat2 * .5));
        gl_FragColor = vec4(col, 1.);
      }`,
  }));
  ground.frustumCulled = false; ground.renderOrder = -5; scene.add(ground);

  // ---------- the hill and its terrace ----------
  const hillH = r => { const k = 1 - smooth(TER_R + 3, HILL_R, r); return HILL_H * k * Math.sqrt(k); };
  {
    const NRr = 90, NA = 128, pos = [], idx = [];
    for (let i = 0; i <= NRr; i++) { const r = Math.pow(i / NRr, 1.25) * (HILL_R + 20); for (let j = 0; j <= NA; j++) { const a = j / NA * Math.PI * 2; pos.push(Math.cos(a) * r, hillH(r) - 0.6, Math.sin(a) * r); } }
    for (let i = 0; i < NRr; i++) for (let j = 0; j < NA; j++) { const a = i * (NA + 1) + j, b = a + NA + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
    const hill = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: U, side: THREE.DoubleSide,
      vertexShader: `${COMMON} varying vec3 vWp, vP0; varying float vSink;
        void main(){ float age = ageAt(length(position.xz)); float s = clamp(age / 1.3, 0., 1.); s = s * s * (3. - 2. * s);
          vec3 p = position; p.y -= (p.y + 2.) * s; vP0 = position; vWp = p; vSink = s; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
      fragmentShader: /* glsl */`precision highp float; varying vec3 vWp, vP0; varying float vSink; ${FCOMMON}
        void main(){
          if (vWp.y < 0.) discard;
          vec3 N = normalize(cross(dFdx(vWp), dFdy(vWp))); if (N.y < 0.) N = -N;
          float n = fbm(vP0.xz * .05), trees = smoothstep(.45, .6, fbm(vP0.xz * .16 + 4.));
          vec3 alb = mix(vec3(.06, .085, .05), vec3(.022, .04, .026), trees) * (.7 + .6 * n);
          float r = length(vP0.xz), th = atan(vP0.z, vP0.x), pd = (fract(r / 46. + th / 6.2832) - .5) * 46.;
          float path = (1. - smoothstep(1.2, 2.2, abs(pd))) * step(${(TER_R + 2).toFixed(1)}, r);
          alb = mix(alb, vec3(.11, .105, .1), path);
          vec3 col = alb * (skyCol(normalize(vec3(N.x, .5 + .5 * N.y, N.z))) * .9 + .004 + vec3(1., .5, .24) * 2. * max(dot(N, uSunD), 0.));
          col += vec3(1., .66, .3) * path * exp(-pow((fract(r * th / 22.) - .5) * 22. / 1.4, 2.)) * .8;      // lamps along the path
          float cut = smoothstep(.75, .3, N.y) * step(.02, vSink);                                    // the cliff the edge leaves as it eats the hill
          col = mix(col, vec3(1., .82, .55) * 2.2, cut);
          col += vec3(1., .86, .6) * exp(-vWp.y / 1.5) * step(.02, vSink) * 2.;
          gl_FragColor = vec4(col, 1.);
        }`,
    }));
    hill.frustumCulled = false; scene.add(hill);
  }

  // props that stand on the terrace all go at the very end, together
  const LAMPS = [[-9.5, 2], [9.5, 3], [0, -11.5]];
  const propU = { ...U, uSink: { value: 0 }, uLamp: { value: LAMPS.map(l => new THREE.Vector3(l[0], HILL_H + 3.7, l[1])) } };
  const propMat = (col, em = [0, 0, 0]) => new THREE.ShaderMaterial({
    uniforms: { ...propU, uCol: { value: new THREE.Color(...col) }, uEm: { value: new THREE.Color(...em) } },
    vertexShader: `uniform float uSink; varying vec3 vWp, vN; void main(){ vec4 w = modelMatrix * vec4(position, 1.); w.y -= uSink; vWp = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`precision highp float; varying vec3 vWp, vN; uniform vec3 uCol, uEm; uniform float uSink; uniform vec3 uLamp[3]; ${FCOMMON}
      void main(){ if (vWp.y < 0.) discard; vec3 N = normalize(vN), V = normalize(cameraPosition - vWp);
        vec3 amb = skyCol(normalize(vec3(N.x, .4 + .6 * max(N.y, 0.), N.z))) * .7 + .006 + vec3(.5, .36, .2) * .1 * (1. - uAir) * (.5 - .5 * N.y);      // when the air is gone, the flat world below still glows
        vec3 col = uCol * (amb + vec3(1., .52, .26) * 2.2 * max(dot(N, uSunD), 0.));
        col += (skyCol(normalize(vec3(-V.x, .1, -V.z))) * .35 + vec3(.5, .34, .2) * .03) * pow(1. - max(dot(N, V), 0.), 2.6);
        for (int i = 0; i < 3; i++) { vec3 L = uLamp[i] - vec3(0., uSink, 0.) - vWp; float d2 = dot(L, L); col += uCol * vec3(1., .84, .62) * (max(dot(N, L * inversesqrt(d2)), 0.) * .8 + .2) * 30. / (4. + d2); }
        col += uEm + vec3(1., .86, .6) * exp(-vWp.y / .5) * step(.05, uSink) * 2.5;
        gl_FragColor = vec4(col, 1.); }`,
  });
  const props = new THREE.Group(); scene.add(props);
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); m.frustumCulled = false; props.add(m); return m; };
  const stone = propMat([0.36, 0.35, 0.34]), metal = propMat([0.06, 0.06, 0.065]), coat = propMat([0.2, 0.17, 0.15]), dark = propMat([0.035, 0.035, 0.045]), skin = propMat([0.5, 0.36, 0.27]), hairM = propMat([0.02, 0.016, 0.014]);
  add(new THREE.CylinderGeometry(TER_R, TER_R + 1.5, 3, 64), stone, 0, HILL_H - 1.5, 0);
  add(new THREE.TorusGeometry(TER_R - 0.5, 0.035, 8, 160), metal, 0, HILL_H + 1.08, 0, Math.PI / 2);
  add(new THREE.TorusGeometry(TER_R - 0.5, 0.02, 6, 160), metal, 0, HILL_H + 0.55, 0, Math.PI / 2);
  for (let i = 0; i < 56; i++) { const a = (i + 0.5) / 56 * Math.PI * 2; add(new THREE.CylinderGeometry(0.022, 0.022, 1.08, 6), metal, Math.cos(a) * (TER_R - 0.5), HILL_H + 0.54, Math.sin(a) * (TER_R - 0.5)); }
  for (const [lx, lz] of LAMPS) {                                // lamps
    add(new THREE.CylinderGeometry(0.05, 0.07, 3.6, 8), metal, lx, HILL_H + 1.8, lz);
    add(new THREE.SphereGeometry(0.2, 16, 12), propMat([0.2, 0.2, 0.2], [2.6, 1.9, 1.0]), lx, HILL_H + 3.7, lz);
  }
  add(new THREE.BoxGeometry(2.2, 0.08, 0.5), metal, -5.5, HILL_H + 0.46, 6.5, 0, 0.5); add(new THREE.BoxGeometry(2.2, 0.5, 0.06), metal, -5.62, HILL_H + 0.75, 6.28, 0, 0.5);
  // the witness: someone in a long coat at the rail, one hand on it
  {
    const [fx, fy, fz] = FIG, fig = new THREE.Group(); fig.position.set(fx, fy, fz); props.add(fig);
    const part = (geo, mat, x, y, z, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); m.scale.set(sx, sy, sz); m.frustumCulled = false; fig.add(m); };
    part(new THREE.SphereGeometry(0.105, 24, 18), skin, 0, 1.63, 0.01, 0, 0, 0.92, 1.08, 1);
    part(new THREE.SphereGeometry(0.113, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.6), hairM, 0, 1.645, -0.014, -0.3);
    part(new THREE.CylinderGeometry(0.045, 0.055, 0.1, 10), skin, 0, 1.5, 0);
    part(new THREE.CapsuleGeometry(0.15, 0.36, 6, 16), coat, 0, 1.22, 0, 0, 0, 1.2, 1, 0.72);
    part(new THREE.CylinderGeometry(0.17, 0.27, 0.78, 16), coat, 0, 0.66, 0, 0, 0, 1.05, 1, 0.72);
    for (const s of [-1, 1]) { part(new THREE.CapsuleGeometry(0.062, 0.3, 4, 10), dark, s * 0.085, 0.16, 0); part(new THREE.BoxGeometry(0.09, 0.06, 0.24), dark, s * 0.085, 0.03, 0.04); }
    part(new THREE.CapsuleGeometry(0.052, 0.52, 4, 10), coat, -0.235, 1.1, 0.0, 0, 0.1);
    part(new THREE.CapsuleGeometry(0.052, 0.3, 4, 10), coat, 0.235, 1.25, 0.06, -0.5, -0.1);
    part(new THREE.CapsuleGeometry(0.046, 0.3, 4, 10), coat, 0.25, 1.09, 0.3, -1.35, 0);          // forearm reaching to the rail
    part(new THREE.SphereGeometry(0.045, 10, 8), skin, 0.25, 1.1, 0.5);
  }
  // their flat image, and the terrace's
  const flatFig = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
    uniforms: { ...U, uG: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec2 vUv; void main(){ vUv = position.xz * 26.; gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position * 26., 1.); }`,
    fragmentShader: /* glsl */`precision highp float; varying vec2 vUv; uniform float uG; ${FCOMMON}
      float cap(vec2 p, vec2 a, vec2 b, float r){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h) - r; }
      float fig(vec2 p){ float d = length((p - vec2(0., 1.6)) * vec2(1.08, .95)) - .125;
        d = min(d, cap(p, vec2(0., 1.3), vec2(0., .95), .2)); d = min(d, cap(p, vec2(0., .95), vec2(0., .55), .245));
        d = min(d, cap(p, vec2(-.11, .5), vec2(-.14, -.1), .085)); d = min(d, cap(p, vec2(.11, .5), vec2(.14, -.1), .085));
        d = min(d, cap(p, vec2(-.23, 1.32), vec2(-.47, .72), .062)); d = min(d, cap(p, vec2(.23, 1.32), vec2(.6, 1.02), .062)); return d; }
      void main(){
        if (uG <= 0.) discard;
        float K = mix(1., 3.2, uG); vec2 p = vUv / K + vec2(0., .75); float d = fig(p) * K, r = length(vUv);
        float px = fwidth(d), inside = smoothstep(px, -px, d);
        float rings = (sin(d * 34.) * .5 + .5) * (1. - smoothstep(.1, .4, px * 34. / 6.283));          // the grain of a person, like the grain of a planet
        vec3 col = vec3(1., .9, .74) * inside * (.1 + .42 * rings) + vec3(1., .96, .88) * lineAA(d, .014) * 1.1;
        col += vec3(1., .9, .75) * exp(-max(d, 0.) / .4) * .06 * (1. - inside);
        // the terrace: circles and the ticks of its railing
        float tr = ${TER_R.toFixed(1)} * mix(1., 1.7, uG), rr = r / tr;
        float circ = lineAA((rr - 1.) * tr, .09) + lineAA((rr - .93) * tr, .06) * .7 + lineAA((fract(rr * 7.) - .5) * tr / 7., .04) * .22 * step(rr, .93);
        float ticks = smoothstep(.04, .0, abs(fract(atan(vUv.y, vUv.x) / 6.2832 * 56.) - .5) - .4) * step(.93, rr) * step(rr, 1.) * .6;
        col += vec3(1., .82, .55) * (circ + ticks) * .5 * step(rr, 1.03) * (1. - inside);
        gl_FragColor = vec4(col * smoothstep(0., .25, uG), 1.);
      }`,
  }));
  flatFig.position.set(FIG[0], 0.12, FIG[2]); flatFig.frustumCulled = false; flatFig.renderOrder = 4; scene.add(flatFig);

  // ---------- per-frame ----------
  function update(u, t, env) {
    U.uU.value = u; U.uTime.value = t; U.uPx.value = env.h / 1080; space.setViewport(env.h);
    const air = 1 - smooth(0.8, 0.97, u); U.uAir.value = air; space.uniforms.uDim.value = 1 - 0.93 * air;       // the air drains into the plane too: the sky goes black and the stars come out
    const age = (u - 1) * CITY.WIN;
    propU.uSink.value = smooth(0.05, 1.5, age) * (HILL_H + 5);
    flatFig.material.uniforms.uG.value = smoother((age - 1.15) / 1.7);
    const cam = env.camera; cam.near = clamp(cam.position.y * 0.02, 0.15, 60); cam.far = 120000;
    if (cam.position.y < 0.4) cam.position.y = 0.4;
  }
  const post = () => ({ exposure: 1.15, bloom: 0.3, bloomThreshold: 1.1, bloomKnee: 0.9, bloomRadius: 1.1, streak: 0.08, streakColor: [1.0, 0.75, 0.5],
    ca: 0.2, vignette: 0.55, grain: 0.03, saturation: 1.08, contrast: 1.06, tintLo: [0.95, 0.98, 1.08], tintHi: [1.05, 1.0, 0.94] });
  const figY = u => HILL_H - smooth(0.05, 1.5, (u - 1) * CITY.WIN) * (HILL_H + 5);
  const figure = u => [FIG[0], Math.max(0, figY(u)), FIG[2]];

  // ---------- cameras (x in 0..1 across the shot, u the city clock) ----------
  const cams = {
    // over their shoulder: the skyline, the bay, and something bright along the horizon
    shoulder: x => ({ pos: [lerp(1.15, 0.85, x), HILL_H + lerp(2.0, 1.92, x), FIG[2] - lerp(3.4, 2.5, x)], look: [-1.9, HILL_H + 1.25, FIG[2] + 60], fov: 42 }),
    // low over the bay, racing the edge to the piers
    bay: x => ({ pos: [150 - 90 * x, 12 + 16 * x, 3550 - 1080 * x], look: [0, 40 + 30 * x, 1700 - 500 * x], fov: 52 }),
    // among the towers as the edge comes through them toward the lens
    towers: x => { const a = lerp(-0.5, -2.4, easeInOut(x)), Rr = lerp(640, 430, x); return { pos: [1040 + Math.cos(a) * Rr, lerp(260, 120, x), 1400 + Math.sin(a) * Rr * 0.85], look: [1040 + 60 * x, lerp(100, 30, x), 1400 + 160 * (1 - x)], fov: 48 }; },
    // behind them as the ring closes; then straight up, and they are part of the picture
    figure: (x, u) => { const f = figure(u), k = smoother(clamp((x - 0.5) / 0.5, 0, 1)), a = v3lerp([1.25, 2.0, -3.4], [0.5, 3.4, -5.6], Math.min(1, x / 0.6));
      return { pos: v3lerp([f[0] + a[0], f[1] + a[1], f[2] + a[2]], [f[0] + 0.3, f[1] + 34, f[2] - 1.4], k), look: v3lerp([f[0] - 0.4, f[1] + 1.15, f[2] + 9], f, k), fov: lerp(46, 40, k) }; },
    crane: x => { const h = 34 * Math.exp(5.3 * easeInOut(x)); return { pos: [FIG[0] + 0.3 + h * 0.03, h, FIG[2] - 1.4 - h * 0.03], look: [FIG[0], 0, FIG[2] + h * 0.12], fov: 40, roll: 0.5 * x }; },
  };
  for (const k in cams) { const f = cams[k]; cams[k] = (...a) => ({ ...f(...a), realm: 'city' }); }

  return { scene, update, post, cams, figure, rhoAt };
}
