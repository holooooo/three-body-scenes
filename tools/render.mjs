// Frame-exact render of film.html?s=<id>&render -> ffmpeg (or stills), headless Chrome (Metal GPU).
//   node tools/render.mjs --scene guzheng [--fps 60] [--from s --to s] [--workers 3] [--width 1920 --height 1080]
//        [--out path] [--page film.html] [--quality 95 | --png] [--crf 19] [--frame-timeout 60] [--query "a=1"]
//   node tools/render.mjs --scene guzheng --stills 3,30.5,60 [--tag name] [--page scene.html] [--query "a=1&b=2"] [--eval "js"]
// The page must expose window.renderFrame(t) (Promise), window.DURATION and set window.READY = true.
import { launch } from './cdp.mjs';
import { serve } from './serve.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = k => argv.includes('--' + k);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const fail = msg => { console.error('\nRENDER FAILED: ' + msg); process.exit(1); };

const scene = arg('scene', null), stillsArg = arg('stills', null), pageArg = arg('page', 'film.html');
const FPS = +arg('fps', 60), WORKERS = Math.max(1, +arg('workers', 3));
const W = +arg('width', 1920), H = +arg('height', 1080), PNG = has('png'), Q = +arg('quality', 95);
const FRAME_TIMEOUT = +arg('frame-timeout', 60) * 1000, tag = arg('tag', ''), query = arg('query', ''), evalJs = arg('eval', null);
if (!scene && pageArg === 'film.html') fail('--scene <id> is required (guzheng | droplet | foil)');
const idName = scene || path.basename(pageArg).replace(/\.\w+$/, '');
const pagePath = pageArg.startsWith('/') ? pageArg : '/' + pageArg.replace(/^\.\//, '');
const url = srvPort => `http://127.0.0.1:${srvPort}${pagePath}?${scene ? `s=${encodeURIComponent(scene)}&` : ''}render${query ? '&' + query : ''}`;
const fmt = s => s >= 60 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`;
const withTimeout = (p, ms, what) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`TIMEOUT after ${ms / 1000}s: ${what}`)), ms); })]).finally(() => clearTimeout(t)); };

let srv, chrome;
process.on('unhandledRejection', e => fail(e?.stack || String(e)));
try {
  srv = await serve(ROOT);
  chrome = await launch({ width: W, height: H });
  const U = url(srv.port);
  console.log(`page: ${U}`);
  const openPage = async (i, echo) => { const p = await chrome.open(U, { label: `w${i}`, echo, readyTimeout: +arg('ready-timeout', 60) * 1000 }); await p.checkErrors(); return p; };

  if (stillsArg) {
    const p = await openPage(0, true);
    const gpu = await chrome.gpuRenderer(p);
    console.log(`GPU renderer: ${gpu}`);
    if (/swiftshader|llvmpipe|software|no webgl/i.test(gpu)) console.error('!!!!!! WARNING: SOFTWARE RENDERING (' + gpu + ') — output will be extremely slow !!!!!!');
    if (evalJs) {
      const r = await p.evaluate(evalJs); await p.checkErrors();
      if (r !== undefined) console.log('[eval] ' + (typeof r === 'string' ? r : JSON.stringify(r)));
    }
    const dir = path.join(ROOT, 'build/stills'); mkdirSync(dir, { recursive: true });
    const hasRF = await p.evaluate('typeof window.renderFrame === "function"');
    if (!hasRF) console.log('(page has no renderFrame; screenshotting current state)');
    for (const t of stillsArg.split(',').map(Number)) {
      if (!Number.isFinite(t)) fail(`bad still time in --stills: ${stillsArg}`);
      await withTimeout(hasRF ? p.evaluate(`window.renderFrame(${t})`) : p.evaluate('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'), FRAME_TIMEOUT, `renderFrame(${t}) hung`);
      await p.checkErrors();
      const buf = await withTimeout(p.screenshot(PNG, Q), FRAME_TIMEOUT, `screenshot at t=${t}`);
      const out = path.join(dir, `${idName}${tag ? '-' + tag : ''}-t${t.toFixed(1).padStart(5, '0')}.${PNG ? 'png' : 'jpg'}`);
      writeFileSync(out, buf); console.log(out);
    }
    await p.checkErrors();
  } else {
    const pages = [];
    for (let i = 0; i < WORKERS; i++) pages.push(openPage(i, i === 0)); // only worker 0 echoes console; others still fail-fast
    const ps = await Promise.all(pages);
    const gpu = await chrome.gpuRenderer(ps[0]);
    console.log(`GPU renderer: ${gpu}`);
    if (/swiftshader|llvmpipe|software|no webgl/i.test(gpu)) console.error('!!!!!! WARNING: SOFTWARE RENDERING (' + gpu + ') — render will be extremely slow !!!!!!');
    const dur = await ps[0].evaluate('window.DURATION');
    if (!(dur > 0)) throw new Error('window.DURATION missing or invalid: ' + dur);
    const f0 = Math.round(+arg('from', 0) * FPS), f1 = Math.min(Math.ceil(dur * FPS - 1e-6), Math.round(+arg('to', 1e9) * FPS));
    if (f1 <= f0) throw new Error(`empty frame range ${f0}..${f1}`);
    const out = path.resolve(arg('out', path.join(ROOT, 'build/video', `${idName}.mp4`)));
    mkdirSync(path.dirname(out), { recursive: true });
    const ff = spawn('ffmpeg', ['-y', '-v', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', PNG ? 'png' : 'mjpeg', '-i', '-',
      '-vf', 'scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709:flags=bicubic+accurate_rnd+full_chroma_int,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(arg('crf', 19)), '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
      '-r', String(FPS), '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    let failure = null;
    const ffDone = new Promise(r => ff.on('close', code => { if (code && !failure) failure = new Error('ffmpeg exited with code ' + code); r(); }));
    ff.on('error', e => { failure = new Error('ffmpeg: ' + e.message); });
    ff.stdin.on('error', e => { failure ||= new Error('ffmpeg pipe: ' + e.message); wake(); });
    const total = f1 - f0, t0 = Date.now();
    console.log(`rendering ${total} frames (${f0}..${f1 - 1}) of ${dur.toFixed(2)}s @ ${FPS}fps ${W}x${H} ${PNG ? 'PNG' : 'JPEG q' + Q} with ${WORKERS} workers -> ${out}`);
    // workers pull frame indices; the writer emits strictly in order with a bounded lead.
    let next = f0, written = f0; const done = new Map(); let waiters = [];
    const wake = () => { const w = waiters; waiters = []; w.forEach(r => r()); };
    const waitEvent = () => new Promise(r => { waiters.push(r); setTimeout(r, 250); });
    const LEAD = WORKERS * 4;
    const worker = async (p, wi) => {
      while (!failure) {
        if (next >= f1) return;
        if (next - written >= LEAD) { await waitEvent(); continue; }
        const f = next++, t = f / FPS;
        try {
          await withTimeout(p.evaluate(`window.renderFrame(${t})`), FRAME_TIMEOUT, `renderFrame hung on frame ${f} (t=${t.toFixed(4)}s, worker ${wi})`);
          const buf = await withTimeout(p.screenshot(PNG, Q), FRAME_TIMEOUT, `screenshot hung on frame ${f} (t=${t.toFixed(4)}s, worker ${wi})`);
          await p.checkErrors();
          done.set(f, buf);
        } catch (e) { failure ||= new Error(`frame ${f} (t=${t.toFixed(4)}s): ${e.message}`); wake(); return; }
        wake();
      }
    };
    const workers = ps.map(worker);
    let lastLog = 0;
    while (written < f1 && !failure) {
      if (!done.has(written)) { await waitEvent(); continue; }
      const img = done.get(written); done.delete(written);
      if (!ff.stdin.write(img)) await new Promise(r => { const h = () => { clearTimeout(tm); ff.stdin.off('drain', h); ff.stdin.off('error', h); r(); }; const tm = setTimeout(h, 250); ff.stdin.once('drain', h); ff.stdin.once('error', h); });
      written++; wake();
      const now = Date.now();
      if (now - lastLog > 5000 || written === f1) {
        lastLog = now; const el = (now - t0) / 1000, d = written - f0;
        console.log(`frame ${written}/${f1}  ${(100 * d / total).toFixed(1)}%  ${(d / el).toFixed(1)} fps  elapsed ${fmt(el)}  eta ${fmt(el / Math.max(d, 1) * (f1 - written))}`);
      }
    }
    if (failure) { ff.stdin.destroy(); ff.kill('SIGKILL'); throw failure; }
    await Promise.all(workers);
    if (failure) { ff.kill('SIGKILL'); throw failure; }
    ff.stdin.end(); await ffDone;
    if (failure) throw failure;
    const el = (Date.now() - t0) / 1000;
    console.log(`done ${out}  ${total} frames in ${fmt(el)} (${(total / el).toFixed(1)} fps)`);
  }
} catch (e) { fail(e.message || String(e)); }
finally { chrome?.kill(); srv?.close(); }
