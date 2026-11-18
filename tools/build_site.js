#!/usr/bin/env node
/*
 Build the code-protected Tilt Kart website from its (private) source folder.

   ACCESS_CODE=<code> node tools/build_site.js <source folder>

 The source folder holds index.html, controller.html, game.js, controller.js and the race-track files in assets/.
 It is NOT kept in this repository in readable form: the build stores an encrypted copy in source.enc
 (restore it with tools/unpack_source.js).

 Safety rules it enforces (the build stops with an error if any fails):
   - Every library is served from this site (lib/), pinned by version and fingerprinted (Subresource
     Integrity, sha384). The lib/ files must still match the fingerprints in tools/libs.json.
   - Every <script src> must be one of those local, fingerprinted files.
   - Nothing may load from another server: no outside scripts, stylesheets, images, frames, @import,
     url(http...) or fetch("http...").
   - The code screen (tools/gate.html) carries a Content Security Policy that only allows this site's own
     files, the pages' inline code and the one approved phone-pairing connection (wss://0.peerjs.com).
   - Optional tools/head.html (home-screen icon, app manifest, full-screen mode) may only hold <link>/<meta>
     tags pointing at files on this site; the icon must be an opaque 180x180 PNG and the manifest may not
     point anywhere else. The tags go into the code screen (at <!--HEAD--> in tools/gate.html) and into both
     unlocked pages, because a phone reads them from whatever page is showing.
 Each page (with its game code and the race-track file bundled in) is gzipped and encrypted with
 AES-256-GCM (key from the access code via PBKDF2-SHA-256, 1,000,000 iterations, fresh salt and IV), put
 into the code screen, and decrypted again to check it. The access code is read from the environment only;
 never put it in a file in this repository. Uses only Node's built-in modules.
*/
const crypto = require('crypto'), fs = require('fs'), zlib = require('zlib'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const fail = m => { console.error('build_site: ' + m); process.exit(1); };
const src = process.argv[2], code = process.env.ACCESS_CODE;
if (!src) fail('usage: ACCESS_CODE=<code> node tools/build_site.js <source folder>');
if (!code) fail('ACCESS_CODE is not set');
const sri = b => 'sha384-' + crypto.createHash('sha384').update(b).digest('base64');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'libs.json'), 'utf8')), libs = cfg.libs;
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' " + cfg.allowedConnections.join(' ') + "; manifest-src 'self'; base-uri 'none'; form-action 'none'";

for (const l of libs) if (sri(fs.readFileSync(path.join(ROOT, l.local))) !== l.integrity) fail(l.local + ' does not match its fingerprint in tools/libs.json');

const read = f => fs.readFileSync(path.join(src, f), 'utf8');
const inline = js => js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
function assemble(name, parts) {
  let page = read(name);
  for (const k in parts) { if (page.split('{{' + k + '}}').length !== 2) fail(name + ' must contain {{' + k + '}} exactly once'); page = page.replace('{{' + k + '}}', () => parts[k]); }
  page = page.replace(/\{\{SRI:([^}]+)\}\}/g, (m, p) => { const l = libs.find(x => x.local === p); if (!l) fail(name + ': no fingerprint for ' + p); return l.integrity; });
  if (/\{\{[A-Z_:]+/.test(page)) fail(name + ' still has an unfilled {{placeholder}}');
  const used = [];
  for (const t of page.match(/<script\b[^>]*\bsrc=[^>]*>/gi) || []) {
    const s = (t.match(/\bsrc="([^"]*)"/) || [])[1], l = libs.find(x => x.local === s);
    if (!l) fail(name + ': script is not a pinned local library: ' + t);
    if (!t.includes('integrity="' + l.integrity + '"')) fail(name + ': script without its fingerprint: ' + t);
    used.push(l.local);
  }
  const outside = [];
  for (const m of page.matchAll(/<(script|link|iframe|frame|img|image|source|video|audio|embed|object|track|use)\b[^>]*?\b(?:src|href|data|xlink:href|srcset)="\s*(?:https?:)?\/\/[^"]*"[^>]*>/gi)) outside.push(m[0].slice(0, 140));
  for (const m of page.matchAll(/@import[^;]*?(?:https?:)?\/\/[^;]*;|url\(\s*['"]?(?:https?:)?\/\/[^)]*\)|fetch\(\s*['"`](?:https?:)?\/\/[^'"`]*|new\s+WebSocket\(|XMLHttpRequest|<link\b[^>]*stylesheet/gi)) outside.push(m[0].slice(0, 140));
  if (outside.length) fail(name + ' loads from other servers:\n  ' + outside.join('\n  '));
  return { page, used };
}
function seal(buf) {
  const gz = zlib.gzipSync(buf, { level: 9 }), salt = crypto.randomBytes(16), iv = crypto.randomBytes(12), iter = 1000000;
  const key = crypto.pbkdf2Sync(code, salt, iter, 32, 'sha256'), c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(gz), c.final(), c.getAuthTag()]);
  const d = crypto.createDecipheriv('aes-256-gcm', crypto.pbkdf2Sync(code, salt, iter, 32, 'sha256'), iv); d.setAuthTag(ct.subarray(ct.length - 16));
  if (!zlib.gunzipSync(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])).equals(buf)) fail('self-check failed: decrypting the output does not give back the input');
  return JSON.stringify({ v: 1, iter, salt: salt.toString('base64'), iv: iv.toString('base64'), ct: ct.toString('base64') });
}

// home-screen icon and app mode: tools/head.html goes into the code screen and the unlocked pages
const headPath = path.join(__dirname, 'head.html');
const pngInfo = f => { const b = fs.readFileSync(f); return b.length > 26 && b.toString('latin1', 1, 4) === 'PNG' ? { w: b.readUInt32BE(16), h: b.readUInt32BE(20), colour: b[25] } : null; };
const local = (u, what) => { if (typeof u !== 'string' || !u || /^[a-z][a-z0-9+.-]*:|^\/\/|^\/|\.\./i.test(u)) fail(what + ' must point to a file on this site: ' + u); const f = path.join(ROOT, u.split(/[?#]/)[0]); if (!fs.existsSync(f)) fail(what + ' is missing: ' + u); return f; };
let headTags = '', homeScreen = null;
if (fs.existsSync(headPath)) {
  headTags = fs.readFileSync(headPath, 'utf8').trim();
  const other = headTags.replace(/<!--[\s\S]*?-->/g, '').replace(/<(?:link|meta)\b[^>]*>/gi, '').trim();
  if (other) fail('tools/head.html may only hold <link> and <meta> tags, found: ' + other.slice(0, 80));
  if (/(?:https?:)?\/\/|javascript:/i.test(headTags.replace(/<!--[\s\S]*?-->/g, ''))) fail('tools/head.html points to another server');
  homeScreen = {};
  for (const m of headTags.matchAll(/<link\b[^>]*>/gi)) {
    const rel = (m[0].match(/\brel="([^"]+)"/i) || [])[1], href = (m[0].match(/\bhref="([^"]+)"/i) || [])[1];
    if (!['apple-touch-icon', 'icon', 'manifest'].includes(rel)) fail('tools/head.html: unexpected <link rel="' + rel + '">');
    const f = local(href, 'tools/head.html ' + rel);
    if (rel === 'apple-touch-icon') {
      const p = pngInfo(f);
      if (!p || p.w !== 180 || p.h !== 180) fail('the home-screen icon must be a 180x180 PNG: ' + href);
      if (p.colour !== 2) fail('the home-screen icon must be opaque RGB (iPhones show transparent parts as black): ' + href);
      homeScreen.icon = p.w + 'x' + p.h;
    }
    if (rel === 'manifest') {
      let man; try { man = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { fail(href + ' does not parse: ' + e.message); }
      const walk = v => typeof v === 'string' ? (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(v) && fail(href + ' points to another server: ' + v)) : v && typeof v === 'object' && Object.values(v).forEach(walk);
      walk(man);
      if (man.start_url !== './' || man.scope !== './') fail(href + ': start_url and scope must be "./"');
      if (!man.short_name || man.short_name.length > 12) fail(href + ': short_name must be 1-12 characters so it fits under the icon');
      for (const ic of man.icons || []) { const p = pngInfo(local(ic.src, href + ' icon')); if (!p || ic.sizes !== p.w + 'x' + p.h) fail(href + ': ' + ic.src + ' is not a ' + ic.sizes + ' PNG'); }
      homeScreen.manifest = { name: man.short_name, display: man.display, icons: (man.icons || []).length };
    }
  }
  if (!homeScreen.icon) fail('tools/head.html has no apple-touch-icon');
  homeScreen.title = (headTags.match(/name="apple-mobile-web-app-title" content="([^"]*)"/) || [])[1];
}
function withHead(page) {      // the unlocked page replaces the code screen, so it carries the same tags
  if (!headTags) return page;
  page = page.replace(/<link\b[^>]*\brel="(?:apple-touch-icon|icon|shortcut icon|manifest)"[^>]*>\s*|<meta\b[^>]*\bname="(?:apple-mobile-web-app-[a-z-]+|mobile-web-app-capable|theme-color)"[^>]*>\s*/gi, '');
  if ((page.match(/<head\b[^>]*>/gi) || []).length !== 1) fail('each page must contain exactly one <head> tag');
  return page.replace(/<head\b[^>]*>/i, h => h + '\n' + headTags + '\n');
}

const gate = fs.readFileSync(path.join(__dirname, 'gate.html'), 'utf8');
if (gate.split('/*PAYLOAD*/').length !== 2) fail('tools/gate.html must contain /*PAYLOAD*/ exactly once');
if (!gate.includes('<meta http-equiv="Content-Security-Policy" content="' + CSP + '">')) fail('tools/gate.html has lost its Content Security Policy (or it was changed)');
if (!gate.includes('<meta name="referrer" content="no-referrer">') || !/noindex,nofollow/.test(gate)) fail('tools/gate.html has lost its referrer or noindex tag');
if (/(?:src|href)="\s*(?:https?:)?\/\//i.test(gate)) fail('tools/gate.html loads something from another server');
if (gate.includes(code)) fail('the access code appears in tools/gate.html');
if (headTags && gate.split('<!--HEAD-->').length !== 2) fail('tools/gate.html must contain <!--HEAD--> exactly once (where tools/head.html goes)');
const gateOut = gate.replace(/<!--HEAD-->\n?/, () => headTags ? headTags + '\n' : '');

// leaderboard database (Supabase): address and public key from LB_URL / LB_KEY, or the source's config.json.
// They end up only inside the encrypted page; the address must be an approved connection (it is in the CSP).
let lbCfg = {}; try { lbCfg = JSON.parse(read('config.json')).leaderboard || {}; } catch (e) { }
const LB_URL = process.env.LB_URL !== undefined ? process.env.LB_URL : (lbCfg.url || ''), LB_KEY = process.env.LB_KEY !== undefined ? process.env.LB_KEY : (lbCfg.key || '');
if (LB_URL && !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(LB_URL)) fail('LB_URL must look like https://<project>.supabase.co');
if (LB_URL && !cfg.allowedConnections.includes(LB_URL)) fail('LB_URL is not in allowedConnections in tools/libs.json, so the browser would block it');
if (LB_KEY && !/^[A-Za-z0-9._-]{20,}$/.test(LB_KEY)) fail('LB_KEY does not look like a Supabase public key');
if (/service_role|sb_secret_/.test(LB_KEY) || (LB_KEY.split('.').length === 3 && /service_role/.test(Buffer.from(LB_KEY.split('.')[1], 'base64').toString()))) fail('LB_KEY is a secret (service) key – use the public anon / publishable key');
const indexParts = { GAME_JS: inline(read('game.js')), LB_URL: LB_URL, LB_KEY: LB_KEY };
for (const m of read('index.html').matchAll(/\{\{MAP_B64:([a-z0-9-]+\.glb)\}\}/g)) indexParts['MAP_B64:' + m[1]] = fs.readFileSync(path.join(src, 'assets', m[1])).toString('base64');
if (Object.keys(indexParts).length < 4) fail('index.html names no map files');
const pages = {
  'index.html': assemble('index.html', indexParts),
  'controller.html': assemble('controller.html', { CONTROLLER_JS: inline(read('controller.js')) })
};
const res = { ok: true, pages: {}, outsideLoads: 0, leaderboard: LB_URL ? 'on' : 'off' };
for (const name in pages) {
  pages[name].page = withHead(pages[name].page);
  const out = gateOut.replace('/*PAYLOAD*/', () => seal(Buffer.from(pages[name].page, 'utf8')));
  for (const marker of ['parseGLB', 'stepKart', 'deviceorientation', 'Z2xURg', 'tiltkart-c-']) if (out.includes(marker)) fail(name + ': readable game code found in the output (' + marker + ')');
  fs.writeFileSync(path.join(ROOT, name), out);
  res.pages[name] = { bytes: out.length, fingerprintedLibs: pages[name].used };
}

// encrypted copy of the source, so the site can be rebuilt later by someone who has the access code
const files = {};
(function walk(dir, rel) { for (const f of fs.readdirSync(dir).sort()) { const p = path.join(dir, f), r = rel ? rel + '/' + f : f; if (fs.statSync(p).isDirectory()) walk(p, r); else files[r] = fs.readFileSync(p).toString('base64'); } })(src, '');
fs.writeFileSync(path.join(ROOT, 'source.enc'), seal(Buffer.from(JSON.stringify(files), 'utf8')) + '\n');
fs.writeFileSync(path.join(ROOT, '.nojekyll'), '');
res.sourceFiles = Object.keys(files).length;
if (homeScreen) res.homeScreen = homeScreen;
console.log(JSON.stringify(res));
