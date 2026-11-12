// Interactive viewer shell: timeline, moments, focus targets, camera modes, language.
import { Engine, SCENES } from './engine.js';
import { clamp } from './util.js';

const q = new URLSearchParams(location.search);
const id = SCENES[q.get('s')] ? q.get('s') : 'guzheng';
const $ = s => document.querySelector(s);
let lang = q.get('lang') || localStorage.getItem('tbs-lang') || ((navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en');
const L = (zh, en) => (lang === 'zh' ? zh : en);
const def = SCENES[id];
const ACCENT = { guzheng: '#f0a35c', droplet: '#9ed4ff', foil: '#f3e3b4' }[id];
document.documentElement.style.setProperty('--accent', ACCENT);
document.body.dataset.scene = id;

$('#l-no').textContent = `三体 · 名场面复原 ${def.no}`; $('#l-zh').textContent = def.zh; $('#l-en').textContent = def.en.toUpperCase();
$('#l-msg').textContent = L('正在构建场景…', 'Building the scene…');
document.title = `${def.zh} · 三体名场面复原`;

const fmt = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const quality = q.get('q') || localStorage.getItem('tbs-q') || (matchMedia('(max-width: 820px)').matches || (navigator.hardwareConcurrency || 8) <= 4 ? 'medium' : 'high');

async function main() {
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 30)));       // let the loader paint first
  const engine = new Engine($('#c'), { quality });
  const scene = await engine.load(id);
  window.engine = engine;
  addEventListener('resize', () => engine.resize());

  // ---------- static text ----------
  const applyLang = () => {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.querySelectorAll('[data-zh]').forEach(e => { e.textContent = L(e.dataset.zh, e.dataset.en); });
    $('#h-no').textContent = def.no; $('#h-title').textContent = L(def.zh, def.en);
    $('#b-lang').textContent = lang === 'zh' ? 'EN' : '中';
    $('#hint').textContent = L('拖动旋转 · 滚轮缩放 · 右键平移 · 空格暂停 · 拖动时间轴回看任意时刻', 'Drag to orbit · scroll to zoom · right-drag to pan · space to pause · scrub the timeline to revisit any moment');
    buildFocus(); buildToggles(); setCamLabel(); curMoment = -1; onTime(engine.t);
  };

  // ---------- focus + toggles ----------
  function buildFocus() {
    const box = $('#focus-list'); box.innerHTML = '';
    for (const f of scene.focus || []) {
      const b = document.createElement('button'); b.textContent = L(f.zh, f.en); b.dataset.id = f.id;
      b.onclick = () => { engine.focusOn(f.id); markFocus(); };
      box.appendChild(b);
    }
    markFocus();
  }
  const markFocus = () => document.querySelectorAll('#focus-list button').forEach(b => b.classList.toggle('on', engine.mode === 'orbit' && engine.follow === b.dataset.id));
  function buildToggles() {
    const box = $('#toggles'); box.innerHTML = '';
    for (const t of scene.toggles || []) {
      const b = document.createElement('button'); b.className = 'ghost tog'; b.textContent = L(t.zh, t.en);
      const sync = () => b.classList.toggle('on', !!t.get()); sync();
      b.onclick = () => { t.set(!t.get()); sync(); };
      box.appendChild(b);
    }
  }
  const setCamLabel = () => { $('#b-cam span').textContent = engine.mode === 'director' ? L('导演镜头', 'Director cam') : L('自由视角', 'Free cam'); $('#b-cam').classList.toggle('free', engine.mode !== 'director'); };
  $('#b-cam').onclick = () => engine.setMode(engine.mode === 'director' ? 'orbit' : 'director');
  engine.on('mode', () => { setCamLabel(); markFocus(); });
  engine.on('focus', markFocus);

  // ---------- timeline ----------
  const dur = scene.duration, bar = $('#bar'), ticks = $('#ticks');
  $('#t-all').textContent = ' / ' + fmt(dur);
  scene.moments.forEach((m, i) => {
    const t = document.createElement('i'); t.style.left = (m.t / dur * 100) + '%'; t.dataset.i = i; ticks.appendChild(t);
  });
  let curMoment = -1;
  function onTime(t) {
    $('#t-now').textContent = fmt(t);
    const k = t / dur * 100; $('#fill').style.width = k + '%'; $('#knob').style.left = k + '%';
    let mi = 0; scene.moments.forEach((m, i) => { if (t >= m.t - 1e-3) mi = i; });
    if (mi !== curMoment) {
      curMoment = mi; const m = scene.moments[mi], box = $('#moment');
      box.classList.remove('in'); void box.offsetWidth;
      $('#m-idx').textContent = `${String(mi + 1).padStart(2, '0')} / ${String(scene.moments.length).padStart(2, '0')}`;
      $('#m-title').textContent = L(m.zh, m.en); $('#m-en').textContent = lang === 'zh' ? m.en : m.zh; $('#m-text').textContent = L(m.textZh, m.textEn);
      box.classList.add('in');
      ticks.querySelectorAll('i').forEach((e, i) => e.classList.toggle('on', i === mi));
    }
  }
  engine.on('time', onTime);
  const setPlay = v => document.body.classList.toggle('paused', !v);
  engine.on('play', setPlay);
  $('#b-play').onclick = () => engine.play(!engine.playing);

  const seekAt = e => { const r = bar.getBoundingClientRect(); engine.seek(clamp((e.clientX - r.left) / r.width, 0, 1) * dur); };
  let drag = false, wasPlaying = false;
  bar.addEventListener('pointerdown', e => { drag = true; wasPlaying = engine.playing; engine.play(false); bar.setPointerCapture(e.pointerId); seekAt(e); });
  bar.addEventListener('pointermove', e => {
    const r = bar.getBoundingClientRect(), t = clamp((e.clientX - r.left) / r.width, 0, 1) * dur, tip = $('#tip');
    let near = null; scene.moments.forEach(m => { if (Math.abs(m.t - t) < dur * 0.012) near = m; });
    tip.textContent = near ? `${fmt(near.t)}  ${L(near.zh, near.en)}` : fmt(t); tip.style.left = (t / dur * 100) + '%'; tip.classList.add('on'); tip.classList.toggle('m', !!near);
    if (drag) seekAt(e);
  });
  bar.addEventListener('pointerleave', () => $('#tip').classList.remove('on'));
  const endDrag = () => { if (drag) { drag = false; if (wasPlaying) engine.play(true); } };
  bar.addEventListener('pointerup', endDrag); bar.addEventListener('pointercancel', endDrag);

  const SPEEDS = [0.1, 0.25, 0.5, 1, 2, 4], sp = $('#speed');
  SPEEDS.forEach(s => { const b = document.createElement('button'); b.textContent = s + '×'; b.dataset.s = s; b.onclick = () => setSpeed(s); sp.appendChild(b); });
  function setSpeed(s) { engine.speed = s; sp.querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.s === s)); }
  setSpeed(1);

  // ---------- chrome ----------
  const toggleUI = () => document.body.classList.toggle('bare');
  $('#b-hide').onclick = toggleUI; $('#unhide').onclick = toggleUI;
  $('#b-full').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen?.(); };
  $('#b-lang').onclick = () => { lang = lang === 'zh' ? 'en' : 'zh'; localStorage.setItem('tbs-lang', lang); applyLang(); };
  addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') { e.preventDefault(); engine.play(!engine.playing); }
    else if (k === 'arrowleft') engine.seek(engine.t - (e.shiftKey ? 10 : 2));
    else if (k === 'arrowright') engine.seek(engine.t + (e.shiftKey ? 10 : 2));
    else if (k === 'h') toggleUI();
    else if (k === 'c') $('#b-cam').click();
    else if (k === 'f') $('#b-full').click();
    else if (k === '[' || k === ']') { const i = clamp(SPEEDS.indexOf(engine.speed) + (k === ']' ? 1 : -1), 0, SPEEDS.length - 1); setSpeed(SPEEDS[i]); }
    else if (k >= '1' && k <= '9' && scene.moments[+k - 1]) engine.seek(scene.moments[+k - 1].t);
  });
  ticks.addEventListener('pointerdown', e => { const i = e.target.dataset?.i; if (i != null) { e.stopPropagation(); engine.seek(scene.moments[+i].t); } });

  applyLang(); setPlay(true);
  if (q.has('t')) engine.seek(+q.get('t'));
  if (q.has('pause')) engine.play(false);
  if (q.has('free')) engine.setMode('orbit');
  engine.frame(performance.now());
  engine.start();
  document.body.classList.remove('loading');
  setTimeout(() => $('#hint').classList.add('on'), 900); setTimeout(() => $('#hint').classList.remove('on'), 9000);
  window.DURATION = dur;
  window.renderFrame = async t => { engine.play(false); engine.seek(t); engine.frame(performance.now()); };   // test hook
  window.READY = true;
}

main().catch(e => {
  console.error(e); window.FILM_ERROR = String(e?.stack || e);
  $('#l-msg').textContent = L('场景加载失败：需要支持 WebGL 2 的浏览器。', 'The scene failed to load: a WebGL 2 capable browser is required.') + ' ' + (e?.message || '');
  document.body.classList.add('failed');
});
