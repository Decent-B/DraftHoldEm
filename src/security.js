const DEFAULT_MAX_CONNECTIONS = 500;
const DEFAULT_MAX_CONNECTIONS_PER_IP = 20;
const DEFAULT_MAX_MESSAGES_PER_WINDOW = 40;
const DEFAULT_MESSAGE_WINDOW_MS = 5_000;
const DEFAULT_MAX_ROOM_ATTEMPTS_PER_WINDOW = 30;
const DEFAULT_ROOM_ATTEMPT_WINDOW_MS = 60_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 16 * 1024;
const DEFAULT_MAX_ROOMS = 500;
const DEFAULT_ROOM_IDLE_MS = 60 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

function integerSetting(name, fallback, minimum, maximum) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") return fallback;
  const value = Number(rawValue);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function booleanSetting(name, fallback) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === "") return fallback;
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  throw new Error(`${name} must be true or false`);
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

export function loadSecurityConfig() {
  const production = process.env.NODE_ENV === "production";
  const allowedOrigins = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
  if (production && allowedOrigins.size === 0) {
    throw new Error("ALLOWED_ORIGINS is required when NODE_ENV=production");
  }
  return {
    production,
    host: process.env.HOST || (production ? "127.0.0.1" : "0.0.0.0"),
    allowedOrigins,
    trustProxy: booleanSetting("TRUST_PROXY", false),
    lanDiscovery: booleanSetting("ENABLE_LAN_DISCOVERY", !production),
    maxConnections: integerSetting("MAX_CONNECTIONS", DEFAULT_MAX_CONNECTIONS, 1, 10_000),
    maxConnectionsPerIp: integerSetting("MAX_CONNECTIONS_PER_IP", DEFAULT_MAX_CONNECTIONS_PER_IP, 1, 1_000),
    maxMessagesPerWindow: integerSetting("MAX_MESSAGES_PER_WINDOW", DEFAULT_MAX_MESSAGES_PER_WINDOW, 5, 1_000),
    messageWindowMs: integerSetting("MESSAGE_WINDOW_MS", DEFAULT_MESSAGE_WINDOW_MS, 1_000, 60_000),
    maxRoomAttemptsPerWindow: integerSetting("MAX_ROOM_ATTEMPTS_PER_WINDOW", DEFAULT_MAX_ROOM_ATTEMPTS_PER_WINDOW, 5, 1_000),
    roomAttemptWindowMs: integerSetting("ROOM_ATTEMPT_WINDOW_MS", DEFAULT_ROOM_ATTEMPT_WINDOW_MS, 10_000, 60 * 60 * 1000),
    maxPayloadBytes: integerSetting("MAX_PAYLOAD_BYTES", DEFAULT_MAX_PAYLOAD_BYTES, 1_024, 1024 * 1024),
    maxRooms: integerSetting("MAX_ROOMS", DEFAULT_MAX_ROOMS, 1, 100_000),
    roomIdleMs: integerSetting("ROOM_IDLE_MS", DEFAULT_ROOM_IDLE_MS, 60_000, 24 * 60 * 60 * 1000),
    sessionTtlMs: integerSetting("SESSION_TTL_MS", DEFAULT_SESSION_TTL_MS, 5 * 60 * 1000, 7 * 24 * 60 * 60 * 1000),
  };
}

export function isWebSocketOriginAllowed(request, config) {
  const origin = request.headers.origin;
  if (!origin) return !config.production;
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }
  if (!["http:", "https:"].includes(parsedOrigin.protocol)) return false;
  if (config.allowedOrigins.size > 0) return config.allowedOrigins.has(parsedOrigin.origin);
  return parsedOrigin.host === request.headers.host;
}

export function clientAddress(request, trustProxy = false) {
  if (trustProxy) {
    const forwarded = request.headers["x-forwarded-for"];
    const firstAddress = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
    if (firstAddress?.trim()) return firstAddress.trim();
  }
  return request.socket.remoteAddress || "unknown";
}

export function securityHeaders(production = false) {
  const headers = {
    "Content-Security-Policy": "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; media-src 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  };
  if (production) headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  return headers;
}

export function consumeMessageAllowance(state, now, maximum, windowMs) {
  if (now - state.startedAt >= windowMs) {
    state.startedAt = now;
    state.count = 0;
  }
  state.count += 1;
  return state.count <= maximum;
}
