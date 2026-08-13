# Deployment

What an operator configures. For the deployed architecture and the reasoning behind it, see
[docs/architecture.md](docs/architecture.md).

| Part | Host | Deployed by |
| --- | --- | --- |
| Client (`public/`) | Vercel, production branch `main` | Pushing to `main` |
| Game server (`src/`) | Cloudflare Workers + Durable Objects | `npm run deploy` |

## Game server

```bash
npx wrangler login
npm run deploy
```

[wrangler.jsonc](wrangler.jsonc) holds the entire configuration: the `Room` Durable Object, the
room-creation rate limit, `ALLOWED_ORIGINS`, and the `ws.draft-hold-em.binhnguyen.dev` custom
domain.

`ALLOWED_ORIGINS` is a comma-separated list of exact browser origins, with no path and no
trailing slash. Sockets from any other origin are refused with 403. Vercel preview
deployments have their own hostnames, so add them here if previews need to connect.

The custom domain requires the `binhnguyen.dev` zone to be on Cloudflare DNS. Without it,
remove the `routes` block and use the `workers.dev` URL that `wrangler deploy` prints, then
update `GAME_SERVER_URL` and `connect-src` to match.

`GET /health` returns `{"ok":true}`; every other path serves only WebSocket upgrades.

## Client

Import the repository on Vercel with `main` as the production branch and set one environment
variable, for **Production and Preview** both:

```text
GAME_SERVER_URL=wss://ws.draft-hold-em.binhnguyen.dev
```

The build (`scripts/build-client-config.mjs`) writes `public/config.js` from it and fails when
the variable is missing, when it is not `wss://` or `https://`, or when it does not match
`connect-src` in [vercel.json](vercel.json). Leave the dashboard's build command and output
directory empty so `vercel.json` applies.

`vercel.json` also carries the browser security headers and cache policy: `no-store` on the app
assets, long-lived immutable caching for `/audio/`.

Moving the game server means changing `GAME_SERVER_URL` **and** `connect-src` together. The
build check exists to catch forgetting the second.

## Tunables

Defaults, overridable as `vars` in `wrangler.jsonc`:

```text
MAX_PAYLOAD_BYTES         16384     per WebSocket message
MAX_MESSAGES_PER_WINDOW   40        per socket
MESSAGE_WINDOW_MS         5000
MAX_CONNECTIONS_PER_ROOM  24        sockets addressed to one room
ROOM_IDLE_MS              3600000   how long an emptied room waits for a player to return
SESSION_TTL_MS            86400000  reconnect token lifetime
```

Room creation is capped at 30 per minute per client IP by the `ROOM_LIMITER` binding.

## Operating notes

- **Deploy between game nights, not during one.** Redeploying the Worker ends in-flight rooms;
  players get "Room not found" and start a new table.
- Rooms are in-memory and ephemeral, and there are no accounts — anyone holding a room code can
  join until the lobby is full or the game starts.
- `npx wrangler tail` streams live server logs.
- `npx wrangler rollback` restores a previous Worker version; Vercel promotes earlier client
  deployments from its dashboard.
- Free-plan headroom is 100,000 requests and 313,000 GB-s per day, which is far more than
  playing with friends consumes.

## Local development

```bash
npm install
npm run dev      # client on 4173, Worker and Durable Objects on 8787
npm test         # engine, security, config generator, Worker integration
npm run test:ui  # two- and six-player browser flows, screenshots in artifacts/
```

`npm run dev` runs both halves as they are deployed. `public/config.js` is committed pointing at
`ws://localhost:8787` and the Vercel build overwrites it, so nothing local needs editing. The
Worker's `ALLOWED_ORIGINS` is overridden to the local client origin for development runs.
