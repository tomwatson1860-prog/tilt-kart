# Tommio Kart

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
3. The Home screen comes first. Pick your kart (12 to choose from) and a track (Skyland Sprint, Inferno Keep,
   Aurora Glacier, or Random for a different one every race) on the phone's menu, or with the mouse or arrow keys
   on the computer. The camera circles your kart on the start line of the chosen track. Press START (Enter on the
   keyboard) to race. Your picks are remembered on that computer.
4. Hold the phone sideways. Tilt to steer, right thumb = **GAS**, left thumb = **DRIFT** (top) and **ITEM**
   (bottom). The big middle button starts a race, then pauses and resumes it (P on the keyboard does the same).
5. Two players: a second phone scans the same QR code and joins as Player 2, picking their own kart on the
   Home screen (Player 1 picks the track). The screen splits top / bottom,
   each half following one player's kart with its own items, place and lap (the four computer drivers still race).
   Either phone can start or pause. If a phone drops mid-race the race pauses; if Player 2's phone stays away
   for 15 seconds its kart goes back to a computer driver. The results show both players and who won the duel.
6. After a race: RACE AGAIN (the phone's middle button, Enter) runs the same track again (or a new one on
   Random); HOME (on the phone, or H) goes back to the Home screen.
7. Leaderboard: after a race, each player who finished is asked for a name (on their phone, or in the box on
   the computer; Skip is fine). The time goes on a shared online leaderboard for that track, and the results show
   the track's top 10 with your new time highlighted and your overall rank. The Home screen shows the top 5 for the
   chosen track.

- Three tracks, chosen on the Home screen (or Random: a different one each race, never the same twice in a row):
  Skyland Sprint, Inferno Keep and Aurora Glacier. Scenery comes from each track's map file; each has its own road layout and landmark.
- Inferno Keep: everything off the road is lava. The road runs on rock causeways and bridges, so drive off it
  and the cloud fishes you out. The route runs straight through a walled castle (arched gates with drawbridges and
  a raised portcullis, round and square towers, battlements, banners, a great keep with lit windows and a great
  hall), then climbs and crosses back over the top of it. Three volcanoes smoke in the lava sea and erupt every
  few seconds: the road glows red where lava bombs will land, then they splash down and coat one half of that
  stretch for a few seconds. Lava also floods three other stretches at random.
- Aurora Glacier: starts low in the glacier valley inside a snowstorm (short visibility), runs through an ice cave,
  then spirals up a mountain to a glowing crystal summit where the storm clears and the northern lights fill the
  sky. The run back down is twice as steep as the climb and very fast, with camera shake, speed lines and a
  slightly loose feel (only there; the other tracks drive normally). Three stretches freeze over at random and
  turn slippery for several seconds.
- Karts: 12 original kart models (Sunburst Sprinter, Neon Phantom, Retro Rocket, Desert Drifter, Arctic Comet,
  Volcano Viper, Garden Glider, Midnight Mach, Candy Circuit, Titan Torque, Cobalt Streak, Jungle Jumper). Each is a
  sculpted, high-detail model built in the game: its own body shape (Grand Prix racer, wedge, 1950s streamliner, muscle
  car, dune buggy or armoured truck), clear-coat paint with metallic flake and its own paint design and race number,
  treaded tyres with sidewall lettering, its own rims with brake discs and callipers, and extras such as wings, roll
  cages, exhausts, glowing lights and underglow. A helmeted driver in a matching race suit sits at the wheel; the
  wheels spin and the front wheels steer. Each player picks their own kart on the
  Home screen; the computer drivers get a different mix of the others every race.
- Graphics: soft physically based materials lit by each track's own sky, real sun shadows, a glow on bright things
  (lava, flames, sparks, headlights, item boxes), smoother scenery, detailed ground, glossy items. On a slow computer
  the game lowers its own quality step by step (sharpness, then glow, then shadows, then resolution).
- Each track has its own original soundtrack, made live in the browser: a bright, bouncy tune for Skyland Sprint,
  a dark, driving one with a castle bell for Inferno Keep (a low rumble joins while lava flows), and for Aurora Glacier a
  different tune each time you race there, in turn: its own airy theme, then public-domain carols arranged as
  Christmas sleigh rides ("Jingle Bells", "Deck the Halls", "We Wish You a Merry Christmas"), with sleigh bells and
  a glockenspiel. The lobby shows which tune is up; the high bells ring brighter under the northern lights and
  the jingles speed up on the descent.
- Skyland Sprint: a figure-8 across the floating island with a high bridge over the lower straight, a giant pipe
  tunnel, a jump over the pond and a road that loops out over the clouds. Off the road is grass (slower). The road
  over the clouds has no side rails: drive off it, or off the island's edge, and a smiling cloud fishes you out
  with its rod and sets you back on the track (it takes 3 seconds and costs 2 coins).
- Hold DRIFT through a corner: blue sparks, then orange, then pink. Let go for a mini-turbo; the longer the
  drift, the bigger the boost. Tap DRIFT in the air off the jump for a trick and a boost when you land.
- Press GAS just as the countdown reaches 1 for a rocket start.
- Item boxes give Mario Kart-style items (original designs): banana, triple banana, green shell, triple green,
  red shell (homes in on the kart ahead), triple red, blue shell (hits the leader), rocket (drives you ahead),
  lightning (shrinks everyone else), ink (splats the screens of the karts ahead), turbo, triple turbo and star.
  The further back you are, the better the item. Triple bananas and shells also block one hit.
- Coins raise your top speed a little, up to 10; getting hit or falling off costs coins.
- Original race music (synthesised in the browser, no audio files) plays from GO, speeds up on the final lap and
  sparkles while you have a Star. Press M on the computer to turn it off or on. If there is no sound, click the
  game screen once.

No phone? Arrow keys steer, Up = gas, Down = brake, Shift = drift (and tricks), Space = item, M = music.

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

## Leaderboard database

The leaderboard lives in a free Supabase project (Postgres). Only its address is in this repository (it is an
approved connection in `tools/libs.json` and the pages' Content Security Policy); the public "publishable" key is
added at build time from `LB_URL` / `LB_KEY` or the source's `config.json`, and ends up only inside the encrypted
page. The `scores` table accepts only sensible entries (a known track, a name of 1-16 characters without `<` or `>`,
a realistic time, kart 1-12) and the public key can only read and add rows: changing or deleting entries, or
back-dating them, is refused. To remove a name, delete its row in the Supabase dashboard (Table Editor, `scores`).
Free Supabase projects pause after a week with no activity; if the leaderboard stops loading after a quiet spell,
sign in to Supabase and restore the project (no scores are lost).
