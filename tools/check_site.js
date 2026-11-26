#!/usr/bin/env node
// Headless-browser check of the built site. Passes only when:
//  - a wrong access code is refused and the right one opens the game (computer page and phone page)
//  - a phone that follows the game's QR link opens without typing the code and pairs with the game
//  - gas, tilt, drift and items actually drive the kart, and a whole race can be finished
//  - the browser contacts no other server except the approved pairing socket; no CSP / integrity / script errors
//  - deliberately altered copies of every fingerprinted file, and an altered encrypted page, are refused
//  - no readable game code or access code is left in the published files
//  - if the site has a home-screen icon: both code screens and both unlocked pages carry it (180x180) and
//    full-screen mode, and the app manifest loads through the pages' security policy with all its icons
// Usage: ACCESS_CODE=<code> NODE_PATH=<folder with playwright, peer and ws> node tools/check_site.js [--full] [--shots <folder>]
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright'), WebSocket = require('ws'), { PeerServer } = require('peer');
const root = path.join(__dirname, '..'), cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'libs.json'), 'utf8'));
const CODE = process.env.ACCESS_CODE; if (!CODE) { console.error('ACCESS_CODE is not set'); process.exit(1); }
const si = process.argv.indexOf('--shots'), shots = si > 0 ? process.argv[si + 1] : null; if (shots) fs.mkdirSync(shots, { recursive: true });
const snap = async (page, name) => { if (shots) await page.screenshot({ path: path.join(shots, name) }); };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.txt': 'text/plain', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let tamper = null;
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html', file = path.join(root, rel);
  if (!file.startsWith(root) || !/^(index\.html|controller\.html|lib\/|icons\/[a-z0-9-]+\.png$|manifest\.webmanifest$)/.test(rel) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  let b = fs.readFileSync(file);
  if (tamper === rel) b = rel.endsWith('.html') ? Buffer.from(b.toString('utf8').replace(/"ct":"(.{40})(.)/, (m, a, c) => '"ct":"' + a + (c === 'A' ? 'B' : 'A'))) : Buffer.concat([b, Buffer.from('\n;')]);
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' }); res.end(b);
});
const fails = []; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails.push(m); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wantsIcon = /rel="apple-touch-icon"/.test(fs.readFileSync(path.join(root, 'index.html'), 'utf8'));
// home-screen icon and app mode, as a phone reads them from whatever page is showing
const homeScreen = p => p.evaluate(async () => {
  const q = s => document.querySelector(s), size = href => new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth + 'x' + im.naturalHeight); im.onerror = () => res('failed'); im.src = href; });
  const icon = q('link[rel="apple-touch-icon"]');
  return { icon: icon ? await size(icon.href) : 'missing', manifestLinked: !!q('link[rel="manifest"]'),
    appMode: (q('meta[name="apple-mobile-web-app-capable"]') || {}).content || 'missing', title: (q('meta[name="apple-mobile-web-app-title"]') || {}).content || 'missing' };
});
async function checkHome(p, gateHome, which) {        // the same icon and app mode on the code screen and on the unlocked page
  const problems = [], pageHome = await homeScreen(p);
  for (const [where, h] of [['code screen', gateHome], ['unlocked page', pageHome]]) {
    if (h.icon !== '180x180') problems.push(where + ': home-screen icon ' + h.icon);
    if (h.appMode !== 'yes') problems.push(where + ': full-screen (app) mode is ' + h.appMode);
    if (!h.manifestLinked) problems.push(where + ': no app manifest');
  }
  const cdp = await p.context().newCDPSession(p), am = await cdp.send('Page.getAppManifest');
  let man = null; try { man = JSON.parse(am.data || ''); } catch (e) { }
  if (!man) problems.push('the app manifest did not load' + (am.errors && am.errors.length ? ': ' + am.errors.map(e => e.message).join(' | ') : ''));
  else {
    const sizes = await p.evaluate(async list => Promise.all(list.map(ic => new Promise(res => { const im = new Image(); im.onload = () => res(ic.sizes === im.naturalWidth + 'x' + im.naturalHeight ? 'ok' : ic.src + ' is ' + im.naturalWidth + 'x' + im.naturalHeight); im.onerror = () => res(ic.src + ' failed'); im.src = new URL(ic.src, location.href).href; }))), man.icons || []);
    sizes.filter(s => s !== 'ok').forEach(s => problems.push('manifest icon ' + s));
    if (man.display !== 'standalone') problems.push('manifest display is ' + man.display);
  }
  ok(problems.length === 0, which + ': home-screen icon ' + pageHome.icon + ', title "' + pageHome.title + '", app mode, manifest ' + (man ? man.short_name + ' with ' + (man.icons || []).length + ' icons' : 'not loaded') + (problems.length ? ' – ' + problems.join('; ') : ''));
}
// the game lowers its own graphics quality on slow machines (this headless browser draws in software);
// let it settle before checks that depend on the frame rate
async function settle(page) {
  let last = -1, same = 0;
  for (let t = 0; t < 30 && same < 3; t++) { await sleep(1500); const q = await page.evaluate(() => window.__tk ? window.__tk.quality() : -1).catch(() => -1); if (q === last) same++; else { same = 0; last = q; } }
}

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}/`, PP = 9000 + Math.floor(Math.random() * 500);
  PeerServer({ port: PP, path: '/', host: '127.0.0.1' });
  const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [], outside = [], sockets = [], lbCalls = [];
  // the leaderboard database is answered by a stand-in here, so check runs never add scores to the real board
  const LB_ORIGIN = cfg.allowedConnections.find(x => /^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(x));
  const FAKE_DB = [{ track: 'skyland', name: 'Ace', time_ms: 150000, kart: 3, created_at: '2026-01-01' }, { track: 'skyland', name: 'Zed', time_ms: 900000, kart: 6, created_at: '2026-01-02' }]; const FAKE_GHOSTS = [];
  async function fakeLeaderboard(ctx) {
    if (!LB_ORIGIN) return;
    await ctx.route(LB_ORIGIN + '/**', async route => {
      const rq = route.request(), u = new URL(rq.url()), h = rq.headers(); lbCalls.push(rq.method() + ' ' + u.pathname);
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-expose-headers': 'Content-Range' };
      if (rq.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      if (!h.apikey || h.authorization !== 'Bearer ' + h.apikey) return route.fulfill({ status: 401, headers: cors, body: '{}' });
      const tr = (u.searchParams.get('track') || '').replace('eq.', '');
      if (/\/ghosts$/.test(u.pathname)) {          // recorded runs (ghosts) are kept apart from the times
        if (rq.method() === 'POST') { FAKE_GHOSTS.push(JSON.parse(rq.postData() || '{}')); return route.fulfill({ status: 201, headers: cors, body: '' }); }
        return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify(FAKE_GHOSTS.filter(x => x.track === tr).slice(0, 1)) });
      }
      if (rq.method() === 'POST') { const e = JSON.parse(rq.postData() || '{}'); FAKE_DB.push(Object.assign({ created_at: new Date().toISOString() }, e)); return route.fulfill({ status: 201, headers: cors, body: '' }); }
      if (u.searchParams.get('time_ms')) { const lt = +u.searchParams.get('time_ms').replace('lt.', ''); return route.fulfill({ status: 206, headers: Object.assign({ 'content-range': '0-0/' + FAKE_DB.filter(x => x.track === tr && x.time_ms < lt).length, 'content-type': 'application/json' }, cors), body: '[]' }); }
      const rows = FAKE_DB.filter(x => x.track === tr).sort((a, c) => a.time_ms - c.time_ms).slice(0, +u.searchParams.get('limit') || 10);
      return route.fulfill({ status: 200, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: JSON.stringify(rows) });
    });
  }
  async function open(ctxOpts, url, quiet) {
    const ctx = await browser.newContext(ctxOpts); await fakeLeaderboard(ctx); const page = await ctx.newPage();
    if (!quiet) { page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); page.on('pageerror', e => errors.push(String(e))); }
    page.on('request', r => { if (!r.url().startsWith(base) && !r.url().startsWith('data:') && !r.url().startsWith('blob:') && !(LB_ORIGIN && r.url().startsWith(LB_ORIGIN + '/rest/v1/'))) outside.push(r.url()); });
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
  const hostGateHome = wantsIcon ? await homeScreen(host) : null;
  await enter(host, wrong); await host.waitForFunction(() => /not right/.test(document.getElementById('err').textContent), null, { timeout: 30000 }).catch(() => { });
  ok(await host.evaluate(() => !window.__tk && /not right/.test(document.getElementById('err').textContent)), 'a wrong access code is refused on the game page');
  host.on('console', m => { if (m.type() === 'error') errors.push(m.text()); }); host.on('pageerror', e => errors.push(String(e)));
  await enter(host, CODE);
  await host.waitForFunction(() => window.__tk && window.__tk.get().peerReady, null, { timeout: 40000 }).catch(() => { });
  await settle(host);
  // the phone-steering checks run on Skyland Sprint, where a long tilt can't end in lava (the full race below still picks a random track)
  await host.evaluate(() => window.__tk && window.__tk.setTrack(0)).catch(() => { });
  const h0 = await host.evaluate(() => window.__tk ? window.__tk.get() : null);
  ok(h0 && h0.peerReady, 'the right access code opens the game, which registers with the pairing service');
  if (wantsIcon) await checkHome(host, hostGateHome, 'game page');
  await sleep(800); await snap(host, '1-lobby.png');
  const link = await host.evaluate(() => window.__tk.link());

  // --- phone page: typed code ---
  const p2 = await open({ viewport: { width: 780, height: 360 }, isMobile: true, hasTouch: true }, base + 'controller.html', true);
  const p2GateHome = wantsIcon ? await homeScreen(p2) : null;
  await enter(p2, wrong); await p2.waitForFunction(() => /not right/.test(document.getElementById('err').textContent), null, { timeout: 30000 }).catch(() => { });
  const refused = await p2.evaluate(() => !window.__tc);
  await enter(p2, CODE); await p2.waitForFunction(() => window.__tc, null, { timeout: 30000 }).catch(() => { });
  ok(refused && await p2.evaluate(() => !!window.__tc && document.getElementById('needcode').style.display !== 'none'), 'phone page: wrong code refused, right code opens and asks for the game code');
  if (wantsIcon) await checkHome(p2, p2GateHome, 'phone page');
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

  // --- the Home screen: pick a kart and a track from the phone, then START ---
  await phone.waitForFunction(() => window.__tc.get().menu, null, { timeout: 8000 }).catch(() => { });
  const homeR = await host.evaluate(() => window.__tk.choice());
  ok(homeR.track === 9 && (await host.evaluate(() => document.querySelector('#trk-list .trk').dataset.t)) === '9', 'a first visit opens on Random, which is the first track button');
  await host.keyboard.press('ArrowDown');          // Random -> Skyland Sprint, so the checks below start from a known track
  await host.waitForFunction(() => window.__tk.choice().track === 0 && window.__tk.choice().trackName === 'Skyland Sprint', null, { timeout: 30000 }).catch(() => { });
  await phone.waitForFunction(() => /Skyland/.test(window.__tc.get().track), null, { timeout: 8000 }).catch(() => { });
  const home0 = await host.evaluate(() => window.__tk.choice()), menu0 = await phone.evaluate(() => window.__tc.get());
  ok(home0.home && (await host.evaluate(() => window.__tk.get().phase)) === 'lobby' && menu0.menu && menu0.kart.length > 0, 'the game opens on the Home screen and the phone shows the kart & track menu (' + menu0.kart + ', ' + menu0.track + ')');
  if (LB_ORIGIN) {
    await host.waitForFunction(() => window.__tk.lb().home.length > 0, null, { timeout: 15000 }).catch(() => { });
    const hb = await host.evaluate(() => window.__tk.lb());
    ok(hb.on && hb.home.length === 2 && /Ace/.test(hb.home[0]), 'the Home screen shows the track\'s top times from the leaderboard (' + hb.home.join(' / ') + ')');
  }
  await phone.dispatchEvent('#kn', 'pointerdown', { pointerId: 2, bubbles: true });
  await host.waitForFunction(k => window.__tk.choice().kart[0] !== k, home0.kart[0], { timeout: 8000 }).catch(() => { });
  const home1 = await host.evaluate(() => window.__tk.choice());
  await phone.waitForFunction(n => window.__tc.get().kart !== n, menu0.kart, { timeout: 5000 }).catch(() => { });
  const menu1 = await phone.evaluate(() => window.__tc.get()); await snap(phone, '2-phone-home.png'); await snap(host, '1b-home.png');
  ok(home1.kart[0] !== home0.kart[0] && home1.p1kart === home1.kart[0] && menu1.kart !== menu0.kart, 'the phone changes Player 1\'s kart, on the start line too (' + menu0.kart + ' → ' + menu1.kart + ')');
  await phone.dispatchEvent('#tn', 'pointerdown', { pointerId: 2, bubbles: true });
  await host.waitForFunction(t => window.__tk.choice().track !== t, home0.track, { timeout: 30000 }).catch(() => { });
  const home2 = await host.evaluate(() => window.__tk.choice());
  await phone.dispatchEvent('#tp', 'pointerdown', { pointerId: 2, bubbles: true });
  await host.waitForFunction(t => window.__tk.choice().track === t, home0.track, { timeout: 30000 }).catch(() => { });
  const home3 = await host.evaluate(() => window.__tk.choice());
  ok(home2.track === (home0.track + 1) % 10 && home3.track === home0.track && home3.trackName === home0.trackName, 'the phone changes the track and back (' + home0.trackName + ' → ' + home2.trackName + ' → ' + home3.trackName + ')');
  await host.evaluate(() => window.__tk.setTrack(0)).catch(() => { }); await settle(host);
  // --- the kart showroom, opened from the Home screen ---
  await host.click('#home-showroom');
  await host.waitForFunction(() => window.__tk.showroom().open, null, { timeout: 30000 }).catch(() => { });
  const sr0 = await host.evaluate(() => window.__tk.showroom());
  await host.keyboard.press('ArrowRight');
  await host.waitForFunction(c => window.__tk.showroom().cur !== c, sr0.cur, { timeout: 30000 }).catch(() => { });
  const sr1 = await host.evaluate(() => window.__tk.showroom()); await sleep(2500); await snap(host, '1c-showroom.png');
  await host.click('#sr-pick0');
  await host.waitForFunction(() => !window.__tk.showroom().open, null, { timeout: 30000 }).catch(() => { });
  const sr2 = await host.evaluate(() => ({ s: window.__tk.showroom(), c: window.__tk.choice() }));
  ok(sr0.open && sr0.cur === home1.kart[0] && sr1.cur !== sr0.cur && !sr2.s.open && sr2.c.home && sr2.c.kart[0] === sr1.cur && sr2.c.p1kart === sr1.cur,
    'the Home screen\'s showroom opens on Player 1\'s kart; choosing another there returns to the Home screen with it (kart ' + sr0.cur + ' → ' + sr2.c.kart[0] + ')');
  await settle(host);
  await phone.dispatchEvent('#mstart', 'pointerdown', { pointerId: 2, bubbles: true });
  await host.waitForFunction(() => window.__tk.get().phase !== 'lobby', null, { timeout: 12000 }).catch(() => { });
  await phone.dispatchEvent('#gas', 'pointerdown', { pointerId: 1, bubbles: true });
  await host.waitForFunction(() => window.__tk.get().phase === 'race', null, { timeout: 12000 }).catch(() => { });
  ok((await host.evaluate(() => window.__tk.get().phase)) === 'race' && !(await host.evaluate(() => window.__tk.choice().home)), 'START on the phone starts the race');
  await host.waitForFunction(() => { const s = window.__tk.get(); return s.lap === 0 && s.idx > 12 && s.speed > 20; }, null, { timeout: 30000 }).catch(() => { });
  await sleep(500);
  const a = await host.evaluate(() => window.__tk.get());
  ok(a.speed > 20, 'holding GAS accelerates the kart (speed ' + a.speed.toFixed(1) + ')');
  await phone.evaluate(() => { window.__tiltTimer = setInterval(() => window.__tc.tilt({ beta: -25, gamma: 0 }), 30); });
  await sleep(1600);
  const s1 = await phone.evaluate(() => window.__tc.get().s), b = await host.evaluate(() => window.__tk.get());
  ok(s1 < -0.5 && b.th - a.th > 0.2, 'tilting left steers left (steer ' + s1.toFixed(2) + ', heading change ' + (b.th - a.th).toFixed(2) + ')');
  await phone.evaluate(() => { clearInterval(window.__tiltTimer); window.__tiltTimer = setInterval(() => window.__tc.tilt({ beta: 25, gamma: 0 }), 30); });
  await sleep(1600);
  const c = await host.evaluate(() => window.__tk.get());
  ok(c.th - b.th < -0.2, 'tilting right steers right (steer ' + (await phone.evaluate(() => window.__tc.get().s)).toFixed(2) + ', heading change ' + (c.th - b.th).toFixed(2) + ')');
  await snap(host, '3-race.png');
  // the phone's middle button pauses and resumes the race
  await phone.dispatchEvent('#pause', 'pointerdown', { pointerId: 3, bubbles: true });
  await host.waitForFunction(() => window.__tk.get().paused, null, { timeout: 5000 }).catch(() => { });
  const pz1 = await host.evaluate(() => window.__tk.get().paused); await sleep(500);
  const plabel = await phone.evaluate(() => window.__tc.get().pause); await snap(phone, '2b-phone-paused.png');
  await phone.dispatchEvent('#pause', 'pointerdown', { pointerId: 3, bubbles: true });
  await host.waitForFunction(() => !window.__tk.get().paused, null, { timeout: 5000 }).catch(() => { });
  const pz2 = await host.evaluate(() => window.__tk.get().paused); await sleep(400);
  ok(pz1 && !pz2 && /RESUME/.test(plabel), "the phone's middle button pauses and resumes the race (button showed " + plabel + ')');
  await snap(phone, '2c-phone-racing.png');
  // --- after a race the phone asks for a name for the leaderboard; it is saved and highlighted ---
  if (LB_ORIGIN) {
    await host.evaluate(() => window.__tk.finishTest());
    await phone.waitForFunction(() => window.__tc.get().ask, null, { timeout: 10000 }).catch(() => { });
    const asked = await phone.evaluate(() => window.__tc.get().ask); await snap(phone, '2e-phone-name.png');
    await phone.fill('#nbin', 'Check Racer'); await phone.dispatchEvent('#nbok', 'pointerdown', { pointerId: 2, bubbles: true });
    await host.waitForFunction(() => window.__tk.lb().board.some(r => r.startsWith('*') && /Check Racer/.test(r)), null, { timeout: 15000 }).catch(() => { });
    const lb1 = await host.evaluate(() => window.__tk.lb()); await phone.waitForFunction(() => /#\d/.test(window.__tc.get().lbs), null, { timeout: 8000 }).catch(() => { });
    const lbs = await phone.evaluate(() => window.__tc.get().lbs); await snap(host, '3c-leaderboard.png');
    const row = FAKE_DB.find(x => x.name === 'Check Racer');
    ok(asked && row && row.track === 'skyland' && row.time_ms > 60000 && lb1.board.some(r => r.startsWith('*') && /Check Racer/.test(r)) && lbs.includes('#' + (FAKE_DB.filter(x => x.track === 'skyland' && row && x.time_ms < row.time_ms).length + 1) + ' '), 'after a race the phone asks for a name; it is saved, ranked and highlighted (' + lbs + ')');
    await phone.dispatchEvent('#pause', 'pointerdown', { pointerId: 3, bubbles: true });
    await host.waitForFunction(() => window.__tk.get().phase === 'race', null, { timeout: 20000 }).catch(() => { });
    ok((await host.evaluate(() => window.__tk.get().phase)) === 'race', 'the middle button races again after the results');
  }
  // --- a second phone joins as Player 2: split screen, its own kart ---
  const phoneB = await open({ viewport: { width: 780, height: 360 }, isMobile: true, hasTouch: true }, link);
  await phoneB.waitForFunction(() => window.__tc, null, { timeout: 30000 }).catch(() => { });
  await phoneB.click('#go').catch(() => { });
  await host.waitForFunction(() => window.__tk.players().two, null, { timeout: 25000 }).catch(() => { });
  const two = await host.evaluate(() => window.__tk.players());
  await phoneB.waitForFunction(() => window.__tc.get().me === 2, null, { timeout: 5000 }).catch(() => { });
  ok(two.two && two.p2.player && await phoneB.evaluate(() => window.__tc.get().me === 2) && await host.evaluate(() => document.body.classList.contains('split')), 'a second phone joins as Player 2 and the screen splits');
  await phoneB.dispatchEvent('#gas', 'pointerdown', { pointerId: 1, bubbles: true });
  await sleep(1200);
  const q0 = await host.evaluate(() => window.__tk.players().p2);
  await phoneB.evaluate(() => { window.__tiltTimer = setInterval(() => window.__tc.tilt({ beta: -25, gamma: 0 }), 30); });
  await sleep(1600);
  const q1 = await host.evaluate(() => window.__tk.players().p2); await snap(host, '3b-split.png'); await snap(phoneB, '2d-phone-p2.png');
  ok(!q1.auto && q1.speed > 10 && q1.th - q0.th > 0.2, 'Player 2 drives their own kart (speed ' + q1.speed.toFixed(1) + ', heading change ' + (q1.th - q0.th).toFixed(2) + ')');
  await phoneB.close();
  await host.waitForFunction(() => window.__tk.get().paused && /Player 2/.test(document.getElementById('lobby-title').textContent), null, { timeout: 8000 }).catch(() => { });
  const ptl = await host.evaluate(() => (window.__tk.get().paused ? 'paused: ' : 'running: ') + document.getElementById('lobby-title').textContent);
  ok(/^paused: .*Player 2/.test(ptl), "race pauses when Player 2's phone drops off (" + ptl + ')');
  await phone.close(); await sleep(2200);
  const d = await host.evaluate(() => window.__tk.get());
  ok(d.paused && !d.alive, 'race pauses when the phone drops off');
  await host.close();

  // --- keyboard: drift + mini-turbo, items, whole race ---
  if (process.argv.includes('--full')) {
    // drift + mini-turbo on Skyland Sprint, where a held hard turn can't end in lava (and a rescue would reset the charge)
    const dp = await open({ viewport: { width: 640, height: 360 } }, base);
    await enter(dp, CODE); await dp.waitForFunction(() => window.__tk, null, { timeout: 40000 }); await dp.evaluate(() => window.__tk.setTrack(0)); await settle(dp);
    await dp.keyboard.press('Enter'); await dp.waitForFunction(() => window.__tk.get().phase !== 'lobby', null, { timeout: 20000 }).catch(() => { });
    await dp.keyboard.down('ArrowUp');
    await dp.waitForFunction(() => { const s = window.__tk.get(); return s.phase === 'race' && s.lap === 0 && s.idx > 12 && s.speed > 30; }, null, { timeout: 60000 }).catch(() => { });
    await dp.keyboard.down('ArrowLeft'); await dp.keyboard.down('ShiftLeft');
    await dp.waitForFunction(() => window.__tk.get().charge > 1, null, { timeout: 15000 }).catch(() => { });
    const dr = await dp.evaluate(() => window.__tk.get()); await snap(dp, '4-drift.png');
    // watch every frame from the moment DRIFT is let go, so a short (blue) mini-turbo can't slip between samples
    await dp.evaluate(() => { window.__boostSeen = 0; (function w() { const s = window.__tk.get(); if (s.boost > window.__boostSeen) window.__boostSeen = s.boost; if (!window.__boostStop) requestAnimationFrame(w); })(); });
    await dp.keyboard.up('ShiftLeft'); await dp.keyboard.up('ArrowLeft'); await sleep(400);
    const af = await dp.evaluate(() => { window.__boostStop = 1; return Object.assign(window.__tk.get(), { boost: window.__boostSeen }); });
    ok(dr.drift !== 0 && dr.charge > 1 && af.boost > 0 && af.drift === 0, 'drifting charges up and releasing gives a mini-turbo (charge ' + dr.charge.toFixed(2) + ', boost ' + af.boost.toFixed(2) + ')');
    await dp.close();
    // a whole race on whichever track comes up
    const solo = await open({ viewport: { width: 640, height: 360 } }, base);
    await enter(solo, CODE); await solo.waitForFunction(() => window.__tk, null, { timeout: 40000 }); await settle(solo);
    const trackName = await solo.evaluate(() => window.__tk.track().name);
    await solo.keyboard.press('Enter'); await solo.waitForFunction(() => window.__tk.get().phase !== 'lobby', null, { timeout: 20000 }).catch(() => { });
    await solo.keyboard.down('ArrowUp');
    await solo.waitForFunction(() => window.__tk.get().phase === 'race', null, { timeout: 60000 }).catch(() => { });
    // the rest of the race: the game's own driver steers (as a phone would, smoothly); items are still used with Space
    await solo.evaluate(() => window.__tk.autopilot(true));
    let t0 = Date.now(), gotItem = false, usedItem = false, last = null, fell = 0;
    while (Date.now() - t0 < 420000) {
      const s = last = await solo.evaluate(() => window.__tk.get()); if (s.phase === 'finished') break;
      if (s.item) { gotItem = true; const before = s.item + s.uses; await solo.keyboard.press('Space'); await sleep(60); const a = await solo.evaluate(() => window.__tk.get()); if ((a.item || '') + a.uses !== before) usedItem = true; }
      await sleep(40);
    }
    const st = await solo.evaluate(() => window.__tk.stats());
    console.log('     race on ' + trackName + ': ' + st.map(k => k.name + ' ' + (k.fin !== null ? k.fin + 's' : 'lap ' + k.lap) + ' hits ' + k.hits + ' falls ' + k.falls).join(' | '));
    ok(gotItem && usedItem, 'item boxes hand out items that can be used');
    ok(last.phase === 'finished', 'a full race can be finished (time ' + last.raceT.toFixed(1) + 's, place ' + last.place + ')');
    await sleep(500); await snap(solo, '5-finish.png');
    await solo.keyboard.up('ArrowUp');
    if (LB_ORIGIN) {
      await solo.waitForSelector('#lb-ask input', { timeout: 10000 }).catch(() => { });
      await solo.fill('#lb-ask input', 'Keyboard Kid'); await solo.press('#lb-ask input', 'Enter');
      await solo.waitForFunction(() => window.__tk.lb().board.some(r => r.startsWith('*') && /Keyboard Kid/.test(r)), null, { timeout: 15000 }).catch(() => { });
      const lb2 = await solo.evaluate(() => window.__tk.lb());
      ok(lb2.board.some(r => r.startsWith('*') && /Keyboard Kid/.test(r)) && (await solo.evaluate(() => window.__tk.get().phase)) === 'finished', 'a keyboard racer can type a name on the computer; it is saved and highlighted');
    }
    await solo.keyboard.press('KeyH');
    await solo.waitForFunction(() => window.__tk.get().phase === 'lobby' && window.__tk.choice().home, null, { timeout: 15000 }).catch(() => { });
    ok(await solo.evaluate(() => window.__tk.get().phase === 'lobby' && window.__tk.choice().home), 'after a race, HOME goes back to the Home screen');
    await solo.close();
  }

  ok(errors.length === 0, 'no console, CSP or integrity errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  if (LB_ORIGIN) ok(lbCalls.length > 0, 'leaderboard requests go only to the approved database (' + lbCalls.length + ' answered by the stand-in, none left this machine)');
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
