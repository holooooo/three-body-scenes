// Operation Guzheng — Gaillard Cut, Panama Canal.
// Timeline (seconds): 0 calm canal, filaments rising from the bed · 14 bow reaches the filaments ·
// 44 stern clears them · 48 the sheets begin to slide · ~80 the wreck comes to rest.
import * as THREE from 'three';
import { clamp, lerp, smooth, smoother, easeInOut, easeOut, v3lerp, spline, rng } from '../../core/util.js';
import { WIRES, NSLAB, SHIP, SUN_DIR, shared, slabOf } from './common.js';
import { bakeHeight, makeWorld, terrainH, canalCenter } from './world.js';
import { makeShip, makeDish, makeMastTop, halfBeam } from './ship.js';
import { makeSmoke, makeSpray, makeSparks, makeBlast } from './fx.js';

export const T = { rise0: 2, rise1: 9, bow: 14, stern: 44, slide: 48, blast: 51.4, end: 96 };
const X0 = -SHIP.half - SHIP.speed * T.bow;
const XS = X0 + SHIP.speed * T.slide;                           // ship centre when the slide begins
const shipX = t => X0 + SHIP.speed * Math.min(t, T.slide);
// 18 sheets make up the hull itself; the deckhouses above add 32 more. Weight the spread so the hull fans widely.
const gk = k => 0.62 * Math.min(1, k / 18) + 0.38 * (k / 50);
const tau = k => 6 * (1 + 3.4 * Math.pow(gk(k), 1.15));
const hk = k => { const s = Math.sin(k * 127.1 + 31.7) * 43758.5453; return s - Math.floor(s); };
const travel = (k, u) => SHIP.speed * tau(k) * (1 - Math.exp(-u / tau(k)));

function slabState(k, t, out) {
  const u = Math.max(0, t - T.slide);
  if (u <= 0) { out.set(shipX(t), 0, 0, 0); return out; }
  const s = travel(k, u), sm = SHIP.speed * tau(k), f = s / sm, q = Math.min(1, k) * gk(k);
  // the higher the sheet, the further it runs and the more it slews toward the outer bank: a fanned hand of cards
  const yaw = (0.46 * Math.pow(q, 1.2) + (hk(k + 9) - 0.5) * 0.03 * Math.min(1, k)) * Math.pow(f, 1.35);
  const z = SHIP.half * 0.82 * Math.sin(yaw) + (hk(k) - 0.5) * 2.0 * Math.min(1, k) * f;
  out.set(XS + s - SHIP.half * 0.82 * (1 - Math.cos(yaw)), z, yaw, k === 0 ? -0.35 * smooth(2, 20, u) : 0);
  return out;
}

export default async function create({ renderer, quality, film }) {
  const { tex, rect } = bakeHeight();
  const world = makeWorld({ renderer, quality, heightTex: tex, heightRect: rect });
  const ship = makeShip({ heightTex: tex, heightRect: rect });
  const dish = makeDish(), mastTop = makeMastTop();
  const sparks = makeSparks();
  const blast = makeBlast();
  const { scene } = world;
  scene.add(ship.mesh, dish, mastTop, sparks.pts, blast.mesh, blast.light);

  const { smoke, fire } = makeSmoke({
    slideT: T.slide, speed: SHIP.speed, xs: XS, count: Math.floor(1100 * quality.density),
    sources: [
      { lx: -64, y: 10, z: 7, tau: tau(18), t0: T.blast, rate: 0.72, size: 0.85, life: 24, fire: 1 },
      { lx: -20, y: 8, z: -5, tau: tau(16), t0: T.blast + 7, rate: 0.28, size: 0.5, life: 16, fire: 0.7 },
    ],
  });
  scene.add(smoke, fire);

  // spray where sheet bows meet water, dust where they meet the bank
  const spray = makeSpray({
    count: Math.floor(2600 * quality.density),
    spawn: (i, R) => {
      const k = 1 + Math.floor(R() * 49), u = 0.8 + R() * 30 * Math.pow(R(), 0.6), t = T.slide + u;
      const st = slabState(k, t, new THREE.Vector4()), lz = (R() * 2 - 1) * 15, lx = SHIP.half - R() * 60 * R();
      const x = st.x + lx * Math.cos(st.z) - lz * Math.sin(st.z), z = st.y + lz * Math.cos(st.z) + lx * Math.sin(st.z), gh = terrainH(x, z), dust = gh > 0.2 ? 1 : 0;
      const sp = SHIP.speed * Math.exp(-u / tau(k));
      return { t, x, y: Math.max(gh, 0) + 0.2, z, vx: sp * (0.3 + R() * 0.8), vy: dust ? 0.6 + R() * 1.6 : 2.5 + R() * 6.5 * Math.min(1, sp / 4), vz: (R() * 2 - 1) * 3.5, size: dust ? 1.4 + R() * 2.2 : 0.9 + R() * 1.9, life: dust ? 3 + R() * 4 : 0.9 + R() * 1.3, dust };
    },
  });
  scene.add(spray);

  // --- JS replica of the vertex shader's drape so rigid riders can follow a sheet ---
  const S = Array.from({ length: NSLAB }, () => new THREE.Vector4());
  const setSlabs = t => { if (S.t === t) return; for (let k = 0; k < NSLAB; k++) slabState(k, t, S[k]); S.t = t; };
  const groundAt = (x, z, rip) => Math.max(terrainH(x, z), -1.3) + rip * (Math.sin(x * 0.071 + z * 0.043) * 0.5 + Math.sin(x * 0.19 - z * 0.11 + 1.7) * 0.22);
  const hullHalf = lx => { let p = 1; if (lx > 66) p = Math.pow(Math.max(0, 1 - Math.pow(clamp((lx - 66) / 54, 0, 1), 2.3)), 0.56); if (lx < -76) { const q = clamp((-76 - lx) / 44, 0, 1); p = 1 - 0.26 * q * q; } return SHIP.beam * p + 0.45; };
  const HULL_FOOT = [-SHIP.half, 200, -1000, 0];
  function under(j, x, z, towerBase, foot) {
    const s = S[j], c = Math.cos(s.z), sn = Math.sin(s.z), dx = x - s.x, dz = z - s.y, lx = dx * c + dz * sn, lz = -dx * sn + dz * c;
    const hull = j < towerBase || foot[2] < -900, rear = hull ? -SHIP.half - 0.5 : foot[0], front = hull ? SHIP.half + 0.5 : foot[1];
    const side = hull ? hullHalf(lx) - Math.abs(lz) : Math.min(lz - foot[2], foot[3] - lz);
    return smooth(-7, 0, front - lx) * smooth(-7, 0, lx - rear) * smooth(-4.2, 0, side);
  }
  function sheetPoint(k, lx, ly, lz, towerBase, foot, rip) {
    const s = S[k], c = Math.cos(s.z), sn = Math.sin(s.z), x = s.x + c * lx - sn * lz, z = s.y + sn * lx + c * lz;
    if (k === 0) return [x, ly + s.w, z];
    let cnt = 0;
    for (let j = 1; j < k; j++) cnt += under(j, x, z, towerBase, foot);
    const sb = under(0, x, z, 99, HULL_FOOT), g = lerp(groundAt(x, z, rip), WIRES.y0 + S[0].w, sb);
    return [x, g + WIRES.h * cnt + (ly - (WIRES.y0 + (k - 1) * WIRES.h)), z];
  }

  // where a filament at height y is inside steel when the ship centre is at cx
  const D = SHIP.deck;
  const BOXES = [[-119.5, -62, 15.6, D, D + 3, 1], [-104, -72, 14, D + 3, 99], [34, 72, 13.5, D, D + 8], [40, 62, 9, D + 8, D + 11], [-8, -3, 15.5, D, D + 2.1]];
  function contacts(cx, y) {
    const lx = -cx, out = [];
    if (Math.abs(lx) > SHIP.half) return out;
    if (y <= D) out.push(halfBeam(lx, y)); else if (lx > 86 && y <= D + 3) out.push(halfBeam(lx, D));
    for (const b of BOXES) if (lx >= b[0] && lx <= b[1] && y > b[3] && y <= b[4]) out.push(b[5] ? Math.min(b[2], halfBeam(lx, D) - 0.6) : b[2]);
    const cyl = (cxx, r, y0, y1) => { if (Math.abs(lx - cxx) < r && y > y0 && y <= y1) out.push(Math.sqrt(r * r - (lx - cxx) ** 2)); };
    cyl(-112, 3.8, D + 3, 99); cyl(51, 3.4, D + 11, 99); cyl(102, 0.5, D + 3, 99);
    return out;
  }

  const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), AX_Z = new THREE.Vector3(0, 0, 1), AX_X = new THREE.Vector3(1, 0, 0), AX_Y = new THREE.Vector3(0, 1, 0);
  const state = { wiresOn: 0, inside: 0 };
  const LR = new THREE.Vector3().crossVectors(AX_Y, SUN_DIR).normalize(), LU = new THREE.Vector3().crossVectors(SUN_DIR, LR).normalize();
  // --- the control room: ship-local points to world, before and during the slide ---
  const ROOM_FOOT = [34, 72, -13.5, 13.5], ROOM_BASE = slabOf(D + 1e-3);
  const roomPt = (lx, ly, lz) => sheetPoint(slabOf(ly), lx, ly, lz, ROOM_BASE, ROOM_FOOT, smooth(0.5, 9, Math.max(0, S.t - T.slide)));
  const insideRoom = p => { const lx = p.x - S[22].x, lz = p.z - S[22].y; return smooth(33.5, 35, lx) * smooth(72.5, 71, lx) * smooth(14, 12.9, Math.abs(lz)) * smooth(9.2, 9.9, p.y) * smooth(15.4, 14.6, p.y); };
  const roomCam = (t, pos, look, fov) => { setSlabs(t); return { pos: roomPt(...pos), look: roomPt(...look), fov }; };

  function update(t, env) {
    shared.uTime.value = t;
    const u = Math.max(0, t - T.slide), rip = smooth(0.5, 9, u);
    setSlabs(t); for (let k = 0; k < NSLAB; k++) ship.slabs[k].copy(S[k]);
    const su = ship.uniforms; su.uShipX.value = shipX(t); su.uCutX.value = 0; su.uRipple.value = rip; su.uSoft.value = 7;

    // water
    const wu = world.wu; wu.uShipX.value = S[0].x; wu.uWake.value = u > 0 ? Math.exp(-u / tau(0)) : 1;
    const fanI = smooth(0.5, 5, u) * Math.exp(-u / 11);
    wu.uFan.value.set(S[1].x + SHIP.half, S[NSLAB - 1].x + SHIP.half, 22 * smooth(0, 20, u), fanI);

    // filaments: lying on the bed, then raised; they sing while the hull is in them
    const wr = world.wires.uniforms; wr.uRise.value = smoother((t - T.rise0) / (T.rise1 - T.rise0));
    const inCut = smooth(T.bow - 0.2, T.bow + 0.6, t) * (1 - smooth(T.stern - 0.3, T.stern + 1.5, t));
    wr.uVib.value = inCut; wr.uShow.value = state.wiresOn; wr.uWet.value = smooth(T.rise0, T.rise0 + 2, t) * (1 - smooth(T.rise1 + 1, T.bow, t));

    // contact glints
    let n = 0; const cx = shipX(t);
    if (t > T.bow - 0.1 && t < T.stern + 0.1) {
      for (let i = 0; i < WIRES.n && n < sparks.max - 4; i++) {
        const y = WIRES.y0 + i * WIRES.h;
        for (const hb of contacts(cx, y)) for (const sg of [-1, 1]) {
          if (n >= sparks.max) break;
          const f = 0.5 + 0.5 * Math.sin(t * 5.3 + i * 2.4 + sg) * Math.sin(t * 3.1 + i * 1.7);          // slow shimmer; a per-frame hash would strobe
          sparks.pos[n * 3] = 0.05; sparks.pos[n * 3 + 1] = y; sparks.pos[n * 3 + 2] = sg * (hb + 0.03); sparks.amp[n] = 0.35 + 0.5 * f; n++;
        }
      }
    }
    sparks.geo.setDrawRange(0, n); sparks.geo.attributes.position.needsUpdate = true; sparks.geo.attributes.aAmp.needsUpdate = true;
    sparks.pts.material.uniforms.uScale.value = env.h * 0.42;

    // foremast top: the first thing to go, cut free as it crosses the top filament
    {
      const tm = (-102 - X0) / SHIP.speed + 0.25, a = Math.max(0, t - tm);
      const phi = Math.min(1.72, 0.5 * 1.15 * a * a), landed = smooth(1.5, 1.72, phi);
      const base = sheetPoint(NSLAB - 1, 102 - 3.2 * landed, WIRES.y0 + 49 * WIRES.h, 0, 19, [101.2, 102.8, -0.8, 0.8], rip);
      const deck = sheetPoint(slabOf(D + 3), 96, D + 3 + 0.5, 1.5 * landed, 19, HULL_FOOT, rip);
      mastTop.position.set(lerp(base[0], deck[0] + 3, landed), lerp(base[1], deck[1], landed), lerp(base[2], deck[2], landed));
      mastTop.quaternion.setFromAxisAngle(AX_Z, phi).multiply(tmpQ.setFromAxisAngle(AX_X, 0.35 * landed));
    }
    // the big dish: stays with the top sheet, then topples forward to port and goes into the canal
    {
      const a = Math.max(0, u - 0.7), phi = Math.min(2.3, 0.5 * 0.5 * a * a);
      const piv = sheetPoint(NSLAB - 1, 51, 27.4, 0, slabOf(D + 1e-3), [47.2, 54.8, -3.8, 3.8], rip);
      const off = Math.max(0, a - 2.4), fall = 0.5 * 9.8 * off * off * 0.55;
      const y = Math.max(-5.5, piv[1] - fall), hit = piv[1] - fall < 1.5;
      dish.position.set(piv[0] + 2.2 * off + 9 * smooth(1.2, 2.3, phi), y, piv[2] - 5.5 * off * (y > -5.4 ? 1 : 0) - 22 * smooth(0.8, 2.3, phi) * smooth(0, 2, off + 0.4));
      dish.quaternion.setFromAxisAngle(tmpV.set(0.42, 0, -0.9).normalize(), phi);
      const sp = wu.uSplash.value[0];
      if (hit) { if (state.dishHitT == null || t < state.dishHitT) state.dishHitT = null; }
      // splash time is found analytically: fall reaches the water when piv.y - fall = 1.5
      const offHit = Math.sqrt(Math.max(0, (27.6 - 1.5)) / (0.5 * 9.8 * 0.55)), tHit = T.slide + 0.7 + 2.4 + offHit, age = t - tHit;
      if (age > 0) sp.set(dish.position.x, dish.position.z, 4 + age * 7.5, Math.exp(-age / 3.2) * 1.2); else sp.set(0, 0, 0, 0);
      state.dishSplashT = tHit;
    }
    // engine-room blast
    {
      const k = (t - T.blast) / 2.4, src = sheetPoint(18, -64, 9.4, 7, 1, HULL_FOOT, rip);
      blast.uniforms.uK.value = k >= 0 && k <= 1 ? k : -1; blast.uniforms.uCenter.value.set(src[0], src[1] + 4, src[2]); blast.uniforms.uSize.value = 26;
      blast.light.position.set(src[0], src[1] + 16, src[2]);
      const burn = t > T.blast ? 1 : 0;
      blast.light.intensity = burn * (90000 * Math.exp(-Math.max(0, t - T.blast) * 2.2) + 9000 * (0.75 + 0.25 * Math.sin(t * 13.1) * Math.sin(t * 7.7)));
    }
    ship.uniforms.uLit.value = 1;

    // sun shadow frustum follows the wreck
    const mid = (S[0].x + S[NSLAB - 1].x) / 2, ms = world.sun.shadow.mapSize.x;
    tmpV.set(mid, 0, 6);
    const sr = Math.round(tmpV.dot(LR) / (600 / ms)) * (600 / ms), su2 = Math.round(tmpV.dot(LU) / (400 / ms)) * (400 / ms), sd = tmpV.dot(SUN_DIR);
    world.sun.target.position.set(0, 0, 0).addScaledVector(LR, sr).addScaledVector(LU, su2).addScaledVector(SUN_DIR, sd);
    world.sun.position.copy(world.sun.target.position).addScaledVector(SUN_DIR, 1400);
    world.sun.target.updateMatrixWorld();

    const cam = env.camera; state.inside = insideRoom(cam.position); cam.near = state.inside > 0.01 ? 0.06 : 0.6; cam.far = 45000;
  }

  function render(r, cam, target) {
    r.shadowMap.autoUpdate = false; r.shadowMap.needsUpdate = true;
    world.renderReflection(cam, [world.water, world.wires.mesh, sparks.pts]);
    r.setRenderTarget(target); r.render(scene, cam);
  }

  const sunP = new THREE.Vector3();
  function post(t, env) {
    sunP.copy(env.camera.position).addScaledVector(SUN_DIR, 10000).project(env.camera);
    const front = sunP.z < 1 ? 1 : 0, ux = sunP.x * 0.5 + 0.5, uy = sunP.y * 0.5 + 0.5;
    const on = front * smooth(1.5, 0.9, Math.max(Math.abs(sunP.x), Math.abs(sunP.y)));
    const flash = Math.max(0, 1 - Math.abs(t - T.blast - 0.08) / 0.16);
    // inside the room the eye opens up, and more so once the lights are out
    const dark = state.inside * smooth(-2, 6, (S[22].x + 53) - 0) * (1 - 0.7 * smooth(0.3, 5, t - T.slide)) * 0.5;
    return {
      exposure: 0.82 * (1 + 0.5 * state.inside + 1.6 * dark), bloom: 0.16 + 0.06 * state.inside, bloomThreshold: 1.25, bloomKnee: 0.8, rays: 0.55 * on * (1 - 0.75 * state.inside), sunUv: [ux, uy], raysColor: [1.0, 0.66, 0.36],
      ca: 0.16, vignette: 0.46 + 0.14 * state.inside, grain: 0.016, saturation: 1.06, contrast: 1.05, tintLo: [0.94, 0.98, 1.06], tintHi: [1.05, 1.0, 0.94],
      flash: flash * 0.5, flashColor: [1, 0.6, 0.3],
    };
  }

  // ---------- anchors ----------
    const fanMid = () => [(S[1].x + S[NSLAB - 1].x) / 2 + SHIP.half * 0.6, 6, S[25].y];
  const focus = [
    { id: 'wires', zh: '飞刃', en: 'Filaments', get: () => ({ p: [0, 13, 0], r: 26, dir: [0.75, 0.12, 0.65] }) },
    { id: 'bow', zh: '船首', en: 'Bow', get: () => ({ p: [S[20].x + SHIP.half - 14, 9, S[20].y], r: 22, dir: [0.8, 0.12, -0.6] }) },
    { id: 'room', zh: '主控室（舱内）', en: 'Control room (inside)', get: t => { setSlabs(t); return { p: roomPt(53, 11.6, 0), r: 3.0, dir: [-0.94, 0.08, 0.3] }; } },
    { id: 'bridge', zh: '舰桥', en: 'Bridge', get: () => { const p = sheetPoint(40, -88, 22, 0, 19, [-104.4, -71.6, -14.4, 14.4], 0); return { p, r: 22, dir: [-0.5, 0.25, 0.83] }; } },
    { id: 'dish', zh: '天线', en: 'Antenna', get: () => ({ p: [dish.position.x, Math.max(2, dish.position.y + 6), dish.position.z], r: 17, dir: [0.7, 0.2, -0.7] }) },
    { id: 'wreck', zh: '全船', en: 'Whole ship', get: () => ({ p: [(S[0].x + S[NSLAB - 1].x) / 2, 10, S[25].y * 0.5], r: 105, dir: [-0.35, 0.3, -0.89] }) },
    { id: 'canal', zh: '运河', en: 'The Cut', get: () => ({ p: [60, 10, 0], r: 190, dir: [-0.6, 0.42, 0.68] }) },
  ];

  // ---------- interactive director ----------
  const lookShip = (t, lx, y, z = 0) => [shipX(t) + lx, y, z];
  // interior views are given in ship-local metres and ride with the sheet at that height
  const SHOTS = [
    { a: 0, b: 6, cam: (u, t) => ({ pos: v3lerp([-470, 92, -46], [-410, 62, -28], easeInOut(u)), look: v3lerp([-80, 4, 0], [0, 10, 0], u), fov: 30 }) },
    { a: 6, b: 13.2, cam: (u, t) => ({ pos: v3lerp([19, 15.5, 36], [11, 13.6, 27], easeInOut(u)), look: v3lerp([-24, 12.5, -6], [-34, 12, -16], u), fov: 32 }) },
    { a: 13.2, b: 18.6, cam: (u, t) => ({ pos: v3lerp([16, 6, -31], [8.5, 9.5, -26], easeInOut(u)), look: v3lerp([0, 7.5, -9], [1, 12, -8], u), fov: 36 }) },
    { a: 18.6, b: 26.5, cam: (u, t) => roomCam(t, [lerp(38.5, 41.5, easeInOut(u)), 11.5, 0.2], [70, 11.7, -0.2], 52) },
    { a: 26.5, b: 34, cam: (u, t) => ({ pos: v3lerp([-40, 24, 62], [-58, 30, 78], u), look: [4, 13, 6], fov: 36 }) },
    { a: 34, b: 47.5, cam: (u, t) => ({ pos: [shipX(t) - 230 + 20 * u, 64 - 14 * u, -48 + 16 * u], look: lookShip(t, 0, 12), fov: 30 }) },
    { a: 47.5, b: 51, cam: (u, t) => ({ pos: v3lerp([XS - 44, 19, -64], [XS - 30, 21, -64], easeInOut(u)), look: v3lerp([XS + 60, 7, 8], [XS + 70, 6, 10], u), fov: 50 }) },
    { a: 51, b: 60, cam: (u, t) => roomCam(t, [lerp(37.2, 39.4, u), 11.55, 0.5], [68, 11.35, 2.6], 62) },
    { a: 60, b: 78, cam: (u, t) => ({ pos: v3lerp([XS - 116, 52, -32], [XS - 84, 64, -18], easeInOut(u)), look: [XS + 120, 0, 20], fov: 40 }) },
    { a: 78, b: 96.1, cam: (u, t) => ({ pos: v3lerp([XS + 330, 60, 170], [XS + 250, 90, 190], easeInOut(u)), look: [XS + 150, 0, 16], fov: 42 }) },
  ];
  function director(t) {
    for (const s of SHOTS) if (t >= s.a && t < s.b) return s.cam((t - s.a) / (s.b - s.a), t);
    return SHOTS[SHOTS.length - 1].cam(1, t);
  }

  const moments = [
    { t: 0, id: 'calm', zh: '盖拉德水道', en: 'Gaillard Cut', textZh: '巴拿马运河最窄的一段。两岸各立起一根钢柱，五十根纳米“飞刃”沉在河底，等前一艘船通过。', textEn: 'The narrowest reach of the Panama Canal. A steel pillar stands on each bank; fifty nano-filaments lie on the bed, waiting.' },
    { t: 5, id: 'rise', zh: '琴弦就位', en: 'The strings are raised', textZh: '飞刃升起，间距半米，像一架横在运河上的古筝。它们只有头发丝的十分之一粗，只有逆光时才偶尔一闪。', textEn: 'The filaments rise, half a metre apart — a zither laid across the canal. A tenth of a hair thick, they only glint against the sun.' },
    { t: 14, id: 'contact', zh: '船首接触', en: 'First contact', textZh: '“审判日”号的船首穿过飞刃。没有声音，没有阻力，船体上只多了几十道看不见的细线。', textEn: 'The bow of Judgment Day passes the filaments. No sound, no resistance — only dozens of invisible lines across the hull.' },
    { t: 16.5, id: 'mast', zh: '第一个迹象', en: 'The first sign', textZh: '前桅顶端被齐根切断，缓缓倒下。这是整艘船上唯一看得出异常的地方。', textEn: 'The top of the foremast, cut clean at its base, slowly topples — the only visible sign that anything is wrong.' },
    { t: 20, id: 'room', zh: '主控室', en: 'The control room', textZh: '飞刃从前舱壁穿入第二红岸基地的主控室，扫过屏幕、机柜和桌椅。电缆被切断，灯从前往后一排排熄灭，但每样东西都还立在原地。', textEn: 'The filaments enter the control room of the Second Red Coast Base through its forward wall and sweep across screens, racks and desks. Severed cables kill the lights row by row, yet everything stays exactly where it stood.' },
    { t: 30, id: 'passing', zh: '穿过琴弦', en: 'Through the strings', textZh: '两百四十米的船身以每秒八米的速度滑过，每一层甲板、每一根管线都被切成半米厚的薄片。', textEn: 'Two hundred and forty metres of ship slide through at eight metres a second; every deck and pipe is cut into half-metre sheets.' },
    { t: 44, id: 'clear', zh: '完全通过', en: 'Clear of the wires', textZh: '船尾离开飞刃。整艘船看起来完好无损，仍在向前航行。', textEn: 'The stern clears the wires. The ship looks intact and sails on.' },
    { t: 48, id: 'slide', zh: '错位', en: 'The slide', textZh: '四十多层薄片开始错开，越靠上的滑得越远，像一叠被向前推倒的扑克牌。', textEn: 'More than forty sheets begin to shear apart, the upper ones sliding furthest — a deck of cards pushed forward.' },
    { t: 51.4, id: 'blast', zh: '从舱内看', en: 'Seen from inside', textZh: '主控室被一层层错开，机柜和墙壁像抽屉一样滑走，夕阳从裂开的缝隙里照进来。甲板上，被切断的油管起火，抛物面天线翻落运河。', textEn: 'The control room comes apart layer by layer; racks and walls slide away like drawers and the sunset pours in through the gaps. On deck, severed fuel lines ignite and the great dish tumbles into the canal.' },
    { t: 66, id: 'fan', zh: '铺开', en: 'Fanning out', textZh: '薄片像布一样柔软，前端滑上河岸，一层压着一层铺开。每个切面都光滑如镜，映着整片晚霞。', textEn: 'The sheets are soft as cloth; their leading edges ride up the bank, one layer draped over the next. Every cut face is smooth as a mirror and throws back the whole sunset.' },
    { t: 84, id: 'after', zh: '寂静', en: 'Silence', textZh: '行动结束。从接触到停下，不过一分多钟。', textEn: 'It is over. From first contact to rest: a little more than a minute.' },
  ];

  // ---------- film ----------
  const F = (from, to, st0, st1, cam, ease) => ({ from, to, time: f => lerp(st0, st1, (ease || (x => x))((f - from) / (to - from))), cam });
  const filmShots = [
    // cold open: the stack already coming apart
    F(0, 5, 57.2, 63.4, (u) => ({ pos: v3lerp([XS - 70, 31, -66], [XS - 22, 23, -62], easeOut(u, 2)), look: v3lerp([XS + 50, 9, 6], [XS + 78, 5, 12], u), fov: 46 })),
    F(5, 14, 0.3, 6.2, (u) => ({ pos: v3lerp([-492, 104, -52], [-404, 60, -26], easeInOut(u)), look: v3lerp([-90, 2, 0], [0, 10, 0], u), fov: 30 })),
    F(14, 24, 3.4, 10.9, (u) => ({ pos: v3lerp([19, 15.5, 36], [11, 13.6, 27], easeInOut(u)), look: v3lerp([-24, 12.5, -6], [-34, 12, -16], u), fov: 32 })),
    F(24, 32.2, 9.3, 13.98, (u, t) => ({ pos: v3lerp([64, 2.4, -40], [44, 3.6, -34], u), look: [shipX(t) + SHIP.half - 30, 11, 0], fov: 30 })),
    F(32.2, 40, 13.98, 17.4, (u) => ({ pos: v3lerp([15, 6.5, -30], [8.5, 9.5, -25.5], easeInOut(u)), look: v3lerp([0, 7.5, -9], [1, 12, -8], u), fov: 34 })),
    // inside: the room, the sweep, the stillness afterwards
    F(40, 46, 17.4, 19.96, (u, t) => roomCam(t, [lerp(36.6, 40.6, easeInOut(u)), 11.52, 0.18], [70, 11.75, -0.2], 54)),
    F(46, 55, 19.96, 24.45, (u, t) => roomCam(t, [lerp(40.6, 42.4, u), 11.5, 0.18], [70, 11.7, -0.2], lerp(54, 48, u))),
    F(55, 62, 24.45, 27.4, (u, t) => roomCam(t, v3lerp([60.2, 11.0, 2.6], [61.3, 11.08, 1.5], easeInOut(u)), v3lerp([63.9, 10.8, 0.9], [63.9, 10.74, 0.5], u), 40)),
    F(62, 70, 34.5, 44.6, (u, t) => ({ pos: v3lerp([-58, 30, 78], [-76, 44, 92], easeInOut(u)), look: v3lerp([4, 13, 6], [shipX(t) - 40, 12, 0], smooth(0.45, 1, u)), fov: 34 })),
    F(70, 76, 44.6, 47.96, (u, t) => ({ pos: [shipX(t) + 300 - 26 * u, 74 - 8 * u, 86 - 8 * u], look: lookShip(t, 10, 10), fov: 30 })),
    F(76, 80, 47.96, 52.5, (u) => ({ pos: v3lerp([XS - 46, 18, -64], [XS - 26, 21, -65], easeOut(u, 2)), look: v3lerp([XS + 56, 8, 8], [XS + 74, 6, 11], easeOut(u, 2)), fov: 50 })),
    F(80, 88, 49.4, 58, (u, t) => roomCam(t, [lerp(37.2, 39.4, u), 11.55, 0.5], [68, 11.35, 2.6], 62)),
    F(88, 96, 61, 73, (u) => ({ pos: v3lerp([XS - 118, 50, -34], [XS - 92, 60, -24], u), look: [XS + 120, 0, 20], fov: 40 })),
    F(96, 110, 84, 95.5, (u) => ({ pos: v3lerp([XS + 352, 44, 150], [XS + 262, 104, 204], easeInOut(u)), look: v3lerp([XS + 170, 0, 20], [XS + 150, 0, 16], u), fov: 40 })),
  ];
  const filmDef = {
    duration: 110, shots: filmShots,
    fade: ft => (1 - 0.82 * smooth(102.6, 104.2, ft)) * (1 - smooth(108.8, 109.9, ft)),
    titles: [
      { from: 5.5, to: 10.8, kind: 'title', no: '01', zh: '古筝行动', en: 'OPERATION GUZHENG', sub: '巴拿马运河 · 盖拉德水道' },
      { from: 15.0, to: 21.0, kind: 'caption', zh: '五十根纳米飞刃，间距半米', en: 'Fifty nano-filaments, half a metre apart' },
      { from: 25.0, to: 30.6, kind: 'caption', zh: '“审判日”号，六万吨', en: 'Judgment Day · 60,000 tons' },
      { from: 33.6, to: 38.6, kind: 'caption', zh: '没有声音，没有阻力', en: 'No sound. No resistance.' },
      { from: 41.0, to: 45.4, kind: 'caption', zh: '舱内 · 第二红岸基地主控室', en: 'Inside · control room, Second Red Coast Base' },
      { from: 56.0, to: 61.0, kind: 'caption', zh: '一切看起来完好无损', en: 'Everything still looks intact' },
      { from: 77.0, to: 79.7, kind: 'caption', zh: '像一叠被推开的扑克牌', en: 'Like a deck of cards, pushed forward' },
      { from: 89.0, to: 94.0, kind: 'caption', zh: '切面光滑如镜', en: 'Every cut face, smooth as a mirror' },
      { from: 103.4, to: 110, kind: 'end' },
    ],
  };

  return {
    id: 'guzheng', duration: T.end, scene, moments, focus, update, render, post, director, film: filmDef,
    resize: (w, h) => world.resize(w, h),
    toggles: [{ id: 'wires', zh: '标出飞刃', en: 'Highlight filaments', get: () => state.wiresOn > 0.5, set: v => { state.wiresOn = v ? 1 : 0; } }],
    orbitLimits: f => (f === 'room' ? { min: 0.6, max: 1400, minY: 1.2 } : { min: 6, max: 1400, minY: 1.2 }),
    debug: { world, ship, S, T, anchors: { zero: () => [0, 0, 0] } },
  };
}
