import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { decryptSecret, encryptSecret } from "@/lib/sms/credentials-crypto";

const key = randomBytes(32).toString("base64");

test("round-trips and never contains the plaintext", () => {
  const sealed = encryptSecret("my-auth-token", key);
  assert.match(sealed, /^v1:/);
  assert.ok(!sealed.includes("my-auth-token"));
  assert.equal(decryptSecret(sealed, key), "my-auth-token");
});

test("same input encrypts differently each time", () => {
  assert.notEqual(encryptSecret("x", key), encryptSecret("x", key));
});

test("wrong key or tampering fails", () => {
  const sealed = encryptSecret("token", key);
  assert.throws(() => decryptSecret(sealed, randomBytes(32).toString("base64")));
  const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "B" : "A") + sealed.slice(-1);
  assert.throws(() => decryptSecret(tampered, key));
});

test("rejects a key that is not 32 bytes", () => {
  assert.throws(() => encryptSecret("x", Buffer.from("short").toString("base64")), /32 bytes/);
});
