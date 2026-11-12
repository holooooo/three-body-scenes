// Engine: renderer + post + time + camera modes. Scenes are pure functions of time, so the same
// code drives the interactive viewer (scrubbable) and the frame-exact film renderer.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Post, POST_DEFAULTS } from './post.js';
import { clamp, lerp, smoother } from './util.js';

export const SCENES = {
  guzheng: { no: '01', zh: '古筝行动', en: 'Operation Guzheng', load: () => import('../scenes/guzheng/index.js') },
  droplet: { no: '02', zh: '末日战役', en: 'Doomsday Battle', load: () => import('../scenes/droplet/index.js') },
  foil: { no: '03', zh: '二向箔', en: 'Dimensional Strike', load: () => import('../scenes/foil/index.js') },
};

export const QUALITY = {
  low: { name: 'low', pixelRatio: 1, msaa: 0, shadow: 1024, reflect: 0.33, density: 0.4 },
  medium: { name: 'medium', pixelRatio: 1.25, msaa: 4, shadow: 2048, reflect: 0.5, density: 0.7 },
  high: { name: 'high', pixelRatio: 1.75, msaa: 4, shadow: 4096, reflect: 0.5, density: 1 },
  film: { name: 'film', pixelRatio: 1, msaa: 4, shadow: 4096, reflect: 1, density: 1 },
};

const HALTON = Array.from({ length: 16 }, (_, i) => {
  const h = (idx, b) => { let f = 1, r = 0; while (idx > 0) { f /= b; r += f * (idx % b); idx = Math.floor(idx / b); } return r; };
  return [h(i + 1, 2) - 0.5, h(i + 1, 3) - 0.5];
});

export class Engine {
  constructor(canvas, { film = false, quality = 'high' } = {}) {
    this.canvas = canvas; this.film = film;
    this.quality = { ...QUALITY[film ? 'film' : quality] };
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false });
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.NoToneMapping;
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.autoClear = true;
    this.post = new Post(r, { msaa: this.quality.msaa });
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 10000);
    this.t = 0; this.playing = true; this.speed = 1; this.mode = 'director';
    this.listeners = {};
    this.follow = null; this._lastFocus = null; this._blend = null;
    this.clock = performance.now();
    if (!film) {
      const c = this.controls = new OrbitControls(this.camera, canvas);
      c.enableDamping = true; c.dampingFactor = 0.08; c.enabled = false; c.zoomSpeed = 0.9; c.rotateSpeed = 0.6;
      const wake = () => { if (this.mode === 'director') this.setMode('orbit'); };
      canvas.addEventListener('pointerdown', wake);
      canvas.addEventListener('wheel', wake, { passive: true });
    }
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); }
  emit(ev, ...a) { (this.listeners[ev] || []).forEach(f => f(...a)); }

  async load(id) {
    const def = SCENES[id]; if (!def) throw new Error('unknown scene ' + id);
    const mod = await def.load();
    this.scene = await mod.default({ THREE, renderer: this.renderer, quality: this.quality, film: this.film, engine: this });
    this.sceneId = id; this.duration = this.scene.duration;
    this.resize();
    return this.scene;
  }

  resize(w, h) {
    const c = this.canvas;
    w = w || c.clientWidth || window.innerWidth; h = h || c.clientHeight || window.innerHeight;
    const pr = this.film ? 1 : Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio) * (this.dynScale || 1);
    this._lastSize = [w, h];
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false);
    this.w = Math.floor(w * pr); this.h = Math.floor(h * pr);
    this.post.setSize(this.w, this.h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.scene?.resize?.(this.w, this.h);
  }

  applyPose(p) {
    const c = this.camera;
    c.position.set(p.pos[0], p.pos[1], p.pos[2]); c.up.set(0, 1, 0); c.lookAt(p.look[0], p.look[1], p.look[2]);
    if (p.roll) c.rotateZ(p.roll);
    c.fov = p.fov || 40;
  }

  env(extra) { return { camera: this.camera, w: this.w, h: this.h, film: this.film, quality: this.quality, ...extra }; }

  drawScene(t, target) {
    const s = this.scene, cam = this.camera;
    s.update(t, this.env());
    cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
    if (s.render) s.render(this.renderer, cam, target, this.env());
    else { this.renderer.setRenderTarget(target); this.renderer.render(s.scene, cam); }
  }

  applyPost(t, over) {
    Object.assign(this.post.params, structuredClone(POST_DEFAULTS), this.scene.post ? this.scene.post(t, this.env()) : {}, over || {});
    this.post.params.time = t;
  }

  // ---------- interactive ----------
  setMode(m) {
    if (m === this.mode) return;
    if (m === 'orbit') {
      const p = this.scene.director(this.t, this.env());
      const f = this.follow ? this.focusPoint(this.follow) : null;
      this.controls.target.set(...(f ? f.p : p.look));
      this._lastFocus = f ? f.p.slice() : null;
      this.controls.enabled = true;
    } else {
      this.controls.enabled = false;
      this._blend = { from: { pos: this.camera.position.toArray(), look: this.controls.target.toArray(), fov: this.camera.fov }, t0: performance.now(), dur: 1400 };
      this.follow = null;
    }
    this.mode = m; this.emit('mode', m);
  }

  focusPoint(id) { const f = this.scene.focus?.find(x => x.id === id); return f ? f.get(this.t) : null; }

  focusOn(id) {
    const f = this.focusPoint(id); if (!f) return;
    if (this.mode !== 'orbit') { this.follow = id; this.setMode('orbit'); } else this.follow = id;
    const cam = this.camera, tgt = new THREE.Vector3(...f.p);
    let dir = f.dir ? new THREE.Vector3(...f.dir) : cam.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.set(1, 0.4, 1);
    dir.normalize();
    this._tween = { t0: performance.now(), dur: 1100, fromPos: cam.position.clone(), fromTgt: this.controls.target.clone(), toPos: tgt.clone().addScaledVector(dir, f.r * 3.2), toTgt: tgt };
    this._lastFocus = f.p.slice();
    this.emit('focus', id);
  }

  seek(t) { this.t = clamp(t, 0, this.duration); this.emit('time', this.t); }
  play(v = true) { if (v && this.t >= this.duration - 0.01) this.t = 0; this.playing = v; this.emit('play', v); }

  start() {
    const loop = now => {
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.clock) / 1000); this.clock = now;
      if (this.playing) {
        this.t += dt * this.speed;
        if (this.t >= this.duration) { this.t = this.duration; this.playing = false; this.emit('play', false); }
        if (this.t < 0) { this.t = 0; this.playing = false; this.emit('play', false); }
      }
      this.frame(now);
      this.emit('time', this.t);
      // dynamic resolution: hold a smooth frame rate on whatever GPU this is
      this._acc = (this._acc || 0) + dt; this._n = (this._n || 0) + 1;
      if (this._n >= 40) {
        const avg = this._acc / this._n, s0 = this.dynScale || 1; let s = s0;
        if (avg > 1 / 44) s = Math.max(0.5, s0 * 0.86); else if (avg < 1 / 57 && s0 < 1) s = Math.min(1, s0 * 1.07);
        this._acc = 0; this._n = 0;
        if (Math.abs(s - s0) > 0.01 && document.visibilityState === 'visible') { this.dynScale = s; this.resize(); }
      }
    };
    this.clock = performance.now(); this._raf = requestAnimationFrame(loop);
  }

  frame(now) {
    const s = this.scene, cam = this.camera;
    if (this.mode === 'director') {
      const p = s.director(this.t, this.env());
      if (this._blend) {
        const k = smoother((now - this._blend.t0) / this._blend.dur), a = this._blend.from;
        this.applyPose({ pos: a.pos.map((v, i) => lerp(v, p.pos[i], k)), look: a.look.map((v, i) => lerp(v, p.look[i], k)), fov: lerp(a.fov, p.fov || 40, k), roll: (p.roll || 0) * k });
        if (k >= 1) this._blend = null;
      } else this.applyPose(p);
    } else {
      const c = this.controls;
      if (this._tween) {
        const tw = this._tween, k = smoother((now - tw.t0) / tw.dur);
        const f = this.follow ? this.focusPoint(this.follow) : null;
        if (f) { const d = new THREE.Vector3(...f.p).sub(tw.toTgt); tw.toTgt.add(d); tw.toPos.add(d); this._lastFocus = f.p.slice(); }
        cam.position.lerpVectors(tw.fromPos, tw.toPos, k); c.target.lerpVectors(tw.fromTgt, tw.toTgt, k);
        if (k >= 1) this._tween = null;
      } else if (this.follow) {
        const f = this.focusPoint(this.follow);
        if (f && this._lastFocus) {
          const d = [f.p[0] - this._lastFocus[0], f.p[1] - this._lastFocus[1], f.p[2] - this._lastFocus[2]];
          cam.position.x += d[0]; cam.position.y += d[1]; cam.position.z += d[2];
          c.target.x += d[0]; c.target.y += d[1]; c.target.z += d[2];
        }
        if (f) this._lastFocus = f.p.slice();
      }
      const lim = s.orbitLimits?.(this.follow, this.t);
      if (lim) { c.minDistance = lim.min; c.maxDistance = lim.max; if (lim.minY != null && cam.position.y < lim.minY) cam.position.y = lim.minY; }
      c.update();
      cam.fov = lerp(cam.fov, 40, 0.08);
    }
    cam.clearViewOffset?.();
    this.drawScene(this.t, this.post.rtScene);
    this.applyPost(this.t);
    this.post.finish(false);
  }

  // ---------- film ----------
  filmShot(ft) {
    const shots = this.scene.film.shots;
    for (let i = shots.length - 1; i >= 0; i--) if (ft >= shots[i].from) return shots[i];
    return shots[0];
  }

  renderFilmFrame(ft, { samples = 6, shutter = 0.5, fps = 60 } = {}) {
    const film = this.scene.film, shot = this.filmShot(clamp(ft, 0, film.duration - 1e-4));
    const eps = 1e-4, cam = this.camera;
    let stMid = 0;
    this.post.beginAccum();
    for (let i = 0; i < samples; i++) {
      const off = samples > 1 ? ((i + 0.5) / samples - 0.5) * shutter / fps : 0;
      const f = clamp(ft + off, shot.from, (shot.to ?? film.duration) - eps);
      const st = shot.time(f), u = (f - shot.from) / ((shot.to ?? film.duration) - shot.from);
      if (i === Math.floor(samples / 2)) stMid = st;
      this.t = st;
      this.applyPose(shot.cam(u, st, f));
      const j = HALTON[i % 16];
      if (samples > 1) cam.setViewOffset(this.w, this.h, j[0], j[1], this.w, this.h); else cam.clearViewOffset();
      this.drawScene(st, this.post.rtScene);
      this.post.addSample(1 / samples);
    }
    cam.clearViewOffset();
    const fade = film.fade ? film.fade(ft) : 1;
    this.applyPost(stMid, { ...(shot.post ? shot.post((ft - shot.from) / ((shot.to ?? film.duration) - shot.from), stMid) : {}) });
    this.post.params.fade *= fade; this.post.params.time = ft;
    this.post.finish(true);
    return stMid;
  }
}
