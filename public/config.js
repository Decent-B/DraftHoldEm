// Which game server this client talks to.
//
// The committed value is the `wrangler dev` address that `npm run dev` starts. The Vercel
// build overwrites this file with the deployed Worker URL taken from the GAME_SERVER_URL
// environment variable, so it never needs editing by hand for a deployment.
window.DRAFT_HOLDEM_CONFIG = { gameServerUrl: "ws://localhost:8787" };
