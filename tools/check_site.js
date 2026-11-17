#!/usr/bin/env node
// Headless-browser check of the built site. Passes only when:
//  - a wrong access code is refused and the right one opens the game (computer page and phone page)
//  - a phone that follows the game's QR link opens without typing the code and pairs with the game
//  - gas, tilt, drift and items actually drive the kart, and a whole race can be finished
//  - the browser contacts no other server except the approved pairing socket; no CSP / integrity / script errors
//  - deliberately altered copies of every fingerprinted file, and an altered encrypted page, are refused
//  - no readable game code or access code is left in the published files
// Usage: ACCESS_CODE=<code> NODE_PATH=<folder with playwright, peer and ws> node tools/check_site.js [--full] [--shots <folder>]
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright'), WebSocket = require('ws'), { PeerServer } = require('peer');
const root = path.join(__dirname, '..'), cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'libs.json'), 'utf8'));
const CODE = process.env.ACCESS_CODE; if (!CODE) { console.error('ACCESS_CODE is not set'); process.exit(1); }
const si = process.argv.indexOf('--shots'), shots = si > 0 ? process.argv[si + 1] : null; if (shots) fs.mkdirSync(shots, { recursive: true });
const snap = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name) }); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.txt': 'text/plain' };
let tamper = null;
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html', file = path.join(root, rel);
  if (!file.startsWith(root) || !/^(index\.html|controller\.html|lib\/)/.test(rel) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  let b = fs.readFileSync(file);
  if (tamper === rel) b = rel.endsWith('.html') ? Buffer.from(b.toString('utf8').replace(/"ct":"(.{40})(.)/, (m, a, c) => '"ct":"' + a + (c === 'A' ? 'B' : 'A'))) : Buffer.concat([b, Buffer.from('\n;')]);
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(b);
});
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/`, PP = 9000 + Math.floor(Math.random() * 500);
  PeerServer({ port: PP, path: '/', host: '127.0.0.1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [], outside = [], sockets = [];
  async function open(ctxOpts, url, quiet) {
    const ctx = await browser.newContext(ctxOpts), page = await ctx.newPage();
    if (!quiet) { page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e))); }
    page.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) outside.push(r.url()); });
    await page.routeWebSocket(/.*/, ws => {
      sockets.push(ws.url());
      const u = new URL(ws.url()); if (u.host !== '0.peerjs.com') { ws.close(); return; }
      const up = new WebSocket(`ws://127.0.0.1:${PP}${u.pathname}${u.search}`), q = [];
      up.on('open', () => { q.splice(0).forEach(m => up.send(m)); });
      up.on('message', d => ws.send(d.toString())); up.on('close', () => ws.close()); up.on('error', () => ws.close());
      ws.onMessage(m => { if (up.readyState === 1) up.send(m); else q.push(m); }); ws.onClose(() => up.close());
    });
    await page.goto(url); return page;
  }
  const enter = async (page, code) => { await page.fill('#code', code); await page.click('#go'); };
  const wrong = CODE === '0000' ? '1111' : '0000';

  // --- published files hold nothing readable ---
  const pub = []; (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (f === '.git' || f === 'node_modules') continue; if (fs.statSync(p).isDirectory()) walk(p); else pub.push(p); } })(root);
  const leaks = pub.filter(p => { const t = fs.readFileSync(p, 'latin1'), own = /tools[\\/](build_site|check_site)\.js$/.test(p); return (!own && /parseGLB|stepKart|Z2xURg/.test(t)) || (CODE.length >= 6 && t.includes(CODE)); });
  ok(leaks.length === 0, 'no readable game code or access code in the published files' + (leaks.length ? ': ' + leaks.join(', ') : ''));
  ok(!pub.some(p => /\.glb$|[\\/]src[\\/]|game\.js$|controller\.js$/.test(p)), 'no source files or map file published in the clear');

  // --- computer page: code screen ---
  const host = await open({ viewport: { width: 960, height: 540 } }, base, true);
  await enter(host, wrong); await host.waitForFunction(() => /not right/.test(document.getElementById('err').textContent), null, { timeout: 30000 }).catch(() => { });
  ok(await host.evaluate(() => !window.__tk && /not right/.test(document.getElementById('err').textContent)), 'a wrong access code is refused on the game page');
  host.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); host.on('pageerror', e => errors.push(String(e)));
  await enter(host, CODE);
  await host.waitForFunction(() => window.__tk && window.__tk.get().peerReady, null, { timeout: 40000 }).catch(() => { });
  const h0 = await host.evaluate(() => window.__tk ? window.__tk.get() : null);
  ok(h0 && h0.peerReady, 'the right access code opens the game, which registers with the pairing service');
  await sleep(800); await snap(host, '1-lobby.png');
  const link = await host.evaluate(() => window.__tk.link());

  // --- phone page: typed code ---
  const p2 = await open({ viewport: { width: 780, height: 360 }, isMobile: true, hasTouch: true }, base + 'controller.html', true);
  await enter(p2, wrong); await p2.waitForFunction(() => /not right/.test(document.getElementById('err').textContent), null, { timeout: 30000 }).catch(() => { });
  const refused = await p2.evaluate(() => !window.__tc);
  await enter(p2, CODE); await p2.waitForFunction(() => window.__tc, null, { timeout: 30000 }).catch(() => { });
  ok(refused && await p2.evaluate(() => !!window.__tc && document.getElementById('needcode').style.display !== 'none'), 'phone page: wrong code refused, right code opens and asks for the game code');
  await p2.close();

  // --- phone page: QR link ---
  const phone = await open({ viewport: { width: 780, height: 360 }, isMobile: true, hasTouch: true }, link);
  await phone.waitForFunction(() => window.__tc, null, { timeout: 30000 }).catch(() => { });
  ok(await phone.evaluate(() => !!window.__tc), 'the QR link opens the phone controller without typing the code');
  await phone.click('#go');
  await phone.waitForFunction(() => window.__tc.get().open, null, { timeout: 20000 }).catch(() => { });
  await host.waitForFunction(() => window.__tk.get().alive, null, { timeout: 5000 }).catch(() => { });
  ok((await host.evaluate(() => window.__tk.get().alive)), 'phone pairs with the game');
  await sleep(600); await snap(phone, '2-phone.png');

  await phone.dispatchEvent('#gas', 'pointerdown', { pointerId: 1, bubbles: true });
  await host.waitForFunction(() => window.__tk.get().phase === 'race', null, { timeout: 12000 }).catch(() => { });
  ok((await host.evaluate(() => window.__tk.get().phase)) === 'race', 'GAS on the phone starts the race');
  await sleep(2500);
  const a = await host.evaluate(() => window.__tk.get());
  ok(a.speed > 20, 'holding GAS accelerates the kart (speed ' + a.speed.toFixed(1) + ')');
  await phone.evaluate(() => { window.__tiltTimer = setInterval(() => window.__tc.tilt({ beta: -25, gamma: 0 }), 30); });
  await sleep(700);
  const s1 = await phone.evaluate(() => window.__tc.get().s), b = await host.evaluate(() => window.__tk.get());
  ok(s1 < -0.5 && b.th - a.th > 0.2, 'tilting left steers left (steer ' + s1.toFixed(2) + ', heading change ' + (b.th - a.th).toFixed(2) + ')');
  await phone.evaluate(() => { clearInterval(window.__tiltTimer); window.__tiltTimer = setInterval(() => window.__tc.tilt({ beta: 25, gamma: 0 }), 30); });
  await sleep(700);
  const c = await host.evaluate(() => window.__tk.get());
  ok(c.th - b.th < -0.2, 'tilting right steers right (' + (c.th - b.th).toFixed(2) + ')');
  await snap(host, '3-race.png');
  await phone.close(); await sleep(2200);
  const d = await host.evaluate(() => window.__tk.get());
  ok(d.paused && !d.alive, 'race pauses when the phone drops off');
  await host.close();

  // --- keyboard: drift + mini-turbo, items, whole race ---
  if (process.argv.includes('--full')) {
    const solo = await open({ viewport: { width: 640, height: 360 } }, base);
    await enter(solo, CODE); await solo.waitForFunction(() => window.__tk, null, { timeout: 40000 }); await sleep(500);
    await solo.keyboard.down('ArrowUp');
    await solo.waitForFunction(() => window.__tk.get().phase === 'race' && window.__tk.get().speed > 30, null, { timeout: 60000 }).catch(() => { });
    await solo.keyboard.down('ArrowLeft'); await solo.keyboard.down('ShiftLeft');
    await solo.waitForFunction(() => window.__tk.get().charge > 1, null, { timeout: 15000 }).catch(() => { });
    const dr = await solo.evaluate(() => window.__tk.get()); await snap(solo, '4-drift.png');
    await solo.keyboard.up('ShiftLeft'); await solo.keyboard.up('ArrowLeft'); await sleep(250);
    const af = await solo.evaluate(() => window.__tk.get());
    ok(dr.drift !== 0 && dr.charge > 1 && af.boost > 0 && af.drift === 0, 'drifting charges up and releasing gives a mini-turbo (charge ' + dr.charge.toFixed(2) + ', boost ' + af.boost.toFixed(2) + ')');
    let dir = 0, t0 = Date.now(), gotItem = false, usedItem = false, last = null;
    while (Date.now() - t0 < 420000) {
      const s = last = await solo.evaluate(() => window.__tk.get()); if (s.phase === 'finished') break;
      const nd = s.aim > 0.05 ? -1 : s.aim < -0.05 ? 1 : 0;
      if (nd !== dir) { if (dir) await solo.keyboard.up(dir < 0 ? 'ArrowLeft' : 'ArrowRight'); if (nd) await solo.keyboard.down(nd < 0 ? 'ArrowLeft' : 'ArrowRight'); dir = nd; }
      if (s.item) { gotItem = true; await solo.keyboard.press('Space'); usedItem = true; }
      await sleep(20);
    }
    ok(gotItem && usedItem, 'item boxes hand out items that can be used');
    ok(last.phase === 'finished', 'a full race can be finished by keyboard (time ' + last.raceT.toFixed(1) + 's, place ' + last.place + ')');
    await sleep(500); await snap(solo, '5-finish.png'); await solo.close();
  }

  ok(errors.length === 0, 'no console, CSP or integrity errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  ok(outside.length === 0, 'no requests to other servers' + (outside.length ? ': ' + outside.slice(0, 3).join(', ') : ''));
  const badSock = sockets.filter(u => !cfg.allowedConnections.some(x => u.startsWith(x + '/')));
  ok(sockets.length > 0 && badSock.length === 0, 'only the approved pairing socket is opened' + (badSock.length ? ': ' + badSock[0] : ''));

  // --- altered files must be refused ---
  const cases = [['lib/three.min.js', 'index.html', 'THREE'], ['lib/peerjs.min.js', 'index.html', 'Peer'], ['lib/qrcode.js', 'index.html', 'qrcode'], ['lib/peerjs.min.js', 'controller.html', 'Peer']];
  for (const [file, pageName, glob] of cases) {
    tamper = file; const errs = []; const ctx = await browser.newContext(), p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await p.routeWebSocket(/.*/, ws => ws.close());
    await p.goto(base + pageName); await enter(p, CODE);
    await p.waitForFunction(() => !document.getElementById('f'), null, { timeout: 40000 }).catch(() => { }); await sleep(1200);
    const present = await p.evaluate(g => typeof window[g] !== 'undefined', glob);
    ok(!present && errs.some(e => /integrity/i.test(e)), `altered ${file} is refused on ${pageName}`);
    await ctx.close(); tamper = null;
  }
  for (const pageName of ['index.html', 'controller.html']) {
    tamper = pageName; const ctx = await browser.newContext(), p = await ctx.newPage();
    await p.goto(base + pageName); await enter(p, CODE);
    await p.waitForFunction(() => /not right|could not/.test(document.getElementById('err').textContent), null, { timeout: 30000 }).catch(() => { });
    ok(await p.evaluate(() => !!document.getElementById('f') && !window.__tk && !window.__tc), `an altered encrypted ${pageName} does not open, even with the right code`);
    await ctx.close(); tamper = null;
  }
  await browser.close(); srv.close();
  console.log(fails.length ? `\n${fails.length} CHECK(S) FAILED` : '\nALL CHECKS PASSED'); process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
