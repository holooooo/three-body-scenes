// Deep-space backdrop shared by the Droplet and Foil scenes: Milky Way dome + point stars + a distant Sun.
import * as THREE from 'three';
import { rng, GLSL_NOISE } from './util.js';

export function makeSpace({ stars = 9000, seed = 7, galaxyTilt = [0.35, 0.9, 0.25], milky = 1, starGain = 1 } = {}) {
  const group = new THREE.Group();
  const gdir = new THREE.Vector3(...galaxyTilt).normalize();
  const uniforms = { uGal: { value: gdir }, uMilky: { value: milky }, uPx: { value: 1 }, uStarGain: { value: starGain }, uDim: { value: 1 } };

  const dome = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 5), new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false,
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * viewMatrix * vec4(position * 1000. + cameraPosition, 1.); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`precision highp float; varying vec3 vDir; uniform vec3 uGal; uniform float uMilky, uDim;
      ${GLSL_NOISE}
      void main(){
        vec3 d = normalize(vDir);
        float lat = dot(d, uGal);                                   // 0 on the galactic plane
        vec3 t1 = normalize(cross(uGal, vec3(.3, .1, .9))), t2 = cross(uGal, t1);
        float lon = atan(dot(d, t2), dot(d, t1));
        vec3 q = d * 3.2;
        float band = exp(-lat * lat * 22.) * (.5 + .5 * cos(lon - .6));
        // many octaves of fine structure so it reads as unresolved stars, not as mist
        float cloud = fbm3(q * 1.9 + 3.) * .45 + fbm3(q * 6.1 + 11.) * .33 + fbm3(q * 19. + 5.) * .22;
        float dust = smoothstep(.42, .7, fbm3(q * 3.1 + vec3(7., 1., 4.)) * (.55 + 1.1 * exp(-lat * lat * 140.)));
        float core = exp(-lat * lat * 70.) * exp(-pow(lon - .6, 2.) * 1.8);
        vec3 col = vec3(.36, .44, .74) * band * pow(cloud, 2.6) * .5;
        col += vec3(1.0, .76, .5) * core * pow(cloud, 1.5) * .34;
        col *= 1. - dust * .85;
        col += vec3(.008, .011, .02) * (.6 + .4 * fbm3(q * .7));   // faint floor so black is never dead
        gl_FragColor = vec4(col * uMilky * uDim, 1.);
      }`,
  }));
  dome.frustumCulled = false; dome.renderOrder = -20;
  group.add(dome);

  const R = rng(seed), pos = new Float32Array(stars * 3), col = new Float32Array(stars * 3), mag = new Float32Array(stars);
  for (let i = 0; i < stars; i++) {
    let x, y, z, l;
    do { x = R() * 2 - 1; y = R() * 2 - 1; z = R() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
    l = Math.sqrt(l); x /= l; y /= l; z /= l;
    // concentrate toward the galactic plane
    if (R() < 0.45) { const d = x * gdir.x + y * gdir.y + z * gdir.z, k = 0.72; x -= gdir.x * d * k; y -= gdir.y * d * k; z -= gdir.z * d * k; const m = Math.hypot(x, y, z); x /= m; y /= m; z /= m; }
    pos.set([x, y, z], i * 3);
    const m = Math.pow(R(), 9); mag[i] = 0.05 + m * 3.4;
    const t = R(), c = t < 0.18 ? [1.0, 0.72, 0.5] : t < 0.5 ? [1.0, 0.93, 0.82] : t < 0.85 ? [0.9, 0.94, 1.0] : [0.7, 0.8, 1.0];
    col.set(c, i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  const pts = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    vertexShader: `attribute float aMag; attribute vec3 color; uniform float uPx; varying vec3 vC; varying float vM;
      void main(){ vec4 p = projectionMatrix * viewMatrix * vec4(position * 1000. + cameraPosition, 1.); gl_Position = p.xyww;
        vM = aMag; vC = color; gl_PointSize = max(1.5, (1.3 + sqrt(aMag) * 2.6) * uPx); }`,
    fragmentShader: `precision highp float; varying vec3 vC; varying float vM; uniform float uStarGain, uDim;
      void main(){ vec2 q = gl_PointCoord * 2. - 1.; float r2 = dot(q, q); float a = exp(-r2 * 4.5);
        gl_FragColor = vec4(vC * a * vM * 1.25 * uStarGain * uDim, 1.); }`,
  }));
  pts.frustumCulled = false; pts.renderOrder = -19;
  group.add(pts);
  return { group, uniforms, setViewport: h => { uniforms.uPx.value = h / 1080; } };
}

// A distant sun: tiny disc + soft glare, drawn as a camera-following billboard so bloom/streaks can pick it up.
export function makeFarSun(dir, { color = [1, 0.96, 0.9], size = 0.012, gain = 1 } = {}) {
  const d = new THREE.Vector3(...dir).normalize();
  const uniforms = { uDir: { value: d }, uColor: { value: new THREE.Color(...color) }, uSize: { value: size }, uGain: { value: gain }, uAspect: { value: 16 / 9 } };
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    vertexShader: `uniform vec3 uDir; uniform float uSize, uAspect; varying vec2 vUv;
      void main(){ vUv = position.xy; vec4 c = projectionMatrix * viewMatrix * vec4(uDir * 1000. + cameraPosition, 1.);
        c.xy += position.xy * vec2(1., uAspect) * uSize * 14. * c.w; gl_Position = c.xyww; }`,
    fragmentShader: `precision highp float; uniform vec3 uColor; uniform float uGain; varying vec2 vUv;
      void main(){ float r = length(vUv) * 14.;
        float disc = smoothstep(1., .82, r) * 420.;
        float glow = .9 / (1. + r * r * 1.4) + .06 / (1. + r * .7);
        float fade = smoothstep(14., 5., r);
        gl_FragColor = vec4(uColor * (disc + glow * fade) * uGain, 1.); }`,
  }));
  m.frustumCulled = false; m.renderOrder = -18;
  return { mesh: m, uniforms, dir: d };
}
