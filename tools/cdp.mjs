// Minimal headless-Chrome CDP helper (Metal GPU WebGL2), fail-fast on page errors/crashes.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cleanups = new Set();
let hooked = false;
function hook() {
  if (hooked) return; hooked = true;
  const run = () => { for (const c of [...cleanups]) { try { c(); } catch {} } cleanups.clear(); };
  process.on('exit', run);
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => { run(); process.exit(130); });
}

const fmtArg = a => a.value !== undefined ? (typeof a.value === 'string' ? a.value : JSON.stringify(a.value)) : (a.description ?? a.unserializableValue ?? a.type);
const fmtExc = d => d.exception?.description || `${d.text}${d.exception?.value !== undefined ? ' ' + JSON.stringify(d.exception.value) : ''} (${d.url || ''}:${d.lineNumber}:${d.columnNumber})`;

export async function launch({ width = 1920, height = 1080, onLog = null } = {}) {
  hook();
  const dir = mkdtempSync(path.join(tmpdir(), 'tbs-chrome-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-crash-reporter', '--disable-breakpad', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${dir}`,
    '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu',
    '--disable-gpu-watchdog', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows',
    '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb', `--window-size=${width},${height}`, 'about:blank',
  ], { stdio: 'ignore', detached: true });
  let chromeDead = false;
  proc.on('exit', () => { chromeDead = true; });
  const kill = () => {
    cleanups.delete(kill);
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { try { proc.kill('SIGKILL'); } catch {} }
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  };
  cleanups.add(kill);

  let port = null;
  for (let i = 0; i < 300 && !port; i++) {
    if (chromeDead) throw new Error('Chrome exited during startup (is the path right? CHROME=' + CHROME + ')');
    try { port = +readFileSync(path.join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(50); }
  }
  if (!port) { kill(); throw new Error('Chrome DevTools port never appeared'); }
  const http = async (p, method = 'GET') => {
    for (let i = 0; i < 100; i++) {
      try { const r = await fetch(`http://127.0.0.1:${port}${p}`, { method }); return await r.json(); } catch { await sleep(100); }
    }
    throw new Error('chrome not reachable');
  };
  await http('/json/version');

  const pages = [];
  // Open a page. Resolves after window.READY === true. Throws (with logs) on exception/crash/FILM_ERROR/timeout.
  async function open(url, { dpr = 1, label = 'page', readyTimeout = 120000, noWait = false, echo = true } = {}) {
    const tgt = await http(`/json/new?about:blank`, 'PUT');
    const ws = new WebSocket(tgt.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws connect failed')); });
    let id = 0; const pending = new Map(); const logs = [];
    let fatal = null;
    const die = e => { if (fatal) return; fatal = e instanceof Error ? e : new Error(e); for (const [, p] of pending) p.rej(fatal); pending.clear(); };
    const note = (kind, text) => { const line = `[${label} ${kind}] ${text}`; logs.push(line); if (echo) (onLog || console.log)(line); };
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(`${m.error.message}`)) : p.res(m.result); }
      else if (m.method === 'Runtime.consoleAPICalled') {
        const k = m.params.type; note(k === 'error' ? 'console.error' : k === 'warning' ? 'warn' : 'log', m.params.args.map(fmtArg).join(' '));
      } else if (m.method === 'Runtime.exceptionThrown') { const t = fmtExc(m.params.exceptionDetails); note('EXCEPTION', t); die(new Error(`page threw: ${t}`)); }
      else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') note('browser-error', `${m.params.entry.text} ${m.params.entry.url || ''}`);
      else if (m.method === 'Inspector.targetCrashed') { note('CRASH', 'renderer crashed'); die(new Error('page renderer crashed')); }
    };
    ws.onclose = () => die(new Error(chromeDead ? 'Chrome process died' : 'page connection closed'));
    proc.on('exit', () => die(new Error('Chrome process died')));
    const send = (method, params = {}) => fatal ? Promise.reject(fatal) : new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable');
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
    const evaluate = async expression => {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('evaluate failed: ' + fmtExc(r.exceptionDetails));
      return r.result?.value;
    };
    const filmError = async () => { try { return await evaluate('window.FILM_ERROR ? String(window.FILM_ERROR) : ""'); } catch { return ''; } };
    const checkErrors = async () => {
      if (fatal) throw fatal;
      const fe = await filmError();
      if (fe) throw new Error('window.FILM_ERROR: ' + fe);
    };
    await send('Page.navigate', { url });
    if (!noWait) {
      const t0 = Date.now(); let ready = false;
      while (!ready) {
        if (fatal) throw fatal;
        if (Date.now() - t0 > readyTimeout) throw new Error(`window.READY never became true within ${readyTimeout / 1000}s (${url})`);
        try {
          const s = await evaluate('JSON.stringify({r:document.readyState==="complete",ok:window.READY===true,e:window.FILM_ERROR?String(window.FILM_ERROR):""})');
          const o = JSON.parse(s);
          if (o.e) throw new Error('window.FILM_ERROR: ' + o.e);
          ready = o.r && o.ok;
        } catch (e) { if (/FILM_ERROR|page threw|crashed|died|closed/.test(e.message)) throw e; }
        if (!ready) await sleep(50);
      }
    }
    const screenshot = async (png = false, quality = 95) => {
      const r = await send('Page.captureScreenshot', { format: png ? 'png' : 'jpeg', ...(png ? {} : { quality }), fromSurface: true, captureBeyondViewport: false });
      return Buffer.from(r.data, 'base64');
    };
    const p = { evaluate, screenshot, send, logs, checkErrors, close: () => { try { ws.close(); } catch {} } };
    pages.push(p);
    return p;
  }
  const gpuRenderer = async page => page.evaluate(`(() => { const c = document.createElement('canvas'); const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return 'NO WEBGL'; const e = gl.getExtension('WEBGL_debug_renderer_info');
    const r = e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); gl.getExtension('WEBGL_lose_context')?.loseContext(); return r; })()`);
  return { open, kill, gpuRenderer, isDead: () => chromeDead };
}
