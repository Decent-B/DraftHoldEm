import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const rootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function availablePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForServer(url, child) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Server exited with code ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error("Timed out waiting for the test server");
}

function openWebSocket(url, origin) {
  return new Promise((resolveOpen, reject) => {
    const socket = new WebSocket(url, { origin });
    socket.once("open", () => resolveOpen(socket));
    socket.once("error", reject);
  });
}

function nextMessage(socket, type) {
  return new Promise((resolveMessage, reject) => {
    const onMessage = (rawMessage) => {
      try {
        const message = JSON.parse(rawMessage.toString());
        if (message.type !== type) return;
        socket.off("message", onMessage);
        resolveMessage(message);
      } catch (error) {
        reject(error);
      }
    };
    socket.on("message", onMessage);
  });
}

test("production startup requires an explicit public origin", () => {
  const child = spawnSync(process.execPath, ["src/server.js"], {
    cwd: rootDirectory,
    env: { ...process.env, NODE_ENV: "production", ALLOWED_ORIGINS: "" },
    encoding: "utf8",
  });
  assert.notEqual(child.status, 0);
  assert.match(child.stderr, /ALLOWED_ORIGINS is required/);
});

test("live server enforces its HTTP and WebSocket boundary", async () => {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const errors = [];
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: rootDirectory,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), NODE_ENV: "development" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", (chunk) => errors.push(chunk.toString()));

  try {
    await waitForServer(baseUrl, child);

    const indexResponse = await fetch(baseUrl);
    assert.equal(indexResponse.status, 200);
    assert.match(indexResponse.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal(indexResponse.headers.get("x-content-type-options"), "nosniff");

    const health = await (await fetch(`${baseUrl}/health`)).json();
    assert.deepEqual(health, { ok: true });
    assert.equal((await fetch(baseUrl, { method: "POST" })).status, 405);
    assert.equal((await fetch(`${baseUrl}/%E0%A4%A`)).status, 400);

    await assert.rejects(openWebSocket(`ws://127.0.0.1:${port}`, "https://evil.example"), /403/);

    const binarySocket = await openWebSocket(`ws://127.0.0.1:${port}`, baseUrl);
    const binaryClose = new Promise((resolveClose) => binarySocket.once("close", (code) => resolveClose(code)));
    binarySocket.send(Buffer.from("not JSON"));
    assert.equal(await binaryClose, 1003);

    const oversizedSocket = await openWebSocket(`ws://127.0.0.1:${port}`, baseUrl);
    const oversizedClose = new Promise((resolveClose) => oversizedSocket.once("close", (code) => resolveClose(code)));
    oversizedSocket.send("x".repeat(20 * 1024));
    assert.equal(await oversizedClose, 1009);

    const firstSessionSocket = await openWebSocket(`ws://127.0.0.1:${port}`, baseUrl);
    const firstSessionMessage = nextMessage(firstSessionSocket, "session");
    firstSessionSocket.send(JSON.stringify({ type: "create_room", name: "Security test" }));
    const firstSession = await firstSessionMessage;
    firstSessionSocket.close();

    const resumedSocket = await openWebSocket(`ws://127.0.0.1:${port}`, baseUrl);
    const resumedSessionMessage = nextMessage(resumedSocket, "session");
    resumedSocket.send(JSON.stringify({
      type: "resume",
      roomCode: firstSession.roomCode,
      token: firstSession.token,
    }));
    const resumedSession = await resumedSessionMessage;
    assert.notEqual(resumedSession.token, firstSession.token);
    resumedSocket.close();

    const replaySocket = await openWebSocket(`ws://127.0.0.1:${port}`, baseUrl);
    const replayErrorMessage = nextMessage(replaySocket, "error");
    replaySocket.send(JSON.stringify({
      type: "resume",
      roomCode: firstSession.roomCode,
      token: firstSession.token,
    }));
    assert.equal((await replayErrorMessage).message, "Could not restore this session");
    replaySocket.close();

    assert.equal((await fetch(`${baseUrl}/health`)).status, 200);
    assert.deepEqual(errors, []);
  } finally {
    child.kill();
  }
});
