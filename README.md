# Draft Hold'em LAN

Draft Hold'em for 2–6 players on the same Wi-Fi/LAN. The host owns the deck, secret bids and hidden cards; each browser receives only the information that player is allowed to see.

Before starting, the host can set separate 10–120 second timers for Draft and Bet actions. Expired Draft actions bid 0 or auto-pick; expired Bet actions check when legal, otherwise fold.

In the lobby, the host can kick guests. Disconnected lobby players have 10 seconds to reconnect before they are removed automatically; active-game seats are retained safely.

Use the gear button in the top bar to set separate Music and Sound Effects volumes. Audio preferences are saved in each browser.

During a game, use **Sit out next hand** to keep watching without being dealt in, then **Sit in next hand** to return. Between hands, a player below the configured starting stack can refill back to that amount; each player's refill count is shown at their seat. A new hand needs at least two seated players with chips, otherwise the result panel explains why the table is paused.

## Quick start on Windows

1. Install [Node.js 20+](https://nodejs.org/) if needed.
2. Double-click `start-game.bat`.
3. Open `http://localhost:4173` on the host computer.
4. Share the LAN address printed in the terminal, such as `http://192.168.1.10:4173`.

If Windows Firewall asks, allow Node.js on **Private networks**.

## Development commands

```bash
npm install
npm test
npm run test:ui
npm start
```

`npm run test:ui` uses Microsoft Edge or Google Chrome to verify two- and six-player flows, audio controls, and desktop/mobile layouts, then saves screenshots in `artifacts/`.

To change the port in PowerShell:

```powershell
$env:PORT=8080; npm start
```

## Public internet deployment

Do not expose the Node port directly. Expose HTTPS on TCP 443 through a reverse proxy or managed load balancer, use TCP 80 only for an HTTP-to-HTTPS redirect, and keep the application listener private. See [DEPLOYMENT.md](DEPLOYMENT.md) for the required environment variables, firewall boundary, Nginx example, and operational limitations.
