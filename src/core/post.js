// HDR post pipeline: MSAA scene target -> (optional sub-frame accumulation) -> bloom mip chain,
// anamorphic streak, god rays -> composite (CA, exposure, ACES, grade, vignette, grain, fade) -> screen.
import * as THREE from 'three';

const VS = /* glsl */`
in vec3 position; out vec2 vUv;
void main(){ vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0., 1.); }`;
const HEAD = /* glsl */`precision highp float; precision highp sampler2D; in vec2 vUv; out vec4 o;`;

const FS_COPY = HEAD + /* glsl */`
uniform sampler2D tSrc; uniform float uGain;
void main(){ o = vec4(texture(tSrc, vUv).rgb * uGain, 1.); }`;

const FS_DOWN = HEAD + /* glsl */`
uniform sampler2D tSrc; uniform vec2 uTexel; uniform float uFirst; uniform float uThreshold; uniform float uKnee;
vec3 s(vec2 p){ vec3 c = texture(tSrc, vUv + p * uTexel).rgb; return (c.r == c.r && c.g == c.g && c.b == c.b) ? min(c, vec3(4000.)) : vec3(0.); }
float kw(vec3 c){ return 1. / (1. + dot(c, vec3(.2126, .7152, .0722))); }
vec3 pre(vec3 c){
  float br = max(c.r, max(c.g, c.b));
  float soft = clamp(br - uThreshold + uKnee, 0., 2. * uKnee); soft = soft * soft / (4. * uKnee + 1e-4);
  return c * max(soft, br - uThreshold) / max(br, 1e-4);
}
void main(){
  vec3 a = s(vec2(-2, 2)), b = s(vec2(0, 2)), c = s(vec2(2, 2)), d = s(vec2(-2, 0)), e = s(vec2(0, 0)), f = s(vec2(2, 0));
  vec3 g = s(vec2(-2, -2)), h = s(vec2(0, -2)), i = s(vec2(2, -2)), j = s(vec2(-1, 1)), k = s(vec2(1, 1)), l = s(vec2(-1, -1)), m = s(vec2(1, -1));
  vec3 r;
  if (uFirst > .5) {
    vec3 g0 = (a + b + d + e) * .25, g1 = (b + c + e + f) * .25, g2 = (d + e + g + h) * .25, g3 = (e + f + h + i) * .25, g4 = (j + k + l + m) * .25;
    float w0 = kw(g0), w1 = kw(g1), w2 = kw(g2), w3 = kw(g3), w4 = kw(g4);
    r = (g0 * w0 * .125 + g1 * w1 * .125 + g2 * w2 * .125 + g3 * w3 * .125 + g4 * w4 * .5) / (w0 * .125 + w1 * .125 + w2 * .125 + w3 * .125 + w4 * .5);
    r = pre(r);
  } else {
    r = e * .125 + (a + c + g + i) * .03125 + (b + d + f + h) * .0625 + (j + k + l + m) * .125;
  }
  o = vec4(max(r, 0.), 1.);
}`;

const FS_UP = HEAD + /* glsl */`
uniform sampler2D tLow; uniform sampler2D tHigh; uniform vec2 uTexel; uniform float uRadius; uniform float uW;
void main(){
  vec2 d = uTexel * uRadius; vec3 r = vec3(0.);
  r += texture(tLow, vUv + vec2(-d.x, d.y)).rgb + texture(tLow, vUv + vec2(d.x, d.y)).rgb + texture(tLow, vUv + vec2(-d.x, -d.y)).rgb + texture(tLow, vUv + vec2(d.x, -d.y)).rgb;
  r += 2. * (texture(tLow, vUv + vec2(0., d.y)).rgb + texture(tLow, vUv + vec2(0., -d.y)).rgb + texture(tLow, vUv + vec2(d.x, 0.)).rgb + texture(tLow, vUv + vec2(-d.x, 0.)).rgb);
  r += 4. * texture(tLow, vUv).rgb;
  o = vec4(r / 16. + texture(tHigh, vUv).rgb * uW, 1.);
}`;

const FS_STREAK = HEAD + /* glsl */`
uniform sampler2D tSrc; uniform vec2 uDir; uniform float uGain;
void main(){
  vec3 r = vec3(0.); float ws = 0.;
  for (int i = -7; i <= 7; i++){ float w = exp(-float(i * i) / 24.); r += texture(tSrc, vUv + uDir * float(i)).rgb * w; ws += w; }
  o = vec4(r / ws * uGain, 1.);
}`;

const FS_RAYS = HEAD + /* glsl */`
uniform sampler2D tSrc; uniform vec2 uSun; uniform float uStep; uniform float uDecay;
void main(){
  vec2 d = (uSun - vUv) * uStep; vec3 r = vec3(0.); float w = 1., ws = 0.; vec2 p = vUv;
  for (int i = 0; i < 8; i++){ r += texture(tSrc, p).rgb * w; ws += w; w *= uDecay; p += d; }
  o = vec4(r / ws, 1.);
}`;

const FS_FINAL = HEAD + /* glsl */`
uniform sampler2D tSrc, tBloom, tStreak, tRays;
uniform vec2 uRes; uniform float uExposure, uBloom, uStreak, uRays, uCA, uVignette, uGrain, uSat, uContrast, uFade, uTime, uLetterbox, uFlash;
uniform vec3 uRaysColor, uTintLo, uTintHi, uStreakColor, uFlashColor;
float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 RRTAndODTFit(vec3 v){ vec3 a = v * (v + .0245786) - .000090537; vec3 b = v * (.983729 * v + .4329510) + .238081; return a / b; }
vec3 aces(vec3 c){
  const mat3 I = mat3(.59719, .07600, .02840, .35458, .90834, .13383, .04823, .01566, .83777);
  const mat3 O = mat3(1.60475, -.10208, -.00327, -.53108, 1.10813, -.07276, -.07367, -.00605, 1.07602);
  c = I * (c / .6); c = RRTAndODTFit(c); return clamp(O * c, 0., 1.);
}
void main(){
  vec2 c = vUv - .5; float r2 = dot(c, c);
  vec2 off = c * r2 * uCA * 4.;
  vec3 col = vec3(texture(tSrc, vUv + off).r, texture(tSrc, vUv).g, texture(tSrc, vUv - off).b);
  col = max(col, 0.);
  col += texture(tBloom, vUv).rgb * uBloom;
  col += texture(tStreak, vUv).rgb * uStreak * uStreakColor;
  col += texture(tRays, vUv).rgb * uRays * uRaysColor;
  col *= uExposure;
  col += uFlashColor * uFlash;
  float asp = uRes.x / uRes.y;
  float v = 1. - uVignette * smoothstep(.12, .95, length(c * vec2(1., 1. / asp) * 1.9) );
  col *= v;
  col = aces(col);
  float l = dot(col, vec3(.2126, .7152, .0722));
  col = mix(vec3(l), col, uSat);
  col = (col - .5) * uContrast + .5;
  col *= mix(uTintLo, uTintHi, smoothstep(0., .75, l));
  col = pow(max(col, 0.), vec3(1. / 2.2));
  float g = hash(gl_FragCoord.xy + fract(uTime * 7.31) * 913.) + hash(gl_FragCoord.yx * 1.37 + fract(uTime * 3.17) * 571.) - 1.;
  col += g * uGrain * (1. - .5 * l);
  col *= uFade;
  if (uLetterbox > 0.) { float h = .5 * (1. - asp / uLetterbox); col *= step(h, vUv.y) * step(vUv.y, 1. - h); }
  o = vec4(clamp(col, 0., 1.), 1.);
}`;

export const POST_DEFAULTS = {
  exposure: 1, bloom: 0.12, bloomThreshold: 1.0, bloomKnee: 0.5, bloomRadius: 1.0,
  streak: 0, streakColor: [0.55, 0.75, 1.0],
  rays: 0, raysColor: [1.0, 0.82, 0.6], sunUv: [0.5, 0.5],
  ca: 0.6, vignette: 0.42, grain: 0.03, saturation: 1.0, contrast: 1.0,
  tintLo: [1, 1, 1], tintHi: [1, 1, 1], fade: 1, letterbox: 0, time: 0,
  flash: 0, flashColor: [1, 1, 1],
};

export class Post {
  constructor(renderer, { msaa = 4 } = {}) {
    this.r = renderer; this.msaa = msaa;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.quad = new THREE.Mesh(g, null); this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    const mk = (fs, uniforms, extra = {}) => new THREE.RawShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: VS, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });
    const U = v => ({ value: v });
    this.mCopy = mk(FS_COPY, { tSrc: U(null), uGain: U(1) });
    this.mAdd = mk(FS_COPY, { tSrc: U(null), uGain: U(1) }, { blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation, transparent: true });
    this.mDown = mk(FS_DOWN, { tSrc: U(null), uTexel: U(new THREE.Vector2()), uFirst: U(0), uThreshold: U(1), uKnee: U(0.5) });
    this.mUp = mk(FS_UP, { tLow: U(null), tHigh: U(null), uTexel: U(new THREE.Vector2()), uRadius: U(1), uW: U(1) });
    this.mStreak = mk(FS_STREAK, { tSrc: U(null), uDir: U(new THREE.Vector2()), uGain: U(1) });
    this.mRays = mk(FS_RAYS, { tSrc: U(null), uSun: U(new THREE.Vector2()), uStep: U(0.1), uDecay: U(0.9) });
    this.mFinal = mk(FS_FINAL, {
      tSrc: U(null), tBloom: U(null), tStreak: U(null), tRays: U(null), uRes: U(new THREE.Vector2()),
      uExposure: U(1), uBloom: U(0.1), uStreak: U(0), uRays: U(0), uCA: U(0), uVignette: U(0.4), uGrain: U(0.03), uSat: U(1), uContrast: U(1),
      uFade: U(1), uTime: U(0), uLetterbox: U(0), uFlash: U(0),
      uRaysColor: U(new THREE.Color()), uTintLo: U(new THREE.Color(1, 1, 1)), uTintHi: U(new THREE.Color(1, 1, 1)), uStreakColor: U(new THREE.Color()), uFlashColor: U(new THREE.Color()),
    });
    this.params = structuredClone(POST_DEFAULTS);
    this.w = 0; this.h = 0;
  }

  setSize(w, h) {
    w = Math.max(8, Math.floor(w)); h = Math.max(8, Math.floor(h));
    if (w === this.w && h === this.h) return;
    this.dispose();
    this.w = w; this.h = h;
    const hdr = (ww, hh, o = {}) => new THREE.WebGLRenderTarget(Math.max(2, Math.floor(ww)), Math.max(2, Math.floor(hh)), {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, generateMipmaps: false, ...o });
    this.rtScene = hdr(w, h, { depthBuffer: true, samples: this.msaa });
    this.rtAccum = hdr(w, h);
    this.down = []; this.up = [];
    let ww = w, hh = h;
    for (let i = 0; i < 7; i++) { ww /= 2; hh /= 2; if (Math.min(ww, hh) < 4) break; this.down.push(hdr(ww, hh)); this.up.push(hdr(ww, hh)); }
    this.rtStreakA = hdr(w / 8, h / 8); this.rtStreakB = hdr(w / 8, h / 8);
    this.rtRaysA = hdr(w / 4, h / 4); this.rtRaysB = hdr(w / 4, h / 4);
  }

  dispose() {
    for (const k of ['rtScene', 'rtAccum', 'rtStreakA', 'rtStreakB', 'rtRaysA', 'rtRaysB']) { this[k]?.dispose(); this[k] = null; }
    (this.down || []).forEach(t => t.dispose()); (this.up || []).forEach(t => t.dispose());
    this.down = []; this.up = [];
  }

  pass(mat, target) {
    this.quad.material = mat; this.r.setRenderTarget(target); this.r.render(this.scene, this.cam);
  }

  // Sub-frame accumulation (film motion blur + supersampling): begin, add each sample, then finish(useAccum = true).
  beginAccum() {
    const r = this.r; r.setRenderTarget(this.rtAccum); r.setClearColor(0x000000, 0); r.clear(true, false, false);
  }
  addSample(weight) {
    this.mAdd.uniforms.tSrc.value = this.rtScene.texture; this.mAdd.uniforms.uGain.value = weight;
    const ac = this.r.autoClear; this.r.autoClear = false; this.pass(this.mAdd, this.rtAccum); this.r.autoClear = ac;
  }

  finish(useAccum = false) {
    const P = this.params, src = useAccum ? this.rtAccum.texture : this.rtScene.texture;
    const d = this.mDown.uniforms;
    let prev = src, pw = this.w, ph = this.h;
    this.down.forEach((rt, i) => {
      d.tSrc.value = prev; d.uTexel.value.set(1 / pw, 1 / ph); d.uFirst.value = i === 0 ? 1 : 0; d.uThreshold.value = P.bloomThreshold; d.uKnee.value = P.bloomKnee;
      this.pass(this.mDown, rt); prev = rt.texture; pw = rt.width; ph = rt.height;
    });
    const u = this.mUp.uniforms, n = this.down.length;
    // weights favour the mid mips: tight core + wide soft halo
    const W = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
    let low = this.down[n - 1].texture, lw = this.down[n - 1].width, lh = this.down[n - 1].height, wsum = W[n - 1];
    for (let i = n - 2; i >= 0; i--) {
      u.tLow.value = low; u.tHigh.value = this.down[i].texture; u.uTexel.value.set(1 / lw, 1 / lh); u.uRadius.value = P.bloomRadius; u.uW.value = W[i];
      this.pass(this.mUp, this.up[i]); low = this.up[i].texture; lw = this.up[i].width; lh = this.up[i].height; wsum += W[i];
    }
    const F = this.mFinal.uniforms;
    F.tBloom.value = low; F.uBloom.value = P.bloom / wsum * 3.0;

    if (P.streak > 0 && this.down.length > 2) {
      const s = this.mStreak.uniforms; const tx = 1 / this.rtStreakA.width;
      s.tSrc.value = this.down[2].texture; s.uDir.value.set(tx * 1.5, 0); s.uGain.value = 1; this.pass(this.mStreak, this.rtStreakA);
      s.tSrc.value = this.rtStreakA.texture; s.uDir.value.set(tx * 5, 0); this.pass(this.mStreak, this.rtStreakB);
      s.tSrc.value = this.rtStreakB.texture; s.uDir.value.set(tx * 14, 0); this.pass(this.mStreak, this.rtStreakA);
      F.tStreak.value = this.rtStreakA.texture;
    } else F.tStreak.value = null;
    F.uStreak.value = F.tStreak.value ? P.streak : 0;

    if (P.rays > 0 && this.down.length > 1) {
      const g = this.mRays.uniforms; g.uSun.value.set(P.sunUv[0], P.sunUv[1]); g.uDecay.value = 0.93;
      g.tSrc.value = this.down[1].texture; g.uStep.value = 0.6 / 8; this.pass(this.mRays, this.rtRaysA);
      g.tSrc.value = this.rtRaysA.texture; g.uStep.value = 0.6 / 64; this.pass(this.mRays, this.rtRaysB);
      g.tSrc.value = this.rtRaysB.texture; g.uStep.value = 0.6 / 512; this.pass(this.mRays, this.rtRaysA);
      F.tRays.value = this.rtRaysA.texture;
    } else F.tRays.value = null;
    F.uRays.value = F.tRays.value ? P.rays : 0;

    F.tSrc.value = src; F.uRes.value.set(this.w, this.h);
    F.uExposure.value = P.exposure; F.uCA.value = P.ca * 0.01; F.uVignette.value = P.vignette; F.uGrain.value = P.grain;
    F.uSat.value = P.saturation; F.uContrast.value = P.contrast; F.uFade.value = P.fade; F.uTime.value = P.time; F.uLetterbox.value = P.letterbox;
    F.uFlash.value = P.flash; F.uFlashColor.value.fromArray(P.flashColor);
    F.uRaysColor.value.fromArray(P.raysColor); F.uStreakColor.value.fromArray(P.streakColor);
    F.uTintLo.value.fromArray(P.tintLo); F.uTintHi.value.fromArray(P.tintHi);
    this.pass(this.mFinal, null);
  }
}
