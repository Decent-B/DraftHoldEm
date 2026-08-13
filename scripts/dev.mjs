// Runs both halves of the deployment locally: the client on 4173 (Vercel's job in
// production) and the Worker with its Durable Objects on 8787 (Cloudflare's job).
// public/config.js already points at ws://localhost:8787, so no extra wiring is needed.
import { spawnClient, spawnWorker } from "./local-servers.mjs";

const clientPort = Number(process.env.CLIENT_PORT ?? 4173);
const workerPort = Number(process.env.WORKER_PORT ?? 8787);

const children = [
  spawnClient({ port: clientPort }),
  spawnWorker({ port: workerPort, clientOrigin: `http://localhost:${clientPort}` }),
];

// Never leave half the stack running: any child exiting takes the whole session down.
let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  process.exitCode = code;
}

for (const child of children) child.on("exit", (code) => shutdown(code ?? 0));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`\nDRAFT HOLD'EM development\n  Client:  http://localhost:${clientPort}\n  Server:  ws://localhost:${workerPort}\n`);
