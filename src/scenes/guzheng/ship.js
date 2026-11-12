// "Judgment Day": a converted 60,000-ton tanker, built as a stack of 0.5 m sheets.
// Every solid is cut at the 50 filament heights at build time, so each sheet owns its top and bottom
// faces (the exposed "plan view" of the interior). One mesh, one draw call; the vertex shader moves
// and drapes each sheet from per-sheet uniforms.
import * as THREE from 'three';
import { clamp } from '../../core/util.js';
import { WIRES, NSLAB, SHIP, slabOf, patchStd, depthFor } from './common.js';

export const MAT = { HULL: 0, DECK: 1, HOUSE: 2, FUNNEL: 3, PIPE: 4, CRANE: 5, DISH: 6, BOAT: 7, MAST: 8, CAP: 9, BASEHOUSE: 10 };

// ---------- hull form ----------
export function halfBeam(lx, y) {
  const yN = clamp((y - SHIP.keel) / (SHIP.deck - SHIP.keel), 0, 1.2);
  const rake = 6.5 * (1 - Math.min(1, yN));
  let p = 1;
  const bowLen = 54, b0 = SHIP.half - bowLen - rake;
  if (lx > b0) { const q = clamp((lx - b0) / bowLen, 0, 1); p = Math.pow(Math.max(0, 1 - Math.pow(q, 2.3)), 0.56); }
  if (lx < -76) { const q = clamp((-76 - lx) / 44, 0, 1); p = 1 - (0.26 + 0.55 * Math.pow(1 - Math.min(1, yN), 2)) * q * q; }
  const bilge = Math.pow(clamp((y - SHIP.keel) / 2.6, 0, 1), 0.5);
  return SHIP.beam * p * (0.8 + 0.2 * bilge);
}
const bowX = y => SHIP.half - 6.5 * (1 - clamp((y - SHIP.keel) / (SHIP.deck - SHIP.keel), 0, 1));

function hullStations(y, x0 = -SHIP.half, n = 104) {
  const x1 = bowX(y), out = [];
  for (let i = 0; i <= n; i++) {
    let f = i / n; f = f < 0.5 ? f : 1 - Math.pow(1 - f, 1.35) * Math.pow(0.5, -0.35);   // denser toward the bow
    const x = x0 + (x1 - x0) * clamp(f, 0, 1), hb = halfBeam(x, y);
    out.push([x, -hb, hb]);
  }
  return out;
}

// ---------- sheet builder ----------
class Builder {
  constructor() { this.pos = []; this.nor = []; this.slab = []; this.info = []; this.foot = []; this.idx = []; }
  v(p, n, slab, mat, cap, tower) {
    this.pos.push(p[0], p[1], p[2]); this.nor.push(n[0], n[1], n[2]); this.slab.push(slab);
    this.info.push(mat, cap, tower.base, tower.front); this.foot.push(...tower.foot);
    return this.pos.length / 3 - 1;
  }
  quad(p0, p1, p2, p3, out, slab, mat, cap, tower, normals) {
    const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2], bx = p3[0] - p0[0], by = p3[1] - p0[1], bz = p3[2] - p0[2];
    let n = [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
    let l = Math.hypot(n[0], n[1], n[2]);
    if (l < 1e-9) { // degenerate at p0/p3 -> use the other corner
      const cx = p2[0] - p1[0], cy = p2[1] - p1[1], cz = p2[2] - p1[2];
      n = [-(cy * az - cz * ay), -(cz * ax - cx * az), -(cx * ay - cy * ax)]; l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-9) return;
    }
    n = [n[0] / l, n[1] / l, n[2] / l];
    const flip = n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0;
    if (flip) n = [-n[0], -n[1], -n[2]];
    const P = [p0, p1, p2, p3], id = P.map((p, i) => this.v(p, normals ? normals[i] : n, slab, mat, cap, tower));
    if (flip) this.idx.push(id[0], id[2], id[1], id[0], id[3], id[2]); else this.idx.push(id[0], id[1], id[2], id[0], id[2], id[3]);
  }
  // st(y) -> [[x, z0, z1], ...] with x increasing; the station count must not depend on y.
  solid({ st, y0, y1, mat, topMat, capMat = MAT.CAP, tower, nz = 1, ySeg = 1e9, normalFn, noBottom = true, noTop = false, hullFoot = false }) {
    const cuts = [y0];
    for (let k = 0; k < WIRES.n; k++) { const y = WIRES.y0 + k * WIRES.h; if (y > y0 + 1e-4 && y < y1 - 1e-4) cuts.push(y); }
    cuts.push(y1);
    const isCut = y => Math.abs((y - WIRES.y0) / WIRES.h - Math.round((y - WIRES.y0) / WIRES.h)) < 1e-6 && y >= WIRES.y0 - 1e-6 && y <= WIRES.y0 + (WIRES.n - 1) * WIRES.h + 1e-6;
    tower = { ...(tower || { base: slabOf(y0 + 1e-3), front: 0 }) };
    // footprint of this solid (rear, front, zmin, zmax): the same solid in the sheets below is what holds a vertex up
    { const S0 = st((y0 + y1) / 2), m = 0.35; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const q of S0) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[2]); }
      tower.foot = hullFoot ? [x0 - m, 200, -1000, 0] : [x0 - m, x1 + m, z0 - m, z1 + m]; }
    for (let c = 0; c < cuts.length - 1; c++) {
      const ya0 = cuts[c], yb0 = cuts[c + 1], k = slabOf((ya0 + yb0) / 2);
      const sub = Math.max(1, Math.ceil((yb0 - ya0) / ySeg));
      for (let s = 0; s < sub; s++) {
        const ya = ya0 + (yb0 - ya0) * s / sub, yb = ya0 + (yb0 - ya0) * (s + 1) / sub;
        const A = st(ya), B = st(yb), n = A.length;
        for (let i = 0; i < n - 1; i++) {
          for (const side of [1, -1]) {
            const zi = side > 0 ? 2 : 1;
            const p0 = [A[i][0], ya, A[i][zi]], p1 = [A[i + 1][0], ya, A[i + 1][zi]], p2 = [B[i + 1][0], yb, B[i + 1][zi]], p3 = [B[i][0], yb, B[i][zi]];
            const nn = normalFn ? [p0, p1, p2, p3].map(p => normalFn(p[0], p[1], side, p[2])) : null;
            this.quad(p0, p1, p2, p3, [0, 0, side], k, mat, 0, tower, nn);
          }
        }
        for (const [i, dir] of [[0, -1], [n - 1, 1]]) {
          if (Math.abs(A[i][2] - A[i][1]) < 1e-3 && Math.abs(B[i][2] - B[i][1]) < 1e-3) continue;
          this.quad([A[i][0], ya, A[i][1]], [A[i][0], ya, A[i][2]], [B[i][0], yb, B[i][2]], [B[i][0], yb, B[i][1]], [dir, 0, 0], k, mat, 0, tower);
        }
        const cap = (S, y, up, m, capFlag) => {
          for (let i = 0; i < S.length - 1; i++) for (let j = 0; j < nz; j++) {
            const f0 = j / nz, f1 = (j + 1) / nz, a = S[i], b = S[i + 1];
            const z = (q, f) => q[1] + (q[2] - q[1]) * f;
            this.quad([a[0], y, z(a, f0)], [b[0], y, z(b, f0)], [b[0], y, z(b, f1)], [a[0], y, z(a, f1)], [0, up, 0], k, m, capFlag, tower);
          }
        };
        if (s === sub - 1) {
          if (c === cuts.length - 2) { if (!noTop) cap(B, yb, 1, topMat ?? mat, 0); } else if (isCut(yb)) cap(B, yb, 1, capMat, 1);
        }
        if (s === 0) {
          if (c === 0) { if (!noBottom) cap(A, ya, -1, mat, 0); } else if (isCut(ya)) cap(A, ya, -1, capMat, 1);
        }
      }
    }
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('aSlab', new THREE.Float32BufferAttribute(this.slab, 1));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
    g.setAttribute('aFoot', new THREE.Float32BufferAttribute(this.foot, 4));
    g.setIndex(this.idx);
    return g;
  }
}

const box = (x0, x1, z0, z1, dx = 3) => {
  const n = Math.max(1, Math.ceil((x1 - x0) / dx)), s = [];
  for (let i = 0; i <= n; i++) s.push([x0 + (x1 - x0) * i / n, z0, z1]);
  return () => s;
};
const cyl = (cx, cz, rx, rz, n = 12) => {
  const s = [];
  for (let i = 0; i <= n; i++) { const a = Math.PI * i / n; s.push([cx - rx * Math.cos(a), cz - rz * Math.sin(a), cz + rz * Math.sin(a)]); }
  return () => s;
};
const cylNormal = (cx, cz, rx, rz) => (x, y, side, z) => { const nx = (x - cx) / (rx * rx), nzv = (z - cz) / (rz * rz), l = Math.hypot(nx, nzv) || 1; return [nx / l, 0, nzv / l]; };

export function buildShip() {
  const b = new Builder(), D = SHIP.deck;
  const hullN = (x, y, side) => {
    const e = 0.4, hx = (halfBeam(x + e, y) - halfBeam(x - e, y)) / (2 * e), hy = (halfBeam(x, y + e) - halfBeam(x, y - e)) / (2 * e);
    const l = Math.hypot(hx, hy, 1); return [-hx / l, -hy / l, side / l];
  };
  const hullTower = { base: 1, front: SHIP.half };
  // hull, forecastle
  b.solid({ st: y => hullStations(y), y0: SHIP.keel, y1: D, mat: MAT.HULL, topMat: MAT.DECK, tower: hullTower, nz: 6, ySeg: 1.2, normalFn: hullN, noBottom: false, hullFoot: true });
  b.solid({ st: y => hullStations(Math.min(y, D), 86, 22), y0: D, y1: D + 3, mat: MAT.HULL, topMat: MAT.DECK, tower: { base: slabOf(D + 1e-3), front: SHIP.half }, nz: 4, normalFn: (x, y, s) => hullN(x, D - 0.2, s), hullFoot: true });

  // aft: poop deck, accommodation, bridge, funnel, mast
  const aft = { base: slabOf(D + 1e-3), front: -62 };
  const poopSt = y => { const s = []; for (let i = 0; i <= 20; i++) { const x = -119.5 + 57.5 * i / 20, hb = Math.min(15.6, halfBeam(x, D) - 0.6); s.push([x, -hb, hb]); } return s; };
  b.solid({ st: poopSt, y0: D, y1: D + 3, mat: MAT.HOUSE, topMat: MAT.DECK, tower: aft, nz: 3 });
  const P = D + 3;                                               // 12.5
  b.solid({ st: box(-104, -72, -14, 14), y0: P, y1: P + 15, mat: MAT.HOUSE, topMat: MAT.DECK, tower: aft, nz: 3 });
  b.solid({ st: box(-100, -76, -19, 19), y0: P + 15, y1: P + 18, mat: MAT.HOUSE, tower: aft, nz: 3 });
  b.solid({ st: box(-96, -80, -8, 8), y0: P + 18, y1: P + 19.2, mat: MAT.HOUSE, tower: aft, nz: 2 });
  b.solid({ st: cyl(-112, 0, 4.2, 3.4, 14), y0: P, y1: 37, mat: MAT.FUNNEL, tower: aft, nz: 2, normalFn: cylNormal(-112, 0, 4.2, 3.4) });
  b.solid({ st: box(-88.6, -87.4, -0.6, 0.6), y0: P + 19.2, y1: 42, mat: MAT.MAST, tower: aft });
  b.solid({ st: box(-88.3, -87.7, -4.2, 4.2), y0: 38, y1: 38.5, mat: MAT.MAST, tower: aft });
  b.solid({ st: cyl(-84, 5, 2.1, 2.1, 10), y0: P + 19.2, y1: P + 22.6, mat: MAT.DISH, tower: aft, normalFn: cylNormal(-84, 5, 2.1, 2.1) });
  for (const z of [-16.4, 13.8]) b.solid({ st: box(-99, -90, z, z + 2.6), y0: P + 3.5, y1: P + 6.3, mat: MAT.BOAT, tower: aft });
  for (let d = 1; d <= 5; d++) b.solid({ st: box(-105.2, -70.6, -15.3, 15.3), y0: P + 3 * d - 0.22, y1: P + 3 * d, mat: MAT.HOUSE, tower: aft, nz: 3 });   // deck overhangs
  b.solid({ st: box(-118, -106, -9, 9), y0: P, y1: P + 6, mat: MAT.HOUSE, topMat: MAT.DECK, tower: aft, nz: 2 });                                       // engine casing
  for (const z of [-1.3, 1.3]) b.solid({ st: cyl(-112, z, 0.7, 0.7, 6), y0: 37, y1: 38.6, mat: MAT.PIPE, tower: aft, normalFn: cylNormal(-112, z, 0.7, 0.7) });
  for (const z of [-11, 11]) b.solid({ st: cyl(-66, z, 1.1, 1.1, 8), y0: P, y1: P + 1.6, mat: MAT.PIPE, tower: aft, normalFn: cylNormal(-66, z, 1.1, 1.1) }); // mooring winches
  for (const z of [-13.6, 13.6]) b.solid({ st: box(-101, -75, z - 0.12, z + 0.12, 4), y0: P + 15, y1: P + 16.1, mat: MAT.HOUSE, tower: aft });         // bridge-deck bulwark

  // cargo deck: pipe runs, manifold, hatches, catwalk, hose cranes
  const deckT = front => ({ base: slabOf(D + 1e-3), front });
  for (const z of [-2.6, -1.3, 0, 1.3, 2.6]) b.solid({ st: box(-58, 24, z - 0.38, z + 0.38, 4), y0: D + 0.5, y1: D + 1.25, mat: MAT.PIPE, tower: deckT(24) });
  b.solid({ st: box(-8, -3, -15.5, 15.5, 2.5), y0: D, y1: D + 2.1, mat: MAT.PIPE, tower: deckT(-3), nz: 4 });
  b.solid({ st: box(-58, 24, 5.4, 6.5, 4), y0: D + 2.2, y1: D + 2.5, mat: MAT.MAST, tower: deckT(24) });
  for (let i = 0; i < 5; i++) for (const z of [-10, 10]) {
    const x = -50 + i * 15.5;
    b.solid({ st: cyl(x, z, 1.5, 1.5, 8), y0: D, y1: D + 0.85, mat: MAT.PIPE, tower: deckT(x + 1.5), normalFn: cylNormal(x, z, 1.5, 1.5) });
  }
  for (const z of [-9.5, 9.5]) {
    b.solid({ st: cyl(-14, z, 1.25, 1.25, 8), y0: D, y1: D + 8.5, mat: MAT.CRANE, tower: deckT(-12.7), normalFn: cylNormal(-14, z, 1.25, 1.25) });
    b.solid({ st: box(-15.5, 3, z - 0.7, z + 0.7), y0: D + 7.2, y1: D + 8.6, mat: MAT.CRANE, tower: deckT(3) });
  }

  // the Second Red Coast Base: mid-forward deckhouse, antenna pedestal
  const base = deckT(72);
  b.solid({ st: box(34, 72, -13.5, 13.5), y0: D, y1: D + 8, mat: MAT.BASEHOUSE, topMat: MAT.DECK, tower: base, nz: 3 });
  b.solid({ st: box(40, 62, -9, 9), y0: D + 8, y1: D + 11, mat: MAT.BASEHOUSE, tower: base, nz: 2 });
  b.solid({ st: cyl(51, 0, 3.4, 3.4, 12), y0: D + 11, y1: 27.4, mat: MAT.MAST, tower: base, nz: 2, normalFn: cylNormal(51, 0, 3.4, 3.4) });
  for (const [x, z, r, h] of [[66, -8, 2.4, 4.2], [66, 8, 1.7, 3]]) b.solid({ st: cyl(x, z, r, r, 8), y0: D + 8, y1: D + 8 + h, mat: MAT.DISH, tower: base, normalFn: cylNormal(x, z, r, r) });

  // forecastle gear: windlasses, bulwark
  const fc = { base: slabOf(D + 1e-3), front: SHIP.half };
  for (const z of [-5, 5]) b.solid({ st: box(96, 100, z - 1.6, z + 1.6), y0: D + 3, y1: D + 4.7, mat: MAT.PIPE, tower: fc });
  b.solid({ st: cyl(108, 0, 1.3, 1.3, 8), y0: D + 3, y1: D + 4.2, mat: MAT.PIPE, tower: fc, normalFn: cylNormal(108, 0, 1.3, 1.3) });
  // midship cross-deck pipe bridge and vents
  for (const x of [-34, 12]) b.solid({ st: box(x, x + 1.2, -12, 12, 2), y0: D + 1.3, y1: D + 2.0, mat: MAT.PIPE, tower: deckT(x + 1.2), nz: 3 });
  for (const [x, z] of [[-26, -6], [-26, 6], [18, -7], [18, 7], [-46, 0]]) b.solid({ st: cyl(x, z, 0.55, 0.55, 6), y0: D, y1: D + 3.4, mat: MAT.MAST, tower: deckT(x + 0.6), normalFn: cylNormal(x, z, 0.55, 0.55) });
  // foremast (the part above the top filament is a separate rigid piece)
  b.solid({ st: box(101.6, 102.4, -0.4, 0.4), y0: D + 3, y1: WIRES.y0 + (WIRES.n - 1) * WIRES.h, mat: MAT.MAST, tower: { base: slabOf(D + 1e-3), front: SHIP.half } });
  return b.geometry();
}

// ---------- shaders ----------
export const DEFORM_PARS = /* glsl */`
attribute float aSlab; attribute vec4 aInfo; attribute vec4 aFoot;
uniform vec4 uSlab[${NSLAB}];          // x, z, yaw, lift
uniform sampler2D uHeight; uniform vec4 uHeightRect;   // x0, z0, 1/w, 1/d
uniform float uSoft, uRipple;
float groundAt(vec2 xz){
  float h = texture2D(uHeight, (xz - uHeightRect.xy) * uHeightRect.zw).r;
  float wob = uRipple * (sin(xz.x * 0.071 + xz.y * 0.043) * 0.5 + sin(xz.x * 0.19 - xz.y * 0.11 + 1.7) * 0.22);
  return max(h, -1.3) + wob;
}
// deck-level outline of the hull (a little generous, so an intact ship never sags)
float hullHalf(float lx){
  float p = 1.;
  if (lx > 66.) p = pow(max(0., 1. - pow(clamp((lx - 66.) / 54., 0., 1.), 2.3)), .56);
  if (lx < -76.) { float q = clamp((-76. - lx) / 44., 0., 1.); p = 1. - .26 * q * q; }
  return ${SHIP.beam.toFixed(1)} * p + .45;
}
// how much of sheet j lies under world point xz (0..1), for a vertex of a higher sheet
float under(int j, vec2 xz){
  vec4 s = uSlab[j]; vec2 d = xz - s.xy; float c = cos(s.z), sn = sin(s.z);
  float lx = d.x * c + d.y * sn, lz = -d.x * sn + d.y * c;
  bool hull = float(j) < aInfo.z || aFoot.z < -900.;
  float rear = hull ? -${(SHIP.half + 0.5).toFixed(1)} : aFoot.x, front = hull ? ${(SHIP.half + 0.5).toFixed(1)} : aFoot.y;
  float side = hull ? hullHalf(lx) - abs(lz) : min(lz - aFoot.z, aFoot.w - lz);
  return smoothstep(-uSoft, 0., front - lx) * smoothstep(-uSoft, 0., lx - rear) * smoothstep(-uSoft * .6, 0., side);
}
vec3 sheet(vec3 p){
  int k = int(aSlab + 0.5);
  vec4 s = uSlab[k];
  float c = cos(s.z), sn = sin(s.z);
  vec2 xz = s.xy + vec2(c * p.x - sn * p.z, sn * p.x + c * p.z);
  if (k == 0) return vec3(xz.x, p.y + s.w, xz.y);
  float cnt = 0.;
  for (int j = 1; j < ${NSLAB - 1}; j++) { if (j >= k) break; cnt += under(j, xz); }
  // the unsliced bottom of the hull is still afloat underneath
  vec4 s0 = uSlab[0]; vec2 d0 = xz - s0.xy; float c0 = cos(s0.z), sn0 = sin(s0.z); float lx0 = d0.x * c0 + d0.y * sn0, lz0 = -d0.x * sn0 + d0.y * c0;
  float sb = smoothstep(-uSoft, 0., ${(SHIP.half + 0.5).toFixed(1)} - lx0) * smoothstep(-uSoft, 0., lx0 + ${(SHIP.half + 0.5).toFixed(1)}) * smoothstep(-uSoft * .6, 0., hullHalf(lx0) - abs(lz0));
  float S = mix(groundAt(xz), ${WIRES.y0.toFixed(2)} + uSlab[0].w, sb);
  float lo = ${WIRES.y0.toFixed(2)} + (aSlab - 1.) * ${WIRES.h.toFixed(2)};
  return vec3(xz.x, S + ${WIRES.h.toFixed(2)} * cnt + (p.y - lo), xz.y);
}`;
export const DEFORM = /* glsl */`
vec3 dP = sheet(position);
vec3 dN;
{
  float yaw = uSlab[int(aSlab + 0.5)].z; float c = cos(yaw), sn = sin(yaw);
  vec3 n0 = vec3(c * normal.x - sn * normal.z, normal.y, sn * normal.x + c * normal.z);
  if (abs(normal.y) > 0.5) {
    vec3 ex = sheet(position + vec3(0.6, 0., 0.)) - dP, ez = sheet(position + vec3(0., 0., 0.6)) - dP;
    dN = normalize(cross(ez, ex)) * sign(normal.y);
  } else dN = n0;
}`;

const SURFACE_PARS = /* glsl */`
varying vec3 vL; varying vec4 vInfo; varying float vSlab; varying vec3 vN0;
uniform sampler2D uName; uniform float uCutX; uniform float uShipX; uniform float uLit;
float boxMask(vec2 p, vec2 a, vec2 b){ vec2 s = step(a, p) * step(p, b); return s.x * s.y; }
float lineAA(float x, float period, float w){ float f = abs(fract(x / period + .5) - .5) * period; float aa = fwidth(x) * 1.2; return (1. - smoothstep(w, w + aa, f)) * min(1., 2.5 * w / max(aa, 1e-5)); }
`;
const SURFACE = /* glsl */`
{
  int m = int(vInfo.x + .5);
  vec3 L = vL; vec3 alb = vec3(.5); float rough = .6, metal = 0.;
  float nz1 = vnoise(L.xy * .35) * .6 + vnoise(L.xy * 1.7 + 7.) * .4, nz2 = vnoise(L.xz * .5 + 3.);
  bool side = abs(vN0.y) < .5;
  float h = abs(vN0.z) > abs(vN0.x) ? L.x : L.z;                    // horizontal coordinate along a wall
  if (vInfo.y > .5) {
    // --- exposed cut face: a plan view of whatever was at this height ---
    vec2 q = L.xz; float house = step(${(SHIP.deck + 0.1).toFixed(2)}, L.y);
    vec2 cell = mix(vec2(9.6, 8.5), vec2(3.6, 3.1), house);
    vec2 id = floor(q / cell); float r = hash12(id + floor(vSlab * .25) * 7.);
    float wall = max(lineAA(q.x + (hash11(id.y) - .5) * cell.x * .5 * house, cell.x, .055), lineAA(q.y, cell.y, .055));
    float frames = lineAA(q.x, 0.8, .02) * (1. - house) * .16;
    // the filaments leave a cut as smooth as a mirror: bare steel that throws back the whole sky
    float sheetTone = .82 + .3 * hash11(vSlab * 7.13);
    vec3 steelC = vec3(.80, .79, .77) * sheetTone;
    vec3 fill = mix(mix(vec3(.30, .29, .28), vec3(.42, .25, .16), step(.72, r)), mix(vec3(.5, .49, .46), vec3(.36, .42, .47), step(.5, fract(r * 7.))), house);
    alb = mix(steelC, fill, .55 + .25 * vnoise(q * 1.3));
    rough = mix(.16, .34, vnoise(q * .7 + r * 9.)); metal = .92;
    float steel = max(wall, frames);
    alb = mix(alb, steelC * 1.1, steel); rough = mix(rough, .07, steel); metal = mix(metal, 1., steel);
    float gear = step(.9, hash12(floor(q / 1.6) + vSlab)) * (1. - house) * step(r, .3);                     // machinery, valves
    alb = mix(alb, mix(vec3(.5, .08, .04), vec3(.42, .33, .05), step(.5, fract(r * 13.))), gear * .7); metal *= 1. - gear * .6;
  } else if (m == 0) {
    // --- hull plating ---
    float boot = smoothstep(2.9, 3.0, L.y);
    alb = mix(vec3(.30, .052, .04), vec3(.022, .026, .034), boot);
    alb = mix(alb, vec3(.5, .5, .48), boxMask(vec2(L.y, 0.), vec2(3.0, -1.), vec2(3.22, 1.)));
    alb *= .82 + .3 * hash12(floor(vec2(h / 9., L.y / 2.6)));
    float seams = max(lineAA(L.y, 2.6, .02), lineAA(h + floor(L.y / 2.6) * 4.5, 9., .02));
    alb *= 1. - .35 * seams;
    float streak = smoothstep(.72, .98, vnoise(vec2(h * 2.3, L.y * .05))) * smoothstep(9.6, 3., L.y) * smoothstep(.5, 3.5, L.y) * (.4 + .6 * nz1);
    alb = mix(alb, vec3(.16, .07, .035), streak * .38);
    alb = mix(alb, vec3(.10, .09, .05), smoothstep(2.2, .2, L.y) * .55 * (.6 + .4 * nz1));        // waterline grime
    rough = mix(.38, .7, streak) + .15 * nz1;
    if (side && L.x > 62. && L.x < 104. && L.y > 5.4 && L.y < 8.2) {                              // ship's name, both bows
      vec2 uv = vec2((L.x - 62.) / 42., (L.y - 5.4) / 2.8); if (vN0.z < 0.) uv.x = 1. - uv.x;
      alb = mix(alb, vec3(.8), texture2D(uName, uv).r * .92);
    }
    gBump = vec3(0., (vnoise(vec2(h * .25, L.y * .9)) - .5) * .05, 0.);
  } else if (m == 1) {
    alb = vec3(.19, .066, .052) * (.6 + .55 * nz2) * (.8 + .4 * vnoise(L.xz * 3.1));
    alb = mix(alb, vec3(.085, .07, .06), smoothstep(.42, .85, vnoise(L.xz * .16) * .6 + vnoise(L.xz * .9 + 4.) * .4) * .7);
    alb = mix(alb, vec3(.2, .11, .06), smoothstep(.6, .9, vnoise(L.xz * .45 + 20.)) * .5);                  // rust blooms
    alb = mix(alb, vec3(.62, .5, .08), lineAA(L.z - 7.8, 400., .12) * step(-60., L.x) * step(L.x, 80.) * .8);
    alb *= 1. - .3 * lineAA(L.x, 4.8, .03);
    rough = .62 + .25 * nz2;
  } else if (m == 2 || m == 10) {
    // --- deckhouses: white steel, window rows; some lit ---
    alb = vec3(.74, .74, .71) * (.9 + .12 * nz1);
    float base = m == 2 ? ${(SHIP.deck + 3).toFixed(2)} : ${SHIP.deck.toFixed(2)};
    float dk = floor((L.y - base) / 3.), fy = L.y - base - dk * 3.;
    if (side && L.y > base) {
      bool bridge = m == 2 && L.y > ${(SHIP.deck + 18).toFixed(2)};
      float per = bridge ? 1.7 : 2.4, ww = bridge ? .74 : .36;
      float wx = abs(fract(h / per) - .5) * per, wid = floor(h / per) + dk * 31. + step(0., vN0.z) * 57. + step(.5, abs(vN0.x)) * 13.;
      float inY = bridge ? smoothstep(.9, .98, fy) * smoothstep(2.35, 2.27, fy) : smoothstep(1.25, 1.3, fy) * smoothstep(2.05, 2.0, fy);
      float frame = (bridge ? 0. : 1.) * (1. - smoothstep(ww + .08, ww + .12, wx)) * smoothstep(1.13, 1.17, fy) * smoothstep(2.17, 2.13, fy);
      float has = (m == 10) ? step(.55, hash11(wid)) : 1.;
      float win = inY * (1. - smoothstep(ww - .04, ww, wx)) * has;
      float lit = step(bridge ? .9 : .8, hash11(wid * 1.37 + 5.)) * uLit;
      alb = mix(alb, alb * .72, frame * has * (1. - win)); alb = mix(alb, vec3(.015, .02, .028), win); rough = mix(.55, .06, win);
      alb *= 1. - .1 * lineAA(h, 4.8, .012);                                                           // plate seams
      alb = mix(alb, vec3(.5, .52, .5), lineAA(fy - 1.02, 30., .035) * .0);
      gEmis = win * lit * vec3(1., .6, .28) * 1.1 * (.6 + .4 * hash11(wid * 3.1));
      alb *= 1. - .22 * smoothstep(.12, 0., fy) ;                                                    // deck edge line
      float drip = smoothstep(.5, 1., vnoise(vec2(h * 1.3, L.y * .08))) * .35;
      alb = mix(alb, vec3(.33, .2, .1), drip * smoothstep(1.2, .2, fy));
    } else rough = .6;
  } else if (m == 3) {
    alb = mix(vec3(.035, .06, .13), vec3(.02), smoothstep(34.2, 34.4, L.y));
    alb = mix(alb, vec3(.78, .76, .7), smoothstep(28.5, 28.6, L.y) * smoothstep(31.1, 31., L.y));
    alb = mix(alb, vec3(.6, .07, .04), smoothstep(29.4, 29.5, L.y) * smoothstep(30.2, 30.1, L.y));
    alb = mix(alb, vec3(.02), smoothstep(.4, 1., vnoise(vec2(h * .6, L.y * .1))) * smoothstep(30., 37., L.y) * .7);
    rough = .5;
  } else if (m == 4) { alb = vec3(.36, .37, .38) * (.8 + .4 * nz2); alb = mix(alb, vec3(.34, .08, .05), step(.9, hash11(floor(L.x / 5.2)))); alb *= .8 + .4 * vnoise(L.xz * 2.7); rough = .5; metal = .45; }
  else if (m == 5) { alb = vec3(.72, .46, .04) * (.85 + .25 * nz1); rough = .5; }
  else if (m == 6) { alb = vec3(.82, .82, .8); rough = .42; }
  else if (m == 7) { alb = vec3(.86, .22, .03); rough = .45; }
  else { alb = vec3(.6, .61, .6) * (.85 + .2 * nz1); rough = .5; metal = .3; }

  // filament seams: appear only on the part of the ship that has already crossed the wire plane
  if (vInfo.y < .5 && side) {
    float fy = (L.y - ${WIRES.y0.toFixed(2)}) / ${WIRES.h.toFixed(2)};
    float inWire = step(-.01, fy) * step(fy, ${(WIRES.n - 1).toFixed(1)} + .01);
    float d = abs(fract(fy + .5) - .5) * ${WIRES.h.toFixed(2)}, aa = fwidth(L.y) * 1.1;
    float seam = (1. - smoothstep(.006, .012 + aa, d)) * inWire * min(1., .03 / max(aa, 1e-5));
    float passed = smoothstep(0., .25, (uShipX + L.x) - uCutX);
    float hot = exp(-max(0., (uShipX + L.x) - uCutX) * .55) * passed;
    alb *= 1. - seam * passed * .5;
    gEmis += seam * hot * vec3(1.6, .75, .25) * 1.2;
  }
  diffuseColor.rgb = alb; gRough = clamp(rough, .04, 1.); gMetal = metal;
}`;

export function makeNameTexture(text = 'JUDGMENT DAY') {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 1024, 64);
  g.fillStyle = '#fff'; g.font = '700 54px "Helvetica Neue", Arial, sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.save(); g.translate(512, 34); g.scale(1.0, 1); g.fillText(text.split('').join(' '), 0, 0, 1000); g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function makeShip({ heightTex, heightRect }) {
  const geo = buildShip();
  const slabs = Array.from({ length: NSLAB }, () => new THREE.Vector4());
  const uniforms = {
    uSlab: { value: slabs }, uHeight: { value: heightTex }, uHeightRect: { value: heightRect },
    uSoft: { value: 7 }, uRipple: { value: 0 }, uName: { value: makeNameTexture() }, uCutX: { value: 0 }, uShipX: { value: 0 }, uLit: { value: 1 },
  };
  const vertPars = DEFORM_PARS + '\nvarying vec3 vL; varying vec4 vInfo; varying float vSlab; varying vec3 vN0;';
  const vertDeform = DEFORM + '\nvL = position; vInfo = aInfo; vSlab = aSlab; vN0 = normal;';
  const mat = patchStd(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, envMapIntensity: 1 }), {
    key: 'ship', uniforms, vertPars, vertDeform, fragPars: SURFACE_PARS, fragSurface: SURFACE,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.customDepthMaterial = depthFor({ key: 'ship', uniforms, vertPars: DEFORM_PARS, vertDeform: DEFORM });
  return { mesh, uniforms, slabs, tris: geo.index.count / 3 };
}

// The big parabolic antenna and the foremast top are rigid pieces that ride on the top sheet until they fall.
export function makeDish() {
  const g = new THREE.Group();
  const white = patchStd(new THREE.MeshStandardMaterial({ color: 0xd9d9d4, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide }));
  const steel = patchStd(new THREE.MeshStandardMaterial({ color: 0x8b8e90, roughness: 0.45, metalness: 0.6 }));
  const R = 13.5, depth = 4.2, pts = [];
  for (let i = 0; i <= 24; i++) { const r = R * i / 24; pts.push(new THREE.Vector2(r, depth * (r / R) ** 2)); }
  const bowl = new THREE.Mesh(new THREE.LatheGeometry(pts, 56), white); bowl.castShadow = true; bowl.receiveShadow = true;
  const tilt = new THREE.Group(); tilt.add(bowl);
  const focus = R * R / (4 * depth);
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 4, from = new THREE.Vector3(Math.cos(a) * R * 0.8, depth * 0.64, Math.sin(a) * R * 0.8), to = new THREE.Vector3(0, focus, 0);
    const len = from.distanceTo(to), s = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, len, 6), steel);
    s.position.copy(from).lerp(to, 0.5); s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize()); s.castShadow = true; tilt.add(s);
  }
  const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.5, 1.8, 10), steel); horn.position.y = focus; horn.castShadow = true; tilt.add(horn);
  // back-frame ribs
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6, rib = new THREE.Mesh(new THREE.BoxGeometry(R * 0.86, 0.5, 0.22), steel);
    rib.position.set(Math.cos(a) * R * 0.45, depth * 0.2 - 0.55, Math.sin(a) * R * 0.45); rib.rotation.y = -a; rib.rotation.z = 0.3; rib.castShadow = true; tilt.add(rib);
  }
  const yoke = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 3.6, 12), steel); yoke.position.y = 1.2; yoke.castShadow = true;
  tilt.position.y = 3.4; tilt.rotation.z = -0.62;                      // look up and forward
  g.add(yoke, tilt);
  return g;
}

export function makeMastTop() {
  const g = new THREE.Group();
  const m = patchStd(new THREE.MeshStandardMaterial({ color: 0xa9abaa, roughness: 0.5, metalness: 0.3 }));
  const pole = new THREE.Mesh(new THREE.BoxGeometry(0.8, 9.5, 0.8), m); pole.position.y = 4.75; pole.castShadow = true;
  const yard = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 7), m); yard.position.y = 6.2; yard.castShadow = true;
  const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 6.5, 5), m); whip.position.y = 12.6; whip.castShadow = true;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 3.4) })); lamp.position.y = 9.9;
  g.add(pole, yard, whip, lamp);
  return g;
}
