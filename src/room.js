import { randomBytes, randomUUID } from "node:crypto";
import { DurableObject } from "cloudflare:workers";
import { DEFAULT_CONFIG, DraftHoldemGame } from "./engine.js";
import { consumeMessageAllowance, loadSecurityConfig } from "./security.js";

const LOBBY_DISCONNECT_GRACE_MS = 10_000;
const MAX_PLAYERS = 6;
const textEncoder = new TextEncoder();

function sessionToken() {
  return randomBytes(24).toString("base64url");
}

// Control characters and bidirectional overrides are stripped so a display name
// cannot reorder or hide the text around it in the UI.
const UNSAFE_NAME_CHARACTERS =
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

function cleanName(value) {
  if (typeof value !== "string") return "";
  return value
    .replace(UNSAFE_NAME_CHARACTERS, "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 20);
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

function safeSend(socket, payload) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

/**
 * One Durable Object instance owns exactly one room: its players, their sockets, the
 * game engine and the turn timer.
 *
 * Two platform properties make this a drop-in home for the server-authoritative model
 * the game was written for: a Durable Object handles one event at a time, so poker
 * actions cannot interleave, and an object using the standard WebSocket API stays in
 * memory for as long as a socket is open, so room state and `setTimeout` turn timers
 * need no external store. Rooms are deliberately ephemeral — if every player
 * disconnects the object may be evicted and the room is gone, which is the same
 * behaviour the single-process server had across a restart.
 */
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.security = loadSecurityConfig(env);
    // Null until `create_room` initialises it; a socket that arrives first sees the
    // same "Room not found" error an expired invite link produces.
    this.room = null;
    this.contexts = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);
    const roomCode = url.pathname.slice(url.pathname.lastIndexOf("/") + 1);
    // The Worker mints room codes and marks the one connection allowed to create.
    const canCreate = url.searchParams.get("create") === "1";
    if (canCreate && this.room) return new Response("Room code already in use", { status: 409 });
    if (this.contexts.size >= this.security.maxConnectionsPerRoom) {
      return new Response("Too many connections for this room", { status: 429 });
    }

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.contexts.set(server, {
      roomCode,
      canCreate,
      playerId: null,
      rateLimit: { startedAt: Date.now(), count: 0 },
    });
    server.addEventListener("message", (event) => this.receive(server, event));
    server.addEventListener("close", () => this.disconnect(server));
    server.addEventListener("error", () => this.disconnect(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  receive(socket, event) {
    const context = this.contexts.get(socket);
    if (!context) return;
    if (typeof event.data !== "string") {
      socket.close(1003, "Text messages only");
      return;
    }
    if (textEncoder.encode(event.data).byteLength > this.security.maxPayloadBytes) {
      socket.close(1009, "Message too large");
      return;
    }
    if (!consumeMessageAllowance(
      context.rateLimit,
      Date.now(),
      this.security.maxMessagesPerWindow,
      this.security.messageWindowMs,
    )) {
      socket.close(1008, "Message rate limit exceeded");
      return;
    }
    try {
      this.handleMessage(socket, context, JSON.parse(event.data));
    } catch (error) {
      safeSend(socket, { type: "error", message: error.message || "Something went wrong" });
    }
  }

  disconnect(socket) {
    const context = this.contexts.get(socket);
    if (!context) return;
    this.contexts.delete(socket);
    const player = this.room?.players.find((candidate) => candidate.id === context.playerId);
    if (!player || player.socket !== socket) return;
    player.connected = false;
    this.broadcast();
    if (!this.room.game) {
      if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
      player.disconnectTimer = setTimeout(() => {
        if (!player.connected && !this.room?.game) this.removeLobbyPlayer(player.id, "OFFLINE");
      }, LOBBY_DISCONNECT_GRACE_MS);
    }
    this.scheduleRoomCleanup();
  }

  newPlayer(name) {
    return {
      id: randomUUID(),
      token: sessionToken(),
      tokenExpiresAt: Date.now() + this.security.sessionTtlMs,
      name,
      ready: false,
      connected: true,
      socket: null,
      disconnectTimer: null,
    };
  }

  createRoom(code, name, requestedConfig) {
    const host = this.newPlayer(name);
    this.room = {
      code,
      hostId: host.id,
      config: validateConfig(requestedConfig ?? {}),
      players: [host],
      game: null,
      timerHandle: null,
      timerKey: null,
      cleanupTimer: null,
    };
    return host;
  }

  destroyRoom() {
    if (!this.room) return;
    if (this.room.timerHandle) clearTimeout(this.room.timerHandle);
    if (this.room.cleanupTimer) clearTimeout(this.room.cleanupTimer);
    for (const player of this.room.players) {
      if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    }
    this.room = null;
  }

  // Keeps an emptied room alive for the idle window so a player who drops off can
  // still resume, then lets the room — and with it this object — go away.
  scheduleRoomCleanup() {
    if (!this.room || this.room.players.some((player) => player.connected) || this.room.cleanupTimer) return;
    this.room.cleanupTimer = setTimeout(() => {
      if (!this.room) return;
      this.room.cleanupTimer = null;
      if (!this.room.players.some((player) => player.connected)) this.destroyRoom();
    }, this.security.roomIdleMs);
  }

  lobbyState(viewerId) {
    return {
      mode: "LOBBY",
      roomCode: this.room.code,
      hostId: this.room.hostId,
      viewerId,
      config: this.room.config,
      players: this.room.players.map(({ id, name, ready, connected }, seatIndex) => ({
        id, name, ready, connected, seatIndex,
      })),
    };
  }

  roomState(viewerId) {
    if (!this.room.game) return this.lobbyState(viewerId);
    return {
      mode: "GAME",
      roomCode: this.room.code,
      hostId: this.room.hostId,
      viewerId,
      connections: Object.fromEntries(this.room.players.map((player) => [player.id, player.connected])),
      game: this.room.game.stateFor(viewerId),
    };
  }

  removeLobbyPlayer(playerId, reason) {
    if (!this.room || this.room.game) return false;
    const playerIndex = this.room.players.findIndex((player) => player.id === playerId);
    if (playerIndex < 0) return false;
    const [removedPlayer] = this.room.players.splice(playerIndex, 1);
    if (removedPlayer.disconnectTimer) clearTimeout(removedPlayer.disconnectTimer);
    removedPlayer.disconnectTimer = null;
    if (reason === "KICKED") {
      safeSend(removedPlayer.socket, {
        type: "kicked",
        roomCode: this.room.code,
        message: "The host removed you from the room",
      });
      if (removedPlayer.socket) {
        // Drop the context first so the close event does not process this seat again.
        this.contexts.delete(removedPlayer.socket);
        removedPlayer.socket.close(4002, "Removed by host");
      }
    }
    if (this.room.players.length === 0) {
      this.destroyRoom();
      return true;
    }
    if (this.room.hostId === removedPlayer.id) this.room.hostId = this.room.players[0].id;
    this.broadcast();
    return true;
  }

  syncRoomTimer() {
    if (!this.room.players.some((player) => player.connected)) {
      if (this.room.timerHandle) clearTimeout(this.room.timerHandle);
      this.room.timerHandle = null;
      this.room.timerKey = null;
      if (this.room.game) this.room.game.turnDeadline = null;
      return;
    }
    const key = this.room.game?.timerKey() ?? null;
    if (this.room.timerKey === key) return;
    if (this.room.timerHandle) clearTimeout(this.room.timerHandle);
    this.room.timerHandle = null;
    this.room.timerKey = key;
    if (!key) {
      if (this.room.game) this.room.game.turnDeadline = null;
      return;
    }

    const durationMs = this.room.game.timerDurationSeconds() * 1000;
    this.room.game.turnDeadline = Date.now() + durationMs;
    this.room.timerHandle = setTimeout(() => {
      if (!this.room?.game || this.room.game.timerKey() !== key) return;
      this.room.timerHandle = null;
      this.room.timerKey = null;
      try {
        this.room.game.handleTimeout();
      } catch (error) {
        console.error("Timer action failed:", error);
      }
      this.broadcast();
    }, durationMs);
  }

  broadcast() {
    if (!this.room) return;
    this.syncRoomTimer();
    for (const player of this.room.players) {
      if (player.connected) safeSend(player.socket, { type: "state", state: this.roomState(player.id) });
    }
  }

  attach(socket, context, player) {
    if (player.socket && player.socket !== socket && player.socket.readyState === WebSocket.OPEN) {
      this.contexts.delete(player.socket);
      player.socket.close(4001, "Signed in from a new connection");
    }
    context.playerId = player.id;
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = null;
    player.socket = socket;
    player.connected = true;
    if (this.room.cleanupTimer) clearTimeout(this.room.cleanupTimer);
    this.room.cleanupTimer = null;
    safeSend(socket, { type: "session", roomCode: this.room.code, playerId: player.id, token: player.token });
    this.broadcast();
  }

  requireContext(context) {
    if (!context.playerId) throw new Error("You have not joined a room");
    const player = this.room?.players.find((candidate) => candidate.id === context.playerId);
    if (!this.room || !player) throw new Error("This session no longer exists");
    return player;
  }

  handleMessage(socket, context, payload) {
    if (!payload || typeof payload.type !== "string") throw new Error("Invalid message");

    if (payload.type === "create_room") {
      if (context.playerId) throw new Error("You are already in a room");
      if (this.room) throw new Error("This room already exists");
      if (!context.canCreate) throw new Error("This connection cannot create a room");
      const name = cleanName(payload.name);
      if (!name) throw new Error("Enter a player name");
      this.attach(socket, context, this.createRoom(context.roomCode, name, payload.config));
      return;
    }

    if (payload.type === "join_room") {
      if (context.playerId) throw new Error("You are already in a room");
      if (!this.room) throw new Error("Room not found");
      if (this.room.game) throw new Error("The game has started; only returning players can reconnect");
      if (this.room.players.length >= MAX_PLAYERS) throw new Error("This room is full");
      const name = cleanName(payload.name);
      if (!name) throw new Error("Enter a player name");
      if (this.room.players.some((player) => player.name.toLocaleLowerCase("en") === name.toLocaleLowerCase("en"))) {
        throw new Error("That name is already in this room");
      }
      const player = this.newPlayer(name);
      this.room.players.push(player);
      this.attach(socket, context, player);
      return;
    }

    if (payload.type === "resume") {
      if (context.playerId) return;
      const player = this.room?.players.find((candidate) => (
        candidate.token === payload.token && candidate.tokenExpiresAt > Date.now()
      ));
      if (!player) throw new Error("Could not restore this session");
      player.token = sessionToken();
      player.tokenExpiresAt = Date.now() + this.security.sessionTtlMs;
      this.attach(socket, context, player);
      return;
    }

    const room = this.room;
    const player = this.requireContext(context);

    if (payload.type === "set_ready") {
      if (room.game) throw new Error("The game has already started");
      player.ready = Boolean(payload.ready);
    } else if (payload.type === "kick_player") {
      if (room.game) throw new Error("Players cannot be removed during a game");
      if (room.hostId !== player.id) throw new Error("Only the host can remove players");
      if (payload.playerId === player.id) throw new Error("The host cannot remove themselves");
      const target = room.players.find((candidate) => candidate.id === payload.playerId);
      if (!target) throw new Error("Player not found");
      this.removeLobbyPlayer(target.id, "KICKED");
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
    this.broadcast();
  }
}
