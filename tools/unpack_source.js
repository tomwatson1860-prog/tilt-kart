#!/usr/bin/env node
// Restore the game's source from source.enc:  ACCESS_CODE=<code> node tools/unpack_source.js <empty folder outside this repository>
const crypto = require('crypto'), fs = require('fs'), zlib = require('zlib'), path = require('path');
const out = process.argv[2], code = process.env.ACCESS_CODE, ROOT = path.resolve(__dirname, '..');
if (!out || !code) { console.error('usage: ACCESS_CODE=<code> node tools/unpack_source.js <folder>'); process.exit(1); }
if (!path.relative(ROOT, path.resolve(out)).startsWith('..')) { console.error('choose a folder outside this repository, so no readable copy ends up in it'); process.exit(1); }
const P = JSON.parse(fs.readFileSync(path.join(ROOT, 'source.enc'), 'utf8')), ct = Buffer.from(P.ct, 'base64');
const d = crypto.createDecipheriv('aes-256-gcm', crypto.pbkdf2Sync(code, Buffer.from(P.salt, 'base64'), P.iter, 32, 'sha256'), Buffer.from(P.iv, 'base64'));
d.setAuthTag(ct.subarray(ct.length - 16));
let files; try { files = JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])).toString('utf8')); } catch (e) { console.error('wrong access code'); process.exit(1); }
for (const r in files) { if (r.includes('..') || path.isAbsolute(r)) continue; const p = path.join(out, r); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(files[r], 'base64')); }
console.log('restored ' + Object.keys(files).length + ' files to ' + out);
