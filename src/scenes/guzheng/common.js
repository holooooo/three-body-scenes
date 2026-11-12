// Shared constants + material patch helpers for the Guzheng scene (units: metres, +x = ship heading, +y up).
import * as THREE from 'three';
import { GLSL_NOISE } from '../../core/util.js';

export const WIRES = { n: 50, y0: 0.75, h: 0.5, span: 82 };          // 50 filaments, 0.5 m apart
export const NSLAB = WIRES.n + 1;                                     // 0 = hull below the lowest wire, 50 = everything above the top one
export const SHIP = { L: 240, half: 120, beam: 17, keel: -9, deck: 9.5, speed: 8 };
export const slabOf = y => Math.min(NSLAB - 1, Math.max(0, Math.floor((y - WIRES.y0) / WIRES.h) + 1));
export const slabLo = k => WIRES.y0 + (k - 1) * WIRES.h;

// Sun: low, ahead of the ship and a little to port, so the hull is back-lit on the way in.
const el = THREE.MathUtils.degToRad(7.5), az = THREE.MathUtils.degToRad(-24);
export const SUN_DIR = new THREE.Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();


// Golden-hour sky model shared by the dome, the fog and the image-based light.
export const SKY_GLSL = /* glsl */`
vec3 skyBase(vec3 d, vec3 sunDir){
  float mu = dot(d, sunDir), h = clamp(d.y, 0., 1.), hz = pow(1. - h, 3.);
  vec3 zen = vec3(.075, .16, .40), hor = vec3(.58, .50, .50);
  vec3 col = mix(hor, zen, pow(h, .42));
  float sunSide = max(mu, 0.), anti = max(-mu, 0.);
  col += vec3(1.9, .78, .22) * pow(sunSide, 3.) * hz * 1.25;                 // low warm band toward the sun
  col += vec3(1.6, .62, .22) * pow(sunSide, 24.) * (.35 + .9 * hz);           // aureole
  col += vec3(2.2, 1.25, .55) * pow(sunSide, 220.) * 1.6;
  col = mix(col, vec3(.60, .40, .47), pow(anti, 1.5) * exp(-h * 7.) * .62);   // Belt of Venus
  col = mix(col, vec3(.26, .30, .44), pow(anti, 1.5) * exp(-h * 38.) * .7);   // Earth's shadow under it
  if (d.y < 0.) col = mix(col, vec3(.16, .15, .15), smoothstep(0., -.25, d.y));
  return col;
}`;
export const SKY_CLOUD_GLSL = /* glsl */`
float cfbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 6; i++){ s += a * vnoise(p); p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.7; a *= .5; } return s; }
vec3 skyFull(vec3 d, vec3 sunDir, float t, float disc){
  vec3 col = skyBase(d, sunDir);
  float mu = dot(d, sunDir);
  if (d.y > 0.004) {
    for (int L = 0; L < 2; L++) {
      float alt = L == 0 ? .11 : .2, sc = L == 0 ? .55 : 1.7;
      vec2 uv = d.xz / (d.y + alt) * sc + vec2(t * .004, float(L) * 7.3);
      vec2 w = vec2(cfbm(uv * .7 + 1.3), cfbm(uv * .7 + 9.1)) - .5;
      float n = cfbm(uv * vec2(.55, 1.25) + w * 1.3);
      float cov = L == 0 ? .50 : .56;
      float c = smoothstep(cov, cov + .26, n) * smoothstep(.0, .09, d.y) * (L == 0 ? .92 : .55);
      float thick = smoothstep(cov, cov + .42, n);
      vec3 lit = mix(vec3(1.9, .82, .36), vec3(1.25, .55, .42), smoothstep(.2, -.6, mu));           // under-lit by the low sun
      vec3 dark = mix(vec3(.27, .24, .31), vec3(.20, .21, .30), d.y);
      vec3 cc = mix(lit, dark, thick * .78) * (.55 + .75 * pow(max(mu, 0.), 2.));
      cc += vec3(2.4, 1.2, .5) * pow(max(mu, 0.), 14.) * (1. - thick) * .9;                           // silver lining
      col = mix(col, cc, c);
      disc *= 1. - c * .97;
    }
  }
  float sd = smoothstep(.99988, .99996, mu);
  col += vec3(260., 150., 62.) * sd * disc;
  return col;
}`;

export const shared = {
  uSunDir: { value: SUN_DIR.clone() },
  uFogColor: { value: new THREE.Color(0.62, 0.50, 0.44) },
  uFogSun: { value: new THREE.Color(1.9, 1.05, 0.5) },
  uFogDensity: { value: 0.00046 },
  uTime: { value: 0 },
};

const FOG_FRAG = /* glsl */`
{
  vec3 fv = vWp - cameraPosition; float fd = length(fv); vec3 fdir = fv / max(fd, 1e-3);
  float hf = exp(-max(vWp.y, 0.) * 0.006);
  float ff = 1. - exp(-fd * uFogDensity * (0.35 + 0.65 * hf));
  vec3 fcol = skyBase(normalize(vec3(fdir.x, max(fdir.y, 0.) * .5 + .03, fdir.z)), uSunDir) * .92;
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fcol, clamp(ff, 0., 1.));
}`;

// Patch a MeshStandardMaterial: aerial-perspective fog + optional custom vertex deform / procedural surface.
//  o.vertPars    GLSL declarations for the vertex shader
//  o.vertDeform  GLSL that must define `vec3 dP` (world/object position) and `vec3 dN` (normal)
//  o.fragPars    GLSL declarations for the fragment shader
//  o.fragSurface GLSL that may write `diffuseColor.rgb`, `gRough`, `gMetal`, `gEmis`, `gBump` (object-space normal offset)
export function patchStd(mat, o = {}) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, shared, o.uniforms || {});
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWp;\n${o.vertPars || ''}`)
      .replace('#include <beginnormal_vertex>', o.vertDeform ? `${o.vertDeform}\nvec3 objectNormal = dN;` : '#include <beginnormal_vertex>')
      .replace('#include <begin_vertex>', o.vertDeform ? 'vec3 transformed = dP;' : '#include <begin_vertex>')
      .replace('#include <project_vertex>', `#include <project_vertex>
        #ifdef USE_INSTANCING
          vWp = (modelMatrix * instanceMatrix * vec4(transformed, 1.)).xyz;
        #else
          vWp = (modelMatrix * vec4(transformed, 1.)).xyz;
        #endif`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWp;\nuniform vec3 uSunDir, uFogColor, uFogSun; uniform float uFogDensity, uTime;\n${GLSL_NOISE}\n${SKY_GLSL}\nfloat gRough = -1., gMetal = -1., gOcc = 1.; vec3 gEmis = vec3(0.); vec3 gBump = vec3(0.);\n${o.fragPars || ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${o.fragSurface || ''}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nif (gRough >= 0.) roughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (gMetal >= 0.) metalnessFactor = gMetal;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(normal + (viewMatrix * vec4(gBump, 0.)).xyz);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmis;')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= gOcc; reflectedLight.indirectSpecular *= gOcc;')
      .replace('#include <fog_fragment>', FOG_FRAG);
    o.onCompile?.(sh);
  };
  mat.customProgramCacheKey = () => (o.key || 'std') + (o.vertDeform ? 'D' : '') + (o.fragSurface ? 'S' : '');
  return mat;
}

// Depth material that follows the same vertex deform (for shadow maps).
export function depthFor(o) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, shared, o.uniforms || {});
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${o.vertPars || ''}`)
      .replace('#include <begin_vertex>', `${o.vertDeform}\nvec3 transformed = dP;`);
  };
  m.customProgramCacheKey = () => 'depth' + (o.key || '');
  return m;
}
