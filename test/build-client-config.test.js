import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertCspAllowsGameServer, clientConfigSource } from "../scripts/build-client-config.mjs";

const vercelConfigPath = new URL("../vercel.json", import.meta.url);

test("the generated client config always dials a secure socket", () => {
  assert.match(
    clientConfigSource("https://ws.example.com"),
    /window\.DRAFT_HOLDEM_CONFIG = \{ gameServerUrl: "wss:\/\/ws\.example\.com" \};/,
  );
  assert.match(clientConfigSource("wss://ws.example.com:8443"), /"wss:\/\/ws\.example\.com:8443"/);
});

test("an endpoint the browser cannot use fails the build", () => {
  assert.throws(() => clientConfigSource("ws://ws.example.com"), /must start with wss:\/\/ or https:\/\//);
  assert.throws(() => clientConfigSource("http://ws.example.com"), /must start with wss:\/\/ or https:\/\//);
  assert.throws(() => clientConfigSource("ws.example.com"), /is not a URL/);
});

test("a Content-Security-Policy that would block the socket fails the build", () => {
  const config = {
    headers: [{
      source: "/(.*)",
      headers: [{
        key: "Content-Security-Policy",
        value: "default-src 'self'; connect-src 'self' wss://ws.example.com; img-src 'self'",
      }],
    }],
  };
  assert.doesNotThrow(() => assertCspAllowsGameServer(config, "wss://ws.example.com"));
  assert.throws(() => assertCspAllowsGameServer(config, "wss://other.example.com"), /connect-src must list/);
  assert.throws(() => assertCspAllowsGameServer({ headers: [] }, "wss://ws.example.com"), /no Content-Security-Policy/);
});

// Guards the pairing this project actually deploys with.
test("the committed vercel.json permits the deployed game server", async () => {
  const config = JSON.parse(await readFile(vercelConfigPath, "utf8"));
  assert.doesNotThrow(() => assertCspAllowsGameServer(config, "wss://ws.draft-hold-em.binhnguyen.dev"));
});
