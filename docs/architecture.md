# Architecture

The deployed system, the reasoning behind its shape, and the behaviour that follows from it.
For the settings an operator supplies, see [DEPLOYMENT.md](../DEPLOYMENT.md).

## Two deployments, one repository

```
        Vercel (static, from main)                Cloudflare (Worker + Durable Objects)
 ┌────────────────────────────────────┐      ┌────────────────────────────────────────┐
 │ draft-hold-em.binhnguyen.dev       │      │ ws.draft-hold-em.binhnguyen.dev        │
 │                                    │      │                                        │
 │ index.html  app.js  config.js      │      │ worker.js — routes an upgrade by code   │
 │ styles.css  rules-guide.html       │      │   ├── Durable Object "K7MPQ2R9"         │
 │ audio/                             │      │   │     players, sockets, engine, timer │
 │                                    │      │   └── Durable Object "T4XB9WCM"         │
 │ CDN, no server code                │      │         players, sockets, engine, timer │
 └──────────────────┬─────────────────┘      └────────────────────▲───────────────────┘
                    │ page load, invite links                     │ wss://
                    └──────────────► browser ─────────────────────┘
```

The client is static files with no build output beyond one generated line of configuration.
All game logic and all authority live in the Worker deployment.

The two halves are joined by exactly one value — the game server's origin — which appears in
`GAME_SERVER_URL` (written into `public/config.js` at build time) and in the `connect-src`
directive of the Content-Security-Policy in `vercel.json`. The build fails when they disagree,
because that mismatch is invisible everywhere except a player's browser console.

## Modules

| Path | Responsibility |
| --- | --- |
| `src/worker.js` | Entry point. Health endpoint, origin allowlist, room-creation rate limit, and routing an upgrade to the right Durable Object |
| `src/room.js` | The `Room` Durable Object: one room's players, sockets, lobby, engine instance and turn timer |
| `src/engine.js` | Game rules: drafting, tie-breaks, betting order, showdown, pots, payouts |
| `src/cards.js` | Deck, shuffling, hand evaluation |
| `src/security.js` | Origin allowlist and the numeric limits, read from Worker bindings |
| `public/` | The browser client, served by Vercel |
| `scripts/` | Local development, the UI smoke test, and the Vercel build step |

`engine.js` and `cards.js` are pure and transport-agnostic: they know nothing about sockets,
Workers or rooms, which is why the move off a Node server left them untouched.

## One Durable Object per room

A Durable Object is a named, addressable, single-threaded object with its own memory. That is
the same shape a server-authoritative card game already needs, one instance per room instead
of one process for every room:

| Requirement | How the platform satisfies it |
| --- | --- |
| All of a room's state in one place | The object *is* the room. Players, sockets, and the `DraftHoldemGame` instance are plain fields on it |
| Actions must not interleave | A Durable Object processes one event at a time. Poker actions do not commute, so this removes the locking that any shared-store design would need |
| Turn timers of 10–120s with no request in flight | Ordinary `setTimeout`. Using the standard WebSocket API rather than the Hibernation API keeps the object resident in memory while any socket is open |
| Hidden cards must never reach the wrong player | The object is the only authority. `stateFor(viewerId)` filters every broadcast per recipient, so a client is never sent information it may not see |
| Addressing a room by its code | `env.ROOM.getByName(code)` maps a room code to its object deterministically, with no registry to consult |

The Hibernation API is deliberately **not** used: it forbids `setTimeout`, which the turn
timers depend on, and it would require serialising the engine on every action.

## Why the game server is not a Vercel Function

Vercel Functions can serve WebSockets, but two documented properties rule them out for this
game. New connections are not guaranteed to reach the same function instance, so two players
in one room could land on instances with different in-memory state; and a connection is closed
when the function reaches its maximum duration, which is 300s on the Hobby plan. Vercel's own
guidance is to move room state and pub/sub coordination to an external store — for a
hidden-information card game with wall-clock timers, that means rewriting the authoritative
server, serialising the engine on every action, and adding per-room locking.

Vercel rewrites to external origins cover HTTP(S) only, so `wss://` cannot be proxied through
the Vercel domain either. The browser therefore dials the Cloudflare hostname directly, which
is why that origin is named in `connect-src`.

## Connection and room lifecycle

A socket belongs to one room for its whole life. The room code is chosen before the upgrade,
because the Durable Object must be selected before the connection is accepted.

```
Create                        Join / resume
──────                        ─────────────
GET /room/new                 GET /room/<CODE>
  │ worker mints a code         │ worker validates the code shape
  │ forwards with create=1      │ forwards to that object
  ▼                             ▼
Room object                   Room object
  │ 409 if already a room       │ accepts the socket
  │ accepts the socket          │
  ▼                             ▼
create_room {name}            join_room {name}   or   resume {token}
  ▼                             ▼
session {roomCode, playerId, token} ──► client stores the token per room code
  ▼
state {…} broadcast to every connected player, filtered per viewer
```

Consequences of this shape:

- **Room codes stay server-minted.** Only a connection the Worker marked `create=1` may
  initialise a room, so a player cannot claim a chosen code by connecting to `/room/<CODE>`.
- **An unknown code is not an error at the transport layer.** It addresses an uninitialised
  object, which answers `join_room` with "Room not found" — the same thing an expired invite
  link produces.
- **Reconnects only ever replay `resume`.** Replaying `create_room` or `join_room` would mint
  a second room or claim a second seat, so the client never does it automatically. A kicked
  player's socket closes for good; rejoining is a deliberate act.
- **Reconnect tokens rotate** every time they are used, and are stored per room code in the
  browser, so an invite link reopened later resumes the same seat while the room is alive.

## Trust boundary

Everything a player sends is untrusted input; everything authoritative is inside the Durable
Object.

- **Origin allowlist.** Browsers always send `Origin` on a WebSocket handshake, so the Worker
  refuses any upgrade whose origin is not configured. This is what stops another site from
  opening sockets against your rooms on a visitor's behalf.
- **Client IP.** Rate limiting keys on `CF-Connecting-IP`, which Cloudflare sets and a client
  cannot spoof — unlike the `X-Forwarded-For` header a self-hosted proxy would present.
- **Per-socket limits.** Message size and message rate are enforced per connection, with
  binary frames refused outright; the protocol is JSON text only.
- **Per-room limits.** Six seats, and a ceiling on concurrent sockets addressed to one room.
- **Room creation limits.** Creating a room instantiates an object, so it is capped per client
  IP at the Worker.
- **Room codes as credentials.** Eight characters from a 32-symbol alphabet with no
  look-alikes: 32^8 ≈ 1.1e12 combinations against a per-minute creation limit. There are no
  accounts, so the invite link is the only secret.
- **Browser hardening.** The Content-Security-Policy, HSTS, framing and referrer headers are
  served by Vercel with the client, since the game server returns no HTML.

## Behaviour that follows from the design

- **Rooms are ephemeral.** They live in the object's memory. If every player disconnects, the
  object may be evicted and the room is gone; a returning player sees "Room not found". An
  emptied room is otherwise held for the idle window so a player who drops can return.
- **A deployment ends in-flight rooms.** Replacing the Worker replaces the running code, so
  deploy between sessions rather than during one.
- **Liveness is the platform's concern.** Workers exposes no server-side `ping()`, so there is
  no application heartbeat; Cloudflare's edge reports dropped connections instead. A player
  whose network dies silently appears connected until their turn timer expires and acts for
  them — checking when legal, otherwise folding.
- **Capacity is not a practical concern at this scale.** The free plan allows 100,000 requests
  and 313,000 GB-s of duration per day. A resident object is 128 MB, so a room occupied around
  the clock costs roughly 11,000 GB-s — about 28 permanently busy tables.

## Local development mirrors the split

`npm run dev` runs the same two halves on one machine: a dependency-free static server for
`public/` and `wrangler dev` for the Worker and its Durable Objects. `public/config.js` is
committed pointing at the local Worker, and the Vercel build overwrites it, so no file needs
editing to switch between local and deployed play.

The test suites follow the same boundary. `test/engine.test.js` exercises the rules with no
transport at all, `test/worker.test.js` drives a real `wrangler dev` over real WebSockets, and
`scripts/ui-smoke.mjs` plays two- and six-player games through a real browser.
