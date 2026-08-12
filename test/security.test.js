import test from "node:test";
import assert from "node:assert/strict";
import {
  clientAddress,
  consumeMessageAllowance,
  isWebSocketOriginAllowed,
  parseAllowedOrigins,
  securityHeaders,
} from "../src/security.js";

function request(headers = {}, remoteAddress = "127.0.0.1") {
  return { headers, socket: { remoteAddress } };
}

test("allowed origins must be exact HTTP(S) origins", () => {
  assert.deepEqual([...parseAllowedOrigins("https://game.example.com,http://localhost:4173")], [
    "https://game.example.com",
    "http://localhost:4173",
  ]);
  assert.throws(() => parseAllowedOrigins("https://game.example.com/path"), /must be origins/);
  assert.throws(() => parseAllowedOrigins("javascript:alert(1)"), /must be origins/);
});

test("production WebSockets require an allowlisted browser origin", () => {
  const config = {
    production: true,
    allowedOrigins: new Set(["https://game.example.com"]),
  };
  assert.equal(isWebSocketOriginAllowed(request({ origin: "https://game.example.com" }), config), true);
  assert.equal(isWebSocketOriginAllowed(request({ origin: "https://evil.example" }), config), false);
  assert.equal(isWebSocketOriginAllowed(request(), config), false);
});

test("development WebSockets default to the request host", () => {
  const config = { production: false, allowedOrigins: new Set() };
  assert.equal(isWebSocketOriginAllowed(request({ host: "localhost:4173", origin: "http://localhost:4173" }), config), true);
  assert.equal(isWebSocketOriginAllowed(request({ host: "localhost:4173", origin: "http://evil.example" }), config), false);
  assert.equal(isWebSocketOriginAllowed(request(), config), true);
});

test("forwarded client addresses are trusted only when configured", () => {
  const incoming = request({ "x-forwarded-for": "203.0.113.10, 127.0.0.1" }, "127.0.0.1");
  assert.equal(clientAddress(incoming, false), "127.0.0.1");
  assert.equal(clientAddress(incoming, true), "203.0.113.10");
});

test("message allowance resets after its fixed window", () => {
  const state = { startedAt: 1_000, count: 0 };
  assert.equal(consumeMessageAllowance(state, 1_001, 2, 5_000), true);
  assert.equal(consumeMessageAllowance(state, 1_002, 2, 5_000), true);
  assert.equal(consumeMessageAllowance(state, 1_003, 2, 5_000), false);
  assert.equal(consumeMessageAllowance(state, 6_000, 2, 5_000), true);
});

test("browser security headers restrict executable content and framing", () => {
  const headers = securityHeaders(true);
  assert.match(headers["Content-Security-Policy"], /script-src 'self'/);
  assert.match(headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
});
