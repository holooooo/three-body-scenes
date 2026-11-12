// GLSL shared by the planets, their flat images and the witness city.
import { GLSL_NOISE } from '../../core/util.js';

// Planet surfaces as a function of a point on the unit sphere. The round planet and its flat image both call
// surf(), so whatever flows on the sphere keeps flowing after it has been laid into the plane.
export const SURF_GLSL = /* glsl */`
${GLSL_NOISE}
uniform vec3 uA, uB, uC; uniform float uType, uSeed, uTime, uVort;
// local frame of a storm: xy in storm radii (east, north), z = distance in radii
vec3 vort(vec3 p, float lat0, float lon0, vec2 rad){
  vec3 c = vec3(cos(lat0) * cos(lon0), sin(lat0), cos(lat0) * sin(lon0));
  vec3 e = normalize(cross(vec3(0., 1., 0.), c)), n = cross(c, e), d = p - c;
  vec2 uv = vec2(dot(d, e) / rad.x, dot(d, n) / rad.y); return vec3(uv, length(uv) + step(dot(p, c), 0.) * 9.);
}
// a rigidly turning logarithmic spiral: reads as rotation for ever without winding itself up
float spiral(vec3 v, float turn, float arms, float wind){ return sin((atan(v.y, v.x) + turn - wind * log(v.z + .12)) * arms) * .5 + .5; }

void surf(vec3 p, out vec3 alb, out float spec, out float atmo, out vec3 atmoC, out float water, out float lights){
  float lat = asin(clamp(p.y, -1., 1.)), lon = atan(p.z, p.x); vec3 q = p * 3. + uSeed;
  spec = 0.; atmo = 0.; atmoC = vec3(.4, .6, 1.); water = 0.; lights = 0.;
  if (uType < .5) {                                           // airless / thin-air rock
    float n = fbm3(q * 1.6), c = fbm3(q * 5.), cr = smoothstep(.62, .7, vnoise3(q * 7.)) * .5;
    alb = mix(uB, uA, smoothstep(.3, .7, n)); alb = mix(alb, uC, smoothstep(.5, .85, c) * .6); alb *= 1. - cr * .4;
  } else if (uType < 1.5) {                                   // Earth
    float lf = fbm3(q * 1.25 + 2.) + .1 * fbm3(q * 6.);
    float land = smoothstep(.52, .56, lf);
    float ice = smoothstep(.93, .985, abs(p.y) + .06 * fbm3(q * 4.));
    alb = mix(uA * (.7 + .6 * fbm3(q * 4.)), mix(uB, uC, smoothstep(.4, .7, fbm3(q * 3.3) + .3 * (1. - abs(p.y) * 1.6))), land);
    alb = mix(alb, vec3(.8, .84, .88), ice);
    vec3 cq = q * 2.1 + vec3(uTime * .006, 0., 5.); cq += (vec3(fbm3(cq * 1.3), fbm3(cq * 1.3 + 5.), fbm3(cq * 1.3 + 9.)) - .5) * 1.6;
    float cl = smoothstep(.5, .74, fbm3(cq) * .62 + fbm3(cq * 4. + 9.) * .38);
    // three cyclones that never stop turning
    vec3 c1 = vort(p, .42, 1.1 + uTime * .004, vec2(.2, .2)), c2 = vort(p, -.5, 3.9 + uTime * .003, vec2(.17, .17)), c3 = vort(p, .15, 5.2 + uTime * .005, vec2(.13, .13));
    float cy = spiral(c1, uTime * .35, 2., 3.2) * smoothstep(1.25, .25, c1.z) * smoothstep(.04, .16, c1.z);
    cy = max(cy, spiral(c2, -uTime * .3, 2., 3.2) * smoothstep(1.25, .25, c2.z) * smoothstep(.04, .16, c2.z));
    cy = max(cy, spiral(c3, uTime * .42, 2., 3.) * smoothstep(1.25, .25, c3.z) * smoothstep(.04, .16, c3.z));
    cl = max(cl * (1. - .7 * smoothstep(1.3, .6, min(c1.z, min(c2.z, c3.z)))), smoothstep(.35, .8, cy));
    water = (1. - land) * (1. - ice);
    spec = water * (1. - cl) * .9; alb = mix(alb, vec3(.86), cl * .88); atmo = 1.25; atmoC = vec3(.25, .5, 1.);
    lights = step(.55, lf) * smoothstep(.72, .95, vnoise3(q * 9.)) * pow(vnoise3(q * 60.), 6.) * (1. - cl * .7);
  } else if (uType < 2.5) {                                   // gas giant: sheared bands, and storms on the biggest
    vec3 g = vec3(0., 0., 9.), o1 = g, o2 = g, o3 = g; float bend = 0.;
    if (uVort > .5) {
      g = vort(p, -.38, 2.2 - uTime * .004, vec2(.3, .17));                              // the Great Red Spot
      o1 = vort(p, -.62, 3.7 + uTime * .006, vec2(.1, .075)); o2 = vort(p, .5, .9 + uTime * .008, vec2(.085, .065)); o3 = vort(p, -.84, 5.3 + uTime * .005, vec2(.07, .06));
      bend = g.y * .19 * exp(-g.z * g.z * .42) + o1.y * .08 * exp(-o1.z * o1.z * .5) + o2.y * .07 * exp(-o2.z * o2.z * .5) + o3.y * .06 * exp(-o3.z * o3.z * .5);
    }
    float latb = lat + bend;                                                              // the bands flow round the storms
    float drift = uTime * .011 * sin(latb * 13.) * uVort;                                 // alternating jets
    vec3 qq = vec3(cos(lon + drift) * cos(lat), latb, sin(lon + drift) * cos(lat));
    float w = fbm3(qq * vec3(1.5, 3., 1.5) + uSeed) - .5, w2 = fbm3(qq * vec3(6., 16., 6.) + 3.) - .5;
    float b = smoothstep(.15, .85, sin(latb * 13. + w * 2.4 + w2 * .8) * .5 + .5), b2 = sin(latb * 31. + w * 6. + 1.3) * .5 + .5;
    alb = mix(uB, uA, b); alb = mix(alb, uC, b2 * .42);
    alb = mix(alb, vec3(.4, .47, .58), smoothstep(1., 1.45, abs(lat)) * .5 * uVort);
    alb *= .8 + .4 * fbm3(qq * vec3(10., 34., 10.) + uSeed);
    if (uVort > .5) {
      float ga = atan(g.y, g.x) + uTime * .45;                                             // everything inside turns together
      float swirl = spiral(g, uTime * .45, 2., 5.5) * .22 + fbm(vec2(cos(ga), sin(ga)) * (1.2 + g.z * 2.6) + g.z * 3.) * .95;
      vec3 red = mix(vec3(.5, .13, .06), vec3(.86, .4, .22), smoothstep(.25, .95, swirl));
      red = mix(red, vec3(.42, .1, .05), smoothstep(.6, 1., g.z) * .5);                    // darker toward its rim
      alb = mix(alb, vec3(.93, .87, .77), smoothstep(1.5, 1.05, g.z) * .55);              // its pale collar
      alb = mix(alb, red, smoothstep(1.05, .86, g.z));
      vec3 wh = vec3(.95, .9, .82);
      alb = mix(alb, wh * (.75 + .25 * spiral(o1, -uTime * .7, 2., 2.)), smoothstep(1.05, .7, o1.z) * .9);
      alb = mix(alb, wh * (.75 + .25 * spiral(o2, uTime * .8, 2., 2.)), smoothstep(1.05, .7, o2.z) * .9);
      alb = mix(alb, wh * (.75 + .25 * spiral(o3, -uTime * .9, 2., 2.)), smoothstep(1.05, .7, o3.z) * .85);
    }
    atmo = .35; atmoC = uC;
  } else if (uType < 3.5) {                                   // ice giant
    float b = sin(lat * 11. + fbm3(q) * 2.4) * .5 + .5; alb = mix(uA, uB, b * .7); alb = mix(alb, uC, smoothstep(.55, .8, fbm3(vec3(p.x * 2., p.y * 9., p.z * 2.) + 4.)) * .45);
    vec3 ds = vort(p, -.33, 1. + uTime * .004, vec2(.2, .13));
    alb = mix(alb, uB * .42 * (.8 + .4 * spiral(ds, uTime * .4, 2., 2.)), smoothstep(1.1, .6, ds.z) * .85);      // a great dark spot, turning
    atmo = .8; atmoC = uC;
  } else {                                                    // Venus: one continuous cloud deck
    float b = fbm3(vec3(p.x * 2., p.y * 5., p.z * 2.) + uSeed + fbm3(q) * 1.5 + vec3(uTime * .01, 0., 0.)); alb = mix(uB, uA, b); alb = mix(alb, uC, smoothstep(.55, .8, b));
    atmo = .7; atmoC = uA;
  }
}`;

// Two-dimensional water freezes at once: six-armed dendrites grow from random nuclei as a front sweeps inward past them.
// p is in cell units measured from the centre of the sweep, rf the front radius in the same units, k growth per unit of distance behind it.
export const FROST_GLSL = /* glsl */`
float fseg(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h); }
// px = length(fwidth(p)), taken by the caller outside any branch
vec2 frost(vec2 p, float rf, float k, float px){
  vec2 id = floor(p), f = fract(p); float line = 0., fill = 0.;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)), h = hash22(id + o), c = o + .15 + .7 * h;
    float g = clamp((length(id + c) - rf) * k - h.x * .5, 0., 1.3); if (g <= 0.) continue;
    vec2 d = f - c; float r = length(d), R = g * (.6 + .3 * h.y);
    if (r > R + .06) continue;
    float a = atan(d.y, d.x) + h.x * 6.283; a = mod(a, 1.0472); a = abs(a - .5236);
    vec2 q = vec2(cos(a), sin(a)) * r; const vec2 ax = vec2(.8660, .5), bx = vec2(.8660, -.5);
    float dd = fseg(q, vec2(0.), ax * R);
    for (int n = 1; n <= 4; n++) {
      float tt = float(n) * .21 * R, len = R * (.44 - .08 * float(n)); vec2 b0 = ax * tt, b1 = b0 + bx * len;
      dd = min(dd, fseg(q, b0, b1)); dd = min(dd, fseg(q, b0 + bx * len * .5, b0 + bx * len * .5 + ax * len * .32));
    }
    dd = min(dd, abs(r - R * .16) + .004);                                                 // hexagonal plate at the nucleus
    float w0 = .011 + .008 * h.y, w = max(w0, px * .9);
    line = max(line, smoothstep(w * 2.2, w * .35, dd) * min(1., w0 / w * 1.6));
    fill = max(fill, smoothstep(R, R * .5, r) * min(g, 1.));
  }
  return vec2(line, fill);
}`;
