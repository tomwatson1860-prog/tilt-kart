# Tilt Kart

Website: https://tomwatson1860-prog.github.io/tilt-kart/

A kart racing game where the computer is the screen and a phone is the steering wheel. It is an original,
home-made game and is not affiliated with Nintendo or Mario Kart.

The site asks for an access code. The game (its code and its race track) is stored in `index.html` and
`controller.html` in encrypted form (AES-256-GCM, with the key derived from the access code) and is decrypted
in the visitor's browser, so this repository holds no readable copy of it. Ask the owner for the code.

## Play

1. Open the website on a computer and enter the access code.
2. Scan the QR code with a phone and tap **Start** (allow motion access if asked). The QR
   link carries the access code, so the phone does not ask for it.
3. Hold the phone sideways. Tilt to steer, right thumb = **GAS**, left thumb = **DRIFT** / **BRAKE**,
   **ITEM** uses what you picked up.

- Hold DRIFT in a corner until sparks show, then let go for a mini-turbo (blue sparks, then orange for a longer one).
- Press GAS just as the countdown reaches 1 for a rocket start.
- Item boxes give a Turbo, a Bowler (rolls ahead and spins out whoever it hits) or a Slick (dropped behind you).
- Coins raise your top speed a little, up to 10.

No phone? Arrow keys steer, Up = gas, Down = brake, Shift = drift, Space = item.

## How the phone talks to the computer

The two pages find each other through the public PeerJS pairing service (`wss://0.peerjs.com`), then connect
to each other. To do that across different networks they use PeerJS's standard helpers: Google's address-lookup
server (`stun.l.google.com`) and, only when no direct link is possible, the PeerJS relay (`turn.peerjs.com`).
Steering is encrypted between the phone and the computer, so a relay cannot read it. These are the only
outside connections the site makes.

## Updating the site

The source is kept encrypted in `source.enc`. With the access code:

```
ACCESS_CODE=<code> node tools/unpack_source.js <a folder outside this repository>
ACCESS_CODE=<code> node tools/build_site.js <that folder>
ACCESS_CODE=<code> NODE_PATH=<folder with playwright, peer and ws> node tools/check_site.js --full
```

`build_site.js` applies the safety rules below, bundles the game code and race track into each page, encrypts
it with the code screen in `tools/gate.html` and checks its own output. `check_site.js` opens the result in a
headless browser and only passes when a wrong code is refused, the right code opens the game, a phone page
pairs and drives the kart, nothing loads from other servers, and altered copies of the fingerprinted files are
refused. The access code is never stored in this repository.

## Safety

- Everything the pages need is served from this site. The libraries (three.js 0.160.0, PeerJS 1.5.4 and
  qrcode-generator 1.4.4) are in `lib/`, with their licences. Each is fingerprinted (Subresource Integrity,
  SHA-384), so a browser refuses any copy that has been altered.
- The code screen sets a Content Security Policy that blocks loading anything from other servers, with one
  exception: the phone-pairing connection to `wss://0.peerjs.com`. The phone-to-computer link itself (WebRTC) and its
  helper servers are not covered by that policy. No referrer is sent.
- No cookies, analytics or forms that send data; the access code is checked in the visitor's browser and
  never leaves it.
- A short access code only keeps casual visitors out: the encrypted page can be saved and every code tried
  offline. Use a long random code if the game ever needs real protection.
