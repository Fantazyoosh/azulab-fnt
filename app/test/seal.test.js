const test = require("node:test");
const assert = require("node:assert/strict");

const {
  LEGACY_SEAL_ALGORITHM,
  SEAL_ALGORITHM,
  sealBuffer,
  sharePath,
  sha256,
  signLink,
  verifyLink,
  verifySeal,
  workFactor,
} = require("../src/seal");

const ID = "abcdefghijkl";
const KEY = "test-signing-key";
const VERSION = "version-1";
// Only used to build a record in the old PBKDF2 format.
const LEGACY_ITERATIONS = 10000;

test("sha256 matches the known vector", () => {
  assert.equal(
    sha256(Buffer.from("abc")),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
  );
});

test("the product seal is cheap and deterministic", async () => {
  const a = await sealBuffer(Buffer.from("hello"), { id: ID });
  const b = await sealBuffer(Buffer.from("hello"), { id: ID });
  assert.equal(a.seal, b.seal);
  assert.equal(a.digest, b.digest);
  assert.equal(a.algorithm, SEAL_ALGORITHM);
  assert.equal(a.iterations, 0);
});

test("seal changes when the salt or one byte of content changes", async () => {
  const base = await sealBuffer(Buffer.from("hello"), { id: ID });
  const otherSalt = await sealBuffer(Buffer.from("hello"), { id: "zzzzzzzzzzzz" });
  const otherContent = await sealBuffer(Buffer.from("hellp"), { id: ID });
  assert.notEqual(base.seal, otherSalt.seal);
  assert.notEqual(base.seal, otherContent.seal);
});

test("verifySeal accepts the original bytes", async () => {
  const buffer = Buffer.from("payload");
  const record = { ...(await sealBuffer(buffer, { id: ID })), id: ID };
  const result = await verifySeal(buffer, record);
  assert.equal(result.ok, true);
});

test("verifySeal rejects tampered bytes", async () => {
  const record = { ...(await sealBuffer(Buffer.from("payload"), { id: ID })), id: ID };
  const result = await verifySeal(Buffer.from("payloaD"), record);
  assert.equal(result.ok, false);
});

test("verifySeal still accepts a legacy PBKDF2 record", async () => {
  const buffer = Buffer.from("payload");
  const digest = sha256(buffer);
  const derived = await workFactor(digest, ID, LEGACY_ITERATIONS);
  const record = {
    id: ID,
    algorithm: LEGACY_SEAL_ALGORITHM,
    iterations: LEGACY_ITERATIONS,
    digest,
    seal: derived.toString("hex"),
  };
  assert.equal((await verifySeal(buffer, record)).ok, true);
  assert.equal((await verifySeal(Buffer.from("payloaD"), record)).ok, false);
});

test("verifySeal rejects an unknown algorithm", async () => {
  const result = await verifySeal(Buffer.from("x"), { algorithm: "MD5", iterations: 1, id: ID, seal: "x", digest: "y" });
  assert.equal(result.ok, false);
  assert.equal(result.reason, "unsupported_seal");
});

test("signLink and verifyLink round-trip", () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const sig = signLink({ id: ID, exp, keyVersion: VERSION, key: KEY });
  assert.equal(verifyLink({ id: ID, exp, keyVersion: VERSION, sig, key: KEY }).ok, true);
});

test("verifyLink rejects an expired link", () => {
  const exp = Math.floor(Date.now() / 1000) - 1;
  const sig = signLink({ id: ID, exp, keyVersion: VERSION, key: KEY });
  assert.deepEqual(verifyLink({ id: ID, exp, keyVersion: VERSION, sig, key: KEY }), {
    ok: false,
    reason: "expired",
  });
});

test("verifyLink rejects a tampered signature or a different key", () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const sig = signLink({ id: ID, exp, keyVersion: VERSION, key: KEY });
  assert.equal(verifyLink({ id: ID, exp, keyVersion: VERSION, sig: `${sig}x`, key: KEY }).reason, "bad_signature");
  assert.equal(verifyLink({ id: ID, exp, keyVersion: VERSION, sig, key: "another-key" }).reason, "bad_signature");
});

test("verifyLink binds the signature to the key version", () => {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const sig = signLink({ id: ID, exp, keyVersion: VERSION, key: KEY });
  assert.equal(verifyLink({ id: ID, exp, keyVersion: "version-2", sig, key: KEY }).reason, "bad_signature");
});

test("sharePath carries id, expiry, version and signature", () => {
  const path = sharePath({ id: ID, exp: 1700000000, keyVersion: VERSION, sig: "abc" });
  const url = new URL(path, "http://localhost");
  assert.equal(url.pathname, `/s/${ID}`);
  assert.equal(url.searchParams.get("exp"), "1700000000");
  assert.equal(url.searchParams.get("v"), VERSION);
  assert.equal(url.searchParams.get("sig"), "abc");
});
