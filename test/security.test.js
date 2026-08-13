import test from "node:test";
import assert from "node:assert/strict";
import {
  consumeMessageAllowance,
  isWebSocketOriginAllowed,
  loadSecurityConfig,
  parseAllowedOrigins,
} from "../src/security.js";

test("allowed origins must be exact HTTP(S) origins", () => {
  assert.deepEqual([...parseAllowedOrigins("https://game.example.com,http://localhost:4173")], [
    "https://game.example.com",
    "http://localhost:4173",
  ]);
  assert.throws(() => parseAllowedOrigins("https://game.example.com/path"), /must be origins/);
  assert.throws(() => parseAllowedOrigins("javascript:alert(1)"), /must be origins/);
});

test("a configured allowlist admits only its own origins", () => {
  const allowed = new Set(["https://game.example.com"]);
  assert.equal(isWebSocketOriginAllowed("https://game.example.com", allowed), true);
  assert.equal(isWebSocketOriginAllowed("https://evil.example", allowed), false);
  assert.equal(isWebSocketOriginAllowed("not a url", allowed), false);
  // Browsers always send Origin, so a missing one is not a browser and is refused.
  assert.equal(isWebSocketOriginAllowed(undefined, allowed), false);
});

test("an unconfigured allowlist means local development and admits any origin", () => {
  const unconfigured = new Set();
  assert.equal(isWebSocketOriginAllowed("http://localhost:4173", unconfigured), true);
  assert.equal(isWebSocketOriginAllowed(undefined, unconfigured), true);
});

test("limits come from Worker bindings and are range checked", () => {
  const defaults = loadSecurityConfig({});
  assert.equal(defaults.maxPayloadBytes, 16 * 1024);
  assert.equal(defaults.maxMessagesPerWindow, 40);
  assert.equal(defaults.sessionTtlMs, 24 * 60 * 60 * 1000);
  assert.equal(defaults.allowedOrigins.size, 0);

  const configured = loadSecurityConfig({ MAX_PAYLOAD_BYTES: "2048", ROOM_IDLE_MS: "60000" });
  assert.equal(configured.maxPayloadBytes, 2048);
  assert.equal(configured.roomIdleMs, 60_000);

  assert.throws(() => loadSecurityConfig({ MAX_PAYLOAD_BYTES: "8" }), /between 1024 and/);
  assert.throws(() => loadSecurityConfig({ MESSAGE_WINDOW_MS: "not a number" }), /must be an integer/);
});

test("message allowance resets after its fixed window", () => {
  const state = { startedAt: 1_000, count: 0 };
  assert.equal(consumeMessageAllowance(state, 1_001, 2, 5_000), true);
  assert.equal(consumeMessageAllowance(state, 1_002, 2, 5_000), true);
  assert.equal(consumeMessageAllowance(state, 1_003, 2, 5_000), false);
  assert.equal(consumeMessageAllowance(state, 6_000, 2, 5_000), true);
});
