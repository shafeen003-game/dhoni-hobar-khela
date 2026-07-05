# ধনী হবার মজার খেলা (Dhoni Hobar Mojar Khela)

A real-time multiplayer property-trading board game, built around your custom
Bangladeshi board (Sylhet, Mymensingh, Chittagong, Dhaka areas) and your
printed rulebook's rules.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:3000** — share that address (or your machine's
LAN IP, e.g. `http://192.168.x.x:3000`) with friends on the same network so
they can join from their phones. No accounts, no installs — guests just pick
a name, an avatar/token, and a color.

## What's implemented

- Room system: create/join with a 6-character code, 2–6 players, host controls, ready-check
- Guest player setup: name, token (car/boat/hat/dog/plane/camera), color
- Your custom board, in the exact order from your photo (40 tiles, 4 corners)
- ৳2,800 starting money, ৳200 pass-Start bonus, ৳50 jail fine, 3-doubles-to-jail
- Buying property, decline → live auction with countdown
- Rent (incl. color-set double rent), railway rent that scales with stations owned,
  utility rent based on dice roll
- Mortgage / un-mortgage (10% interest to repay)
- Houses → hotel building once a full color group is owned, with rising rent
- সুযোগ (Chance) and ভাগ্য পরীক্ষা (Luck) decks (16 cards each — easy to extend, see `server/cards.js`)
- Simple trading (cash + properties, other player accepts/declines)
- Bankruptcy flow: mortgage/sell first, then voluntary bankruptcy → assets transfer to creditor or bank
- Turn management, live dice, in-room chat, event log, dark/light mode, mute toggle
- Reconnect: refreshing the page rejoins your seat (session id stored in `localStorage`)

## Deliberately scoped down for this first pass

Given the size of the original spec, a few things were simplified so the core
game is solid and actually playable rather than half-built everywhere:

- **Cards**: 16 Chance + 16 Luck cards each (not 30) — the deck structure in
  `server/cards.js` makes it trivial to add more entries.
- **Sound**: procedurally-generated beeps (Web Audio), not licensed sound effects/music —
  no audio asset files were bundled.
- **Persistence**: game state lives in server memory. Reconnecting mid-game
  works as long as the server process hasn't restarted. Swapping in SQLite
  for durable save/resume is a natural next step (schema would mirror the
  `Room`/`player` shapes in `server/gameEngine.js`).
- **Animations**: dice roll, token movement, and modal transitions are
  animated; there's no confetti/particle layer yet.
- No "auction floor" for houses (only mortgage/build/sell from the properties panel).

None of this is hard to add — happy to layer any of it in next.

## Project structure

```
server.js              Express + Socket.IO wiring (all game events)
server/gameEngine.js    Core game rules engine (Room class)
server/rooms.js         Room code generation + lifecycle
server/cards.js         Chance & Luck decks
public/index.html       All screens/modals
public/css/style.css    Design system + layout
public/js/board-data.js Shared board/tile data (Node + browser)
public/js/main.js       Client app (Socket.IO wiring, rendering)
```
