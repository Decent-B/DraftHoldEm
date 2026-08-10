# Draft Hold'em LAN

Draft Hold'em for 2–4 players on the same Wi-Fi/LAN. The host owns the deck, secret bids and hidden cards; each browser receives only the information that player is allowed to see.

Before starting, the host can set separate 10–120 second timers for Draft and Bet actions. Expired Draft actions bid 0 or auto-pick; expired Bet actions check when legal, otherwise fold.

In the lobby, the host can kick guests. Disconnected lobby players have 10 seconds to reconnect before they are removed automatically; active-game seats are retained safely.

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

`npm run test:ui` uses Microsoft Edge or Google Chrome to run a two-player flow and save desktop/mobile screenshots in `artifacts/`.

To change the port in PowerShell:

```powershell
$env:PORT=8080; npm start
```
