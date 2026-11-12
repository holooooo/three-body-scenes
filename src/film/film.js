// Film page: frame-exact renderer for the three showcase films (see CONTRACT.md).
import { Engine, SCENES } from '../core/engine.js';
import { smooth, clamp } from '../core/util.js';

const q = new URLSearchParams(location.search);
const id = q.get('s') || 'guzheng', RENDER = q.has('render');
const samples = +(q.get('samples') || 8), shutter = +(q.get('shutter') || 0.5), fps = +(q.get('fps') || 60);
const $ = s => document.querySelector(s);
const HOOK = '可交互网页版 · 亲手拖动时间轴，从任意角度观看';

function overlay(film, ft) {
  const env = (o, a = 0.7, b = 0.7) => smooth(o.from, o.from + a, ft) * (1 - smooth(o.to - b, o.to, ft));
  let title = null, cap = null, end = null;
  for (const o of film.titles) { if (ft < o.from || ft > o.to) continue; if (o.kind === 'title') title = o; else if (o.kind === 'caption') cap = o; else if (o.kind === 'end') end = o; }
  const T = $('#title'), C = $('#caption'), E = $('#end'), B = $('#badge');
  if (title) {
    const k = env(title, 1.1, 1.0), p = (ft - title.from) / (title.to - title.from);
    $('#t-eyebrow').textContent = `三体 · 名场面复原 ${title.no}`; $('#t-zh').textContent = title.zh; $('#t-en').textContent = title.en; $('#t-sub').textContent = title.sub || '';
    T.style.opacity = k; T.style.transform = `translateY(-50%) scale(${(0.985 + 0.03 * p).toFixed(5)})`;
    T.style.filter = `blur(${((1 - k) * 7).toFixed(2)}px)`;
  } else T.style.opacity = 0;
  if (cap) {
    const k = env(cap, 0.6, 0.6);
    $('#c-zh').textContent = cap.zh; $('#c-en').textContent = cap.en;
    C.style.opacity = k; C.style.transform = `translateX(${((1 - smooth(cap.from, cap.from + 0.9, ft)) * -18).toFixed(2)}px)`;
  } else C.style.opacity = 0;
  if (end) {
    const k = smooth(end.from, end.from + 1.2, ft) * (1 - smooth(film.duration - 1.1, film.duration - 0.25, ft));
    $('#e-hook').textContent = HOOK;
    E.style.opacity = k; E.style.transform = `scale(${(0.97 + 0.03 * smooth(end.from, end.from + 2.5, ft)).toFixed(5)})`;
  } else E.style.opacity = 0;
  const firstTitleEnd = (film.titles.find(o => o.kind === 'title') || { to: 0 }).to;
  B.style.opacity = 0.9 * smooth(firstTitleEnd - 0.4, firstTitleEnd + 0.8, ft) * (end ? 1 - smooth(end.from - 0.2, end.from + 0.6, ft) : 1);
}

try {
  const engine = new Engine($('#c'), { film: true });
  await engine.load(id);
  engine.resize(1920, 1080);
  const film = engine.scene.film;
  window.DURATION = film.duration;
  window.engine = engine;
  // debug views: ?dbg=st;px,py,pz;lx,ly,lz;fov|...  -> renderFrame(i) draws view i of the scene at scene-time st
  const dbg = q.get('dbg') ? q.get('dbg').split('|').map(v => { const [st, p, l, fov, an] = v.split(';'); const o = an ? engine.scene.debug.anchors[an](+st) : [0, 0, 0]; return { st: +st, pos: p.split(',').map((x, i) => +x + o[i]), look: l.split(',').map((x, i) => +x + o[i]), fov: +(fov || 40) }; }) : null;
  window.renderFrame = async t => {
    if (dbg) {
      const d = dbg[Math.min(dbg.length - 1, Math.round(t))];
      engine.post.beginAccum(); engine.applyPose(d); engine.drawScene(d.st, engine.post.rtScene); engine.post.addSample(1); engine.applyPost(d.st); engine.post.finish(true);
      document.querySelector('#overlay').style.display = 'none'; return;
    }
    engine.renderFilmFrame(t, { samples, shutter, fps }); overlay(film, t);
  };
  // warm up shaders so the first real frame is not a compile stall
  engine.renderFilmFrame(film.duration * 0.5, { samples: 1 }); engine.renderFilmFrame(0, { samples: 1 }); overlay(film, 0);
  window.READY = true;
  if (!RENDER) {
    // real-time preview (reduced sampling), optional audio from build/audio
    const audio = new Audio(`build/audio/${id}.wav`); let t0 = performance.now(), off = +(q.get('t') || 0);
    addEventListener('click', () => { audio.currentTime = clamp((performance.now() - t0) / 1000 + off, 0, film.duration); audio.play().catch(() => {}); });
    const loop = () => { const t = ((performance.now() - t0) / 1000 + off) % film.duration; engine.renderFilmFrame(t, { samples: 1 }); overlay(film, t); requestAnimationFrame(loop); };
    loop();
  }
} catch (e) {
  console.error(e); window.FILM_ERROR = String(e?.stack || e);
}
