import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import WebSocket from "ws";
import { spawnWorker, waitForHttp } from "../scripts/local-servers.mjs";

const CLIENT_ORIGIN = "http://localhost:4173";

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

function openWebSocket(url, origin = CLIENT_ORIGIN) {
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

function nextClose(socket) {
  return new Promise((resolveClose) => socket.once("close", (code) => resolveClose(code)));
}

// Drives the real Worker and Durable Objects through `wrangler dev`, so routing, the
// origin allowlist, the WebSocket upgrade and room lifetime are all exercised together.
test("the deployed request path enforces its transport and room rules", async () => {
  const port = await availablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const socketUrl = `ws://127.0.0.1:${port}`;
  const worker = spawnWorker({ port, clientOrigin: CLIENT_ORIGIN, stdio: "pipe" });
  const openSockets = [];

  try {
    await waitForHttp(`${baseUrl}/health`, worker);

    assert.deepEqual(await (await fetch(`${baseUrl}/health`)).json(), { ok: true });
    assert.equal((await fetch(`${baseUrl}/health`, { method: "POST" })).status, 405);
    // Room paths only serve WebSocket upgrades.
    assert.equal((await fetch(`${baseUrl}/room/ABCDEFGH`)).status, 426);

    await assert.rejects(openWebSocket(`${socketUrl}/room/new`, "https://evil.example"), /403/);
    await assert.rejects(openWebSocket(`${socketUrl}/nothing-here`), /404/);

    const host = await openWebSocket(`${socketUrl}/room/new`);
    openSockets.push(host);
    const hostSessionMessage = nextMessage(host, "session");
    host.send(JSON.stringify({ type: "create_room", name: "Host" }));
    const hostSession = await hostSessionMessage;
    assert.match(hostSession.roomCode, /^[A-HJ-NP-Z2-9]{8}$/);

    // A second player reaches the same Durable Object through the room code.
    const guest = await openWebSocket(`${socketUrl}/room/${hostSession.roomCode}`);
    openSockets.push(guest);
    const guestStateMessage = nextMessage(guest, "state");
    guest.send(JSON.stringify({ type: "join_room", name: "Guest" }));
    const guestState = await guestStateMessage;
    assert.equal(guestState.state.mode, "LOBBY");
    assert.deepEqual(guestState.state.players.map((player) => player.name), ["Host", "Guest"]);

    // An unused code addresses an uninitialised object, which is what an expired invite
    // link looks like.
    const stranger = await openWebSocket(`${socketUrl}/room/ZZZZZZZZ`);
    openSockets.push(stranger);
    const strangerError = nextMessage(stranger, "error");
    stranger.send(JSON.stringify({ type: "join_room", name: "Stranger" }));
    assert.equal((await strangerError).message, "Room not found");

    // Codes stay server-minted: a chosen code cannot be claimed by connecting directly.
    const squatterError = nextMessage(stranger, "error");
    stranger.send(JSON.stringify({ type: "create_room", name: "Squatter" }));
    assert.equal((await squatterError).message, "This connection cannot create a room");

    const resumed = await openWebSocket(`${socketUrl}/room/${hostSession.roomCode}`);
    openSockets.push(resumed);
    const resumedSessionMessage = nextMessage(resumed, "session");
    resumed.send(JSON.stringify({ type: "resume", token: hostSession.token }));
    const resumedSession = await resumedSessionMessage;
    assert.equal(resumedSession.playerId, hostSession.playerId);
    assert.notEqual(resumedSession.token, hostSession.token);

    // Reconnect tokens rotate on use, so the spent one is no longer accepted.
    const replay = await openWebSocket(`${socketUrl}/room/${hostSession.roomCode}`);
    openSockets.push(replay);
    const replayError = nextMessage(replay, "error");
    replay.send(JSON.stringify({ type: "resume", token: hostSession.token }));
    assert.equal((await replayError).message, "Could not restore this session");

    const binarySocket = await openWebSocket(`${socketUrl}/room/${hostSession.roomCode}`);
    const binaryClose = nextClose(binarySocket);
    binarySocket.send(Buffer.from("not JSON"));
    assert.equal(await binaryClose, 1003);

    const oversizedSocket = await openWebSocket(`${socketUrl}/room/${hostSession.roomCode}`);
    const oversizedClose = nextClose(oversizedSocket);
    oversizedSocket.send("x".repeat(20 * 1024));
    assert.equal(await oversizedClose, 1009);
  } finally {
    for (const socket of openSockets) socket.close();
    worker.kill();
  }
});
