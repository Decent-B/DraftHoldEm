# Draft Hold'em

Draft Hold'em for 2–6 players over the internet. Create a room, share the link, and anyone
you send it to can take a seat. The server owns the deck, secret bids and hidden cards; each
browser receives only the information that player is allowed to see.

Before starting, the host can set separate 10–120 second timers for Draft and Bet actions.
Expired Draft actions bid 0 or auto-pick; expired Bet actions check when legal, otherwise fold.

In the lobby, the host can kick guests. Disconnected lobby players have 10 seconds to
reconnect before they are removed automatically; active-game seats are retained safely.

Use the gear button in the top bar to set separate Music and Sound Effects volumes. Audio
preferences are saved in each browser.

During a game, use **Sit out next hand** to keep watching without being dealt in, then **Sit
in next hand** to return. Between hands, a player below the configured starting stack can
refill back to that amount; each player's refill count is shown at their seat. A new hand
needs at least two seated players with chips, otherwise the result panel explains why the
table is paused.

## Playing

1. Open the site and enter a name.
2. **Create room** — the room code and an invite link appear in the lobby.
3. Send the invite link to your friends; it puts them straight into your lobby.
4. Everyone marks **Ready**, then the host starts the game.

Closing the tab by accident is recoverable: reopening the invite link resumes the same seat
while the room is alive.

## Layout

```
src/worker.js    Worker entry: routes a WebSocket upgrade to the room's Durable Object
src/room.js      Durable Object: one room, its players, sockets and turn timer
src/engine.js    Game rules: drafting, betting, showdown, payouts
src/cards.js     Deck, shuffling and hand evaluation
src/security.js  Origin allowlist and per-socket limits
public/          The browser client, served as static files
scripts/         Local development, the UI smoke test, and the Vercel build step
```

## Development

```bash
npm install
npm run dev      # client on http://localhost:4173, game server on ws://localhost:8787
npm test         # engine, security, config generator, and Worker integration tests
npm run test:ui  # two- and six-player browser flows; screenshots land in artifacts/
npm run deploy   # publish the game server to Cloudflare
```

`npm run dev` starts both halves of the deployment. `npm run test:ui` needs a Chromium-based
browser; it uses a Playwright-managed one when installed, or set `BROWSER_PATH`.

## Deployment

The client deploys to Vercel from `main` and the game server to Cloudflare Workers with
Durable Objects, both on free plans.

- [docs/architecture.md](docs/architecture.md) — what is deployed, the room and connection
  lifecycle, the trust boundary, and why the WebSocket server cannot live on Vercel.
- [DEPLOYMENT.md](DEPLOYMENT.md) — the hostnames, environment variables, tunables and
  operating notes.
