import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { networkInterfaces } from "node:os";
import { createSocket } from "node:dgram";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { DEFAULT_CONFIG, DraftHoldemGame } from "./engine.js";

const rootDirectory = resolve(fileURLToPath(new URL("..", import.meta.url)));
const publicDirectory = join(rootDirectory, "public");
const rulebookPath = join(publicDirectory, "rules-guide.html");
const port = Number(process.env.PORT) || 4173;
const lobbyDisconnectGraceMs = 10_000;
const rooms = new Map();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
};

function preferredNetworkAddress() {
  return new Promise((resolveAddress) => {
    const socket = createSocket("udp4");
    const finish = (address = null) => {
      socket.close();
      resolveAddress(address);
    };
    socket.once("error", () => finish());
    socket.connect(53, "8.8.8.8", () => finish(socket.address().address));
  });
}

function networkAddresses(preferredAddress = null) {
  const addresses = [];
  for (const [interfaceName, interfaces] of Object.entries(networkInterfaces())) {
    for (const address of interfaces ?? []) {
      if (address.family === "IPv4" && !address.internal && !address.address.startsWith("169.254.")) {
        const virtual = /virtual|vmware|vethernet|wsl|hyper-v|virtualbox|docker|zerotier|tailscale/i.test(interfaceName);
        const priority = address.address === preferredAddress ? 0 : virtual ? 2 : 1;
        addresses.push({ url: `http://${address.address}:${port}`, priority });
      }
    }
  }
  const ordered = addresses.sort((left, right) => left.priority - right.priority).map(({ url }) => url);
  return [...new Set([...ordered, `http://localhost:${port}`])];
}

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function serveHttp(request, response) {
  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/health") {
    sendJson(response, 200, { ok: true, rooms: rooms.size });
    return;
  }
  if (url.pathname === "/network") {
    sendJson(response, 200, { addresses: networkAddresses(await preferredNetworkAddress()) });
    return;
  }
  if (url.pathname === "/rules") {
    const html = await readFile(rulebookPath, "utf8");
    sendJson(response, 200, { html });
    return;
  }

  let requestedPath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
  requestedPath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(publicDirectory, requestedPath);
  if (!filePath.startsWith(publicDirectory)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("Not a file");
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": mimeTypes[extname(filePath)] ?? "application/octet-stream",
      "Content-Length": body.length,
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do {
    code = Array.from(randomBytes(5), (byte) => alphabet[byte % alphabet.length]).join("");
  } while (rooms.has(code));
  return code;
}

function sessionToken() {
  return randomBytes(24).toString("base64url");
}

function cleanName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 20);
}

function validateConfig(input, current = DEFAULT_CONFIG) {
  const next = { ...current };
  const ranges = {
    startingStack: [100, 10000],
    smallBlind: [1, 500],
    bigBlind: [2, 1000],
    draftTokens: [4, 50],
    draftTimeSeconds: [10, 120],
    betTimeSeconds: [10, 120],
  };
  for (const [key, [minimum, maximum]] of Object.entries(ranges)) {
    if (input[key] === undefined) continue;
    const value = Number(input[key]);
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`Invalid ${key} setting`);
    }
    next[key] = value;
  }
  if (next.smallBlind >= next.bigBlind) throw new Error("Small Blind must be lower than Big Blind");
  if (next.bigBlind >= next.startingStack) throw new Error("Big Blind must be lower than the starting stack");
  return next;
}

function createRoom(name, requestedConfig) {
  const playerId = randomUUID();
  const code = roomCode();
  const room = {
    code,
    hostId: playerId,
    config: validateConfig(requestedConfig ?? {}),
    players: [],
    game: null,
    timerHandle: null,
    timerKey: null,
  };
  const player = {
    id: playerId,
    token: sessionToken(),
    name,
    ready: false,
    connected: true,
    socket: null,
    disconnectTimer: null,
  };
  room.players.push(player);
  rooms.set(code, room);
  return { room, player };
}

function lobbyState(room, viewerId) {
  return {
    mode: "LOBBY",
    roomCode: room.code,
    hostId: room.hostId,
    viewerId,
    config: room.config,
    players: room.players.map(({ id, name, ready, connected }, seatIndex) => ({
      id, name, ready, connected, seatIndex,
    })),
  };
}

function roomState(room, viewerId) {
  if (!room.game) return lobbyState(room, viewerId);
  return {
    mode: "GAME",
    roomCode: room.code,
    hostId: room.hostId,
    viewerId,
    connections: Object.fromEntries(room.players.map((player) => [player.id, player.connected])),
    game: room.game.stateFor(viewerId),
  };
}

function safeSend(socket, payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function removeLobbyPlayer(room, playerId, reason) {
  if (room.game) return false;
  const playerIndex = room.players.findIndex((player) => player.id === playerId);
  if (playerIndex < 0) return false;
  const [removedPlayer] = room.players.splice(playerIndex, 1);
  if (removedPlayer.disconnectTimer) clearTimeout(removedPlayer.disconnectTimer);
  removedPlayer.disconnectTimer = null;
  if (reason === "KICKED") {
    safeSend(removedPlayer.socket, {
      type: "kicked",
      roomCode: room.code,
      message: "The host removed you from the room",
    });
    if (removedPlayer.socket) {
      removedPlayer.socket.context = null;
      removedPlayer.socket.close(4002, "Removed by host");
    }
  }
  if (room.players.length === 0) {
    rooms.delete(room.code);
    return true;
  }
  if (room.hostId === removedPlayer.id) room.hostId = room.players[0].id;
  broadcast(room);
  return true;
}

function syncRoomTimer(room) {
  const key = room.game?.timerKey() ?? null;
  if (room.timerKey === key) return;
  if (room.timerHandle) clearTimeout(room.timerHandle);
  room.timerHandle = null;
  room.timerKey = key;
  if (!key) {
    if (room.game) room.game.turnDeadline = null;
    return;
  }

  const durationMs = room.game.timerDurationSeconds() * 1000;
  room.game.turnDeadline = Date.now() + durationMs;
  room.timerHandle = setTimeout(() => {
    if (!room.game || room.game.timerKey() !== key) return;
    room.timerHandle = null;
    room.timerKey = null;
    try {
      room.game.handleTimeout();
    } catch (error) {
      console.error("Timer action failed:", error);
    }
    broadcast(room);
  }, durationMs);
}

function broadcast(room) {
  syncRoomTimer(room);
  for (const player of room.players) {
    if (player.connected) safeSend(player.socket, { type: "state", state: roomState(room, player.id) });
  }
}

function attach(socket, room, player) {
  if (player.socket && player.socket !== socket && player.socket.readyState === WebSocket.OPEN) {
    player.socket.close(4001, "Signed in from a new connection");
  }
  socket.context = { roomCode: room.code, playerId: player.id };
  if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
  player.disconnectTimer = null;
  player.socket = socket;
  player.connected = true;
  safeSend(socket, { type: "session", roomCode: room.code, playerId: player.id, token: player.token });
  broadcast(room);
}

function requireContext(socket) {
  if (!socket.context) throw new Error("You have not joined a room");
  const room = rooms.get(socket.context.roomCode);
  const player = room?.players.find((candidate) => candidate.id === socket.context.playerId);
  if (!room || !player) throw new Error("This session no longer exists");
  return { room, player };
}

function handleMessage(socket, payload) {
  if (!payload || typeof payload.type !== "string") throw new Error("Invalid message");

  if (payload.type === "create_room") {
    if (socket.context) throw new Error("You are already in a room");
    const name = cleanName(payload.name);
    if (!name) throw new Error("Enter a player name");
    const { room, player } = createRoom(name, payload.config);
    attach(socket, room, player);
    return;
  }

  if (payload.type === "join_room") {
    if (socket.context) throw new Error("You are already in a room");
    const code = String(payload.roomCode ?? "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) throw new Error("Room not found");
    if (room.game) throw new Error("The game has started; only returning players can reconnect");
    if (room.players.length >= 6) throw new Error("This room is full");
    const name = cleanName(payload.name);
    if (!name) throw new Error("Enter a player name");
    if (room.players.some((player) => player.name.toLocaleLowerCase("en") === name.toLocaleLowerCase("en"))) {
      throw new Error("That name is already in this room");
    }
    const player = {
      id: randomUUID(), token: sessionToken(), name, ready: false, connected: true, socket: null, disconnectTimer: null,
    };
    room.players.push(player);
    attach(socket, room, player);
    return;
  }

  if (payload.type === "resume") {
    if (socket.context) return;
    const code = String(payload.roomCode ?? "").trim().toUpperCase();
    const room = rooms.get(code);
    const player = room?.players.find((candidate) => candidate.token === payload.token);
    if (!room || !player) throw new Error("Could not restore this session");
    attach(socket, room, player);
    return;
  }

  const { room, player } = requireContext(socket);

  if (payload.type === "set_ready") {
    if (room.game) throw new Error("The game has already started");
    player.ready = Boolean(payload.ready);
  } else if (payload.type === "kick_player") {
    if (room.game) throw new Error("Players cannot be removed during a game");
    if (room.hostId !== player.id) throw new Error("Only the host can remove players");
    if (payload.playerId === player.id) throw new Error("The host cannot remove themselves");
    const target = room.players.find((candidate) => candidate.id === payload.playerId);
    if (!target) throw new Error("Player not found");
    removeLobbyPlayer(room, target.id, "KICKED");
    return;
  } else if (payload.type === "update_config") {
    if (room.game) throw new Error("Settings cannot change during a game");
    if (room.hostId !== player.id) throw new Error("Only the host can change settings");
    room.config = validateConfig(payload.config ?? {}, room.config);
    room.players.forEach((candidate) => { candidate.ready = false; });
  } else if (payload.type === "start_game") {
    if (room.game) throw new Error("The game has already started");
    if (room.hostId !== player.id) throw new Error("Only the host can start the game");
    if (room.players.length < 2) throw new Error("At least 2 players are required");
    if (room.players.some((candidate) => !candidate.connected || !candidate.ready)) {
      throw new Error("Every player must be connected and ready");
    }
    room.game = new DraftHoldemGame(room.players, room.config);
  } else if (payload.type === "draft_bid") {
    room.game?.submitDraftBid(player.id, payload.bid);
  } else if (payload.type === "draft_pick") {
    room.game?.draftCard(player.id, payload.cardId);
  } else if (payload.type === "poker_action") {
    room.game?.pokerAction(player.id, payload.action, payload.to);
  } else if (payload.type === "set_sitting_out") {
    if (!room.game) throw new Error("No game is running");
    room.game.setSittingOut(player.id, payload.sittingOut);
  } else if (payload.type === "refill_chips") {
    if (!room.game) throw new Error("No game is running");
    room.game.refillChips(player.id);
  } else if (payload.type === "next_hand") {
    if (!room.game) throw new Error("No game is running");
    if (room.hostId !== player.id) throw new Error("Only the host can start the next hand");
    if (room.game.phase !== "HAND_COMPLETE") throw new Error("The current hand is not complete");
    room.game.startHand();
  } else {
    throw new Error("Unsupported action");
  }
  broadcast(room);
}

const server = createServer((request, response) => {
  serveHttp(request, response).catch((error) => {
    console.error(error);
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" }).end("Server error");
  });
});

const webSocketServer = new WebSocketServer({ server });
webSocketServer.on("connection", (socket) => {
  socket.on("message", (rawMessage) => {
    try {
      const payload = JSON.parse(rawMessage.toString());
      handleMessage(socket, payload);
    } catch (error) {
      safeSend(socket, { type: "error", message: error.message || "Something went wrong" });
    }
  });
  socket.on("close", () => {
    if (!socket.context) return;
    const room = rooms.get(socket.context.roomCode);
    const player = room?.players.find((candidate) => candidate.id === socket.context.playerId);
    if (player && player.socket === socket) {
      player.connected = false;
      broadcast(room);
      if (!room.game) {
        if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
        player.disconnectTimer = setTimeout(() => {
          if (!player.connected && !room.game) removeLobbyPlayer(room, player.id, "OFFLINE");
        }, lobbyDisconnectGraceMs);
      }
    }
  });
});

server.listen(port, "0.0.0.0", async () => {
  console.log("\nDRAFT HOLD'EM is running:");
  networkAddresses(await preferredNetworkAddress()).forEach((address) => console.log(`  ${address}`));
  console.log("\nShare a LAN address with players on the same network. Press Ctrl+C to stop.\n");
});
