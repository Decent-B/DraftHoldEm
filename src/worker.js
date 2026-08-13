import { isWebSocketOriginAllowed, loadSecurityConfig } from "./security.js";

// The Durable Object class has to be re-exported from the Worker entry point for the
// runtime to bind it.
export { Room } from "./room.js";

// A room code is the only credential needed to join, so it uses a 32-symbol alphabet
// with no look-alikes (no I, O, 0 or 1) and eight characters: 32^8 ≈ 1.1e12 codes.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{8}$/;
const ROOM_CODE_ATTEMPTS = 3;

function generateRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  // 256 is a multiple of the alphabet length, so the modulo introduces no bias.
  return Array.from(bytes, (byte) => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join("");
}

// Rewrites the upgrade request to the canonical room path. `create=1` marks the single
// connection allowed to initialise the room, which keeps codes server-minted: a player
// cannot claim a code of their choosing by connecting straight to /room/<code>.
function roomRequest(request, code, create) {
  const url = new URL(request.url);
  url.pathname = `/room/${code}`;
  url.search = create ? "create=1" : "";
  return new Request(url, request);
}

// Mints a code and hands the connection to its Durable Object. A code that already
// belongs to a live room is rejected with 409, so retry with a fresh one.
async function openNewRoom(request, env) {
  for (let attempt = 0; attempt < ROOM_CODE_ATTEMPTS; attempt += 1) {
    const code = generateRoomCode();
    const response = await env.ROOM.getByName(code).fetch(roomRequest(request, code, true));
    if (response.status !== 409) return response;
  }
  return new Response("Could not allocate a room code", { status: 503 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
    }
    if (url.pathname === "/health") {
      return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }

    const { allowedOrigins } = loadSecurityConfig(env);
    if (!isWebSocketOriginAllowed(request.headers.get("Origin"), allowedOrigins)) {
      return new Response("Origin not allowed", { status: 403 });
    }

    if (url.pathname === "/room/new") {
      // Creating a room spins up a Durable Object, so it is the one path worth
      // rate limiting. CF-Connecting-IP is set by Cloudflare and cannot be spoofed.
      const { success } = await env.ROOM_LIMITER.limit({
        key: request.headers.get("CF-Connecting-IP") ?? "unknown",
      });
      if (!success) return new Response("Too many rooms created; wait a minute", { status: 429 });
      return openNewRoom(request, env);
    }

    // Invite links get retyped by hand, so accept any casing.
    const code = url.pathname.startsWith("/room/")
      ? url.pathname.slice("/room/".length).toUpperCase()
      : "";
    if (!ROOM_CODE_PATTERN.test(code)) return new Response("Not found", { status: 404 });
    return env.ROOM.getByName(code).fetch(roomRequest(request, code, false));
  },
};
