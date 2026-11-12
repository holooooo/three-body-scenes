// Particle effects for the Guzheng scene. Everything is an analytic function of uTime so the timeline can be scrubbed.
import * as THREE from 'three';
import { rng, GLSL_NOISE } from '../../core/util.js';
import { shared, SUN_DIR } from './common.js';

const QUAD = () => {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
};
const BILL = /* glsl */`
vec3 billboard(vec3 c, vec2 corner, float size, float rot){
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float cs = cos(rot), sn = sin(rot); vec2 q = vec2(cs * corner.x - sn * corner.y, sn * corner.x + cs * corner.y);
  return c + (right * q.x + up * q.y) * size;
}`;

// ---- smoke + fire from fixed sources riding on the wreck ----
// source: { x0, tau, y, z, lx, t0, rate (0..1 share of particles), size, life }
export function makeSmoke({ sources, count = 1400, slideT, speed, xs }) {
  const g = QUAD(), R = rng(77);
  const seed = new Float32Array(count * 4), src = new Float32Array(count * 4), src2 = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    let r = R(), s = sources[0], acc = 0; for (const q of sources) { acc += q.rate; if (r <= acc) { s = q; break; } }
    seed.set([R(), R(), R(), R()], i * 4);
    src.set([s.lx, s.y, s.z, s.tau], i * 4); src2.set([s.t0, s.size, s.life, s.fire || 0], i * 4);
  }
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4)); g.setAttribute('aSrc', new THREE.InstancedBufferAttribute(src, 4)); g.setAttribute('aSrc2', new THREE.InstancedBufferAttribute(src2, 4));
  g.instanceCount = count;
  const uniforms = { ...shared, uSlideT: { value: slideT }, uSpeed: { value: speed }, uXs: { value: xs }, uFireMode: { value: 0 } };
  const vs = /* glsl */`
    attribute vec4 aSeed, aSrc, aSrc2; uniform float uTime, uSlideT, uSpeed, uXs, uFireMode;
    varying vec2 vUv; varying float vAge, vLife, vSeed, vFire; varying vec3 vWp;
    ${GLSL_NOISE} ${BILL}
    void main(){
      float fire = uFireMode;
      float life = aSrc2.z * (fire > .5 ? .16 : 1.) * (.7 + .6 * aSeed.y), t0 = aSrc2.x;
      float ph = aSeed.x * life, n = floor((uTime - t0 - ph) / life), tb = t0 + ph + n * life, age = uTime - tb;
      float alive = step(t0, tb) * step(0., age);
      float u = max(0., tb - uSlideT), sx = uXs + uSpeed * aSrc.w * (1. - exp(-u / aSrc.w)) + aSrc.x;
      vec3 c = vec3(sx, aSrc.y, aSrc.z) + (aSeed.yzw - .5) * vec3(7., 2., 7.) * aSrc2.y * (fire > .5 ? .7 : 1.);
      float k = age / life;
      vec3 wind = vec3(-.9, 0., -1.3);
      float rise = fire > .5 ? 5.5 * age : (11. * age / (1. + age * .09) + 2.5 * sqrt(age));
      c += wind * age * (.6 + .5 * k) + vec3(0., rise, 0.);
      vec3 tq = c * .035 + vec3(0., -uTime * .12, aSeed.z * 9.);
      c += (vec3(vnoise3(tq), vnoise3(tq + 17.), vnoise3(tq + 31.)) - .5) * (4. + 18. * k) * (fire > .5 ? .25 : 1.);
      float size = aSrc2.y * (fire > .5 ? (1.5 + 1.6 * k) : (3.2 + 20. * pow(k, .75))) * (.7 + .6 * aSeed.w);
      vec3 p = billboard(c, position.xy, size * alive, aSeed.z * 6.28 + age * (aSeed.w - .5) * .5);
      vUv = position.xy; vAge = k; vLife = life; vSeed = aSeed.x; vFire = aSrc2.w; vWp = c;
      gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
    }`;
  const fs = /* glsl */`
    uniform vec3 uSunDir, uFogColor, uFogSun; uniform float uFogDensity, uTime, uFireMode;
    varying vec2 vUv; varying float vAge, vLife, vSeed, vFire; varying vec3 vWp;
    ${GLSL_NOISE}
    void main(){
      float r = length(vUv); if (r > 1.) discard;
      float nz = fbm(vUv * 2.2 + vSeed * 40. + vec2(0., -vAge * 1.5));
      float shape = smoothstep(1., .25, r + (nz - .5) * .9);
      if (uFireMode > .5) {
        float a = shape * smoothstep(0., .08, vAge) * (1. - smoothstep(.35, 1., vAge)) * vFire;
        vec3 c = mix(vec3(1., .78, .4), vec3(1., .22, .03), smoothstep(0., .7, vAge + r * .4)) * 3.2;
        gl_FragColor = vec4(c * a, 1.); return;
      }
      vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]), up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]), back = vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
      vec3 N = normalize(right * vUv.x + up * vUv.y + back * sqrt(max(0., 1. - r * r)) * .8);
      float sunL = max(dot(N, uSunDir) * .6 + .4, 0.);
      vec3 base = mix(vec3(.012, .011, .010), vec3(.11, .10, .095), smoothstep(.1, 1., vAge));
      vec3 col = base * (vec3(1.5, .9, .5) * sunL * 3.2 + vec3(.35, .42, .55) * .9);
      col += vec3(1., .35, .06) * 2.2 * vFire * (1. - smoothstep(0., .22, vAge)) * (.4 + .6 * nz);       // lit from below by the fire
      float a = shape * smoothstep(0., .05, vAge) * (1. - smoothstep(.55, 1., vAge)) * mix(.75, .28, vAge);
      float fd = length(vWp - cameraPosition), ff = 1. - exp(-fd * uFogDensity);
      col = mix(col, uFogColor, ff);
      gl_FragColor = vec4(col * a, a);
    }`;
  const smoke = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor }));
  const fu = { ...uniforms, uFireMode: { value: 1 } };
  const gf = new THREE.InstancedBufferGeometry(); gf.index = g.index; for (const k of Object.keys(g.attributes)) gf.setAttribute(k, g.attributes[k]); gf.instanceCount = Math.floor(count / 5);
  const fire = new THREE.Mesh(gf, new THREE.ShaderMaterial({ uniforms: fu, vertexShader: vs, fragmentShader: fs, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  smoke.frustumCulled = fire.frustumCulled = false; smoke.renderOrder = 8; fire.renderOrder = 9;
  return { smoke, fire };
}

// ---- spray / dust where the sheets plough forward ----
// spawn(i, R) -> { t, x, y, z, vx, vy, vz, size, life, dust }
export function makeSpray({ count, spawn }) {
  const g = QUAD(), R = rng(4242), a = new Float32Array(count * 4), b = new Float32Array(count * 4), c = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const s = spawn(i, R);
    a.set([s.x, s.y, s.z, s.t], i * 4); b.set([s.vx, s.vy, s.vz, s.life], i * 4); c.set([s.size, s.dust, R(), R()], i * 4);
  }
  g.setAttribute('aA', new THREE.InstancedBufferAttribute(a, 4)); g.setAttribute('aB', new THREE.InstancedBufferAttribute(b, 4)); g.setAttribute('aC', new THREE.InstancedBufferAttribute(c, 4));
  g.instanceCount = count;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared }, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: /* glsl */`
      attribute vec4 aA, aB, aC; uniform float uTime; varying vec2 vUv; varying float vK, vDust, vSeed; varying vec3 vWp;
      ${BILL}
      void main(){
        float age = uTime - aA.w, k = age / aB.w, alive = step(0., age) * step(k, 1.);
        float grav = mix(9.8, -.6, aC.y);
        vec3 c = aA.xyz + aB.xyz * age * mix(1., 1. / (1. + age * .8), aC.y) - vec3(0., .5 * grav * age * age, 0.);
        c.y = max(c.y, -.2);
        float size = aC.x * mix(.5 + 2.2 * k, 1. + 5. * sqrt(k), aC.y);
        vec3 p = billboard(c, position.xy, size * alive, aC.z * 6.28);
        vUv = position.xy; vK = k; vDust = aC.y; vSeed = aC.w; vWp = c;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uSunDir, uFogColor; uniform float uFogDensity; varying vec2 vUv; varying float vK, vDust, vSeed; varying vec3 vWp;
      ${GLSL_NOISE}
      void main(){
        float r = length(vUv); if (r > 1.) discard;
        float nz = fbm(vUv * 2.6 + vSeed * 50.);
        float shape = smoothstep(1., .15, r + (nz - .5) * 1.1);
        vec3 col = mix(vec3(.85, .84, .82) * vec3(1.35, .95, .72), vec3(.34, .25, .17) * vec3(1.5, 1., .7), vDust) * (1.1 + .4 * nz);
        float a = shape * smoothstep(0., .1, vK) * (1. - smoothstep(.4, 1., vK)) * mix(.5, .16, vDust);
        float fd = length(vWp - cameraPosition); col = mix(col, uFogColor, 1. - exp(-fd * uFogDensity));
        gl_FragColor = vec4(col * a, a);
      }`,
  });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 7;
  return m;
}

// ---- glints where a filament is inside steel right now ----
export function makeSparks(max = 400) {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(max * 3), amp = new Float32Array(max);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aAmp', new THREE.BufferAttribute(amp, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uScale: { value: 1080 } }, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`attribute float aAmp; uniform float uScale; varying float vA;
      void main(){ vec4 mv = viewMatrix * vec4(position, 1.); gl_Position = projectionMatrix * mv; vA = aAmp;
        gl_PointSize = clamp(uScale * (0.55 + aAmp * .5) / -mv.z, 1.5, 46.); gl_Position.z -= 0.0006 * gl_Position.w; }`,
    fragmentShader: /* glsl */`varying float vA; void main(){ vec2 q = gl_PointCoord * 2. - 1.; float r = length(q);
      float core = exp(-r * r * 14.), star = exp(-abs(q.x) * 9.) * exp(-abs(q.y) * 60.) + exp(-abs(q.y) * 9.) * exp(-abs(q.x) * 60.);
      gl_FragColor = vec4(vec3(1., .78, .42) * (core * 5. + star * 2.) * vA, 1.); }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 6;
  return { pts, pos, amp, max, geo: g };
}

// ---- a single expanding fireball + light for the engine-room blast ----
export function makeBlast() {
  const g = new THREE.PlaneGeometry(2, 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...shared, uK: { value: -1 }, uCenter: { value: new THREE.Vector3() }, uSize: { value: 30 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`uniform vec3 uCenter; uniform float uSize, uK; varying vec2 vUv; ${BILL}
      void main(){ vUv = position.xy; float s = uSize * (.25 + 1.3 * sqrt(max(uK, 0.))) * step(0., uK) * step(uK, 1.);
        gl_Position = projectionMatrix * viewMatrix * vec4(billboard(uCenter + vec3(0., 14. * uK, 0.), position.xy, s, 0.), 1.); }`,
    fragmentShader: /* glsl */`uniform float uK, uTime; varying vec2 vUv; ${GLSL_NOISE}
      void main(){ float r = length(vUv); if (r > 1.) discard; float n = fbm(vUv * 3. + vec2(0., -uK * 3.));
        float body = smoothstep(1., .1, r + (n - .5) * .8 + uK * .25);
        vec3 c = mix(vec3(1., .9, .6), vec3(1., .22, .02), smoothstep(0., .8, uK + r * .5)) * 26. * pow(1. - uK, 2.2);
        gl_FragColor = vec4(c * body, 1.); }`,
  });
  const m = new THREE.Mesh(g, mat); m.frustumCulled = false; m.renderOrder = 10;
  const light = new THREE.PointLight(new THREE.Color(1, 0.45, 0.12), 0, 600, 1.6);
  return { mesh: m, light, uniforms: mat.uniforms };
}
export { SUN_DIR };
