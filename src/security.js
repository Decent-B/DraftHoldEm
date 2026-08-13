// Limit and origin policy shared by the Worker entry point and the Room Durable
// Object. Values come from the Worker's `env` bindings, declared in wrangler.jsonc.

const DEFAULT_MAX_MESSAGES_PER_WINDOW = 40;
const DEFAULT_MESSAGE_WINDOW_MS = 5_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024;
const DEFAULT_MAX_CONNECTIONS_PER_ROOM = 24;
const DEFAULT_ROOM_IDLE_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function integerSetting(env, name, fallback, minimum, maximum) {
  const rawValue = env[name];
  if (rawValue === undefined || rawValue === "") return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

export function parseAllowedOrigins(rawValue = "") {
  const origins = new Set();
  for (const entry of rawValue.split(",").map((value) => value.trim()).filter(Boolean)) {
    let url;
    try {
      url = new URL(entry);
    } catch {
      throw new Error(`ALLOWED_ORIGINS contains an invalid URL: ${entry}`);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.origin !== entry.replace(/\/$/, "")) {
      throw new Error(`ALLOWED_ORIGINS entries must be origins such as https://game.example.com: ${entry}`);
    }
    origins.add(url.origin);
  }
  return origins;
}

export function loadSecurityConfig(env = {}) {
  return {
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
    maxMessagesPerWindow: integerSetting(env, "MAX_MESSAGES_PER_WINDOW", DEFAULT_MAX_MESSAGES_PER_WINDOW, 5, 1_000),
    messageWindowMs: integerSetting(env, "MESSAGE_WINDOW_MS", DEFAULT_MESSAGE_WINDOW_MS, 1_000, 60_000),
    maxPayloadBytes: integerSetting(env, "MAX_PAYLOAD_BYTES", DEFAULT_MAX_PAYLOAD_BYTES, 1_024, 1024 * 1024),
    maxConnectionsPerRoom: integerSetting(env, "MAX_CONNECTIONS_PER_ROOM", DEFAULT_MAX_CONNECTIONS_PER_ROOM, 6, 1_000),
    roomIdleMs: integerSetting(env, "ROOM_IDLE_MS", DEFAULT_ROOM_IDLE_MS, 60_000, 24 * 60 * 60 * 1000),
    sessionTtlMs: integerSetting(env, "SESSION_TTL_MS", DEFAULT_SESSION_TTL_MS, 5 * 60 * 1000, 7 * 24 * 60 * 60 * 1000),
  };
}

// Browsers always send Origin on a WebSocket handshake, so an allowlist is the
// defence against another site opening sockets on a visitor's behalf. An empty
// allowlist means ALLOWED_ORIGINS was not configured, which only happens in local
// development; every deployment sets it.
export function isWebSocketOriginAllowed(origin, allowedOrigins) {
  if (allowedOrigins.size === 0) return true;
  if (!origin) return false;
  try {
    return allowedOrigins.has(new URL(origin).origin);
  } catch {
    return false;
  }
}

export function consumeMessageAllowance(state, now, maximum, windowMs) {
  if (now - state.startedAt >= windowMs) {
    state.startedAt = now;
    state.count = 0;
  }
  state.count += 1;
  return state.count <= maximum;
}
