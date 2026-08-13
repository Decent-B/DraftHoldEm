// One definition of how this project runs on a developer machine, shared by
// `npm run dev`, the UI smoke test and the Worker integration tests. Locally the two
// halves of the deployment are a static file server for public/ and `wrangler dev` for
// the Worker plus its Durable Objects.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const clientServerScript = fileURLToPath(new URL("./serve-client.mjs", import.meta.url));
const wranglerBin = fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url));

export function spawnClient({ port, stdio = "inherit" }) {
  return spawn(process.execPath, [clientServerScript], {
    cwd: repositoryRoot,
    env: { ...process.env, CLIENT_PORT: String(port) },
    stdio,
  });
}

// wrangler.jsonc pins ALLOWED_ORIGINS to the deployed client, so a local run overrides
// it with whatever origin the local client server is serving from.
export function spawnWorker({ port, clientOrigin, stdio = "inherit" }) {
  return spawn(process.execPath, [
    wranglerBin,
    "dev",
    "--port",
    String(port),
    "--var",
    `ALLOWED_ORIGINS:${clientOrigin}`,
    "--show-interactive-dev-session=false",
  ], { cwd: repositoryRoot, stdio });
}

export async function waitForHttp(url, child, timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Process for ${url} exited with code ${child.exitCode}`);
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((sleep) => setTimeout(sleep, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}
