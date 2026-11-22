import assert from "node:assert/strict";
import { test } from "node:test";
import { isProtectedSoloSandbox } from "./solo-beta-protected-sandbox.ts";

test("sandbox needs an opt-in, a test key, and an explicit loopback API address", () => {
  assert.equal(isProtectedSoloSandbox(true, "http://127.0.0.1:54321", "sk_test_fixture"), true);
  assert.equal(isProtectedSoloSandbox(true, "http://127.0.0.1:54321", "rk_test_fixture"), true);
  assert.equal(isProtectedSoloSandbox(false, "http://127.0.0.1:54321", "sk_test_fixture"), false);
  assert.equal(isProtectedSoloSandbox(true, "http://127.0.0.1:54321", "sk_live_fixture"), false);
  for (const url of [
    "https://paige.example.com",
    "http://127.0.0.1",
    "http://127.0.0.1:54321/remote",
    "http://127.0.0.1:54321?upstream=remote",
    "http://127.0.0.1:54321@remote.example:54321",
    "http://127.0.0.1:54321.remote.example",
  ]) assert.equal(isProtectedSoloSandbox(true, url, "sk_test_fixture"), false, url);
});
