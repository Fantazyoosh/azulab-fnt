// Integrity seals and signed share links.
//
// A seal proves that a file did not change: SHA-256 over the bytes, then a
// salted SHA-256 over the digest and the drop id. Both steps are cheap, because
// a seal is part of the product path — it must not burn CPU on every upload.
//
// PBKDF2 still exists, but only as a work factor for the Debug chapter:
// POST /debug/load spends real CPU on the libuv threadpool so the HPA has a
// signal to react to. The product path never calls it.
//
// Seals written by earlier builds used PBKDF2-SHA256 over the digest;
// verifySeal recomputes those too, so old drops keep verifying.
//
// A share link is an HMAC over (id, expiry, key version). The key lives in Key
// Vault and its version travels in the URL, so rotating the secret does not
// break links that were already handed out; disabling an old version revokes
// them. The version is part of the signed payload, so a signature made with v1
// cannot be replayed against v2.

const crypto = require("node:crypto");
const { promisify } = require("node:util");

const pbkdf2 = promisify(crypto.pbkdf2);

const SEAL_ALGORITHM = "SHA256-SALTED";
const LEGACY_SEAL_ALGORITHM = "PBKDF2-SHA256";
const SEAL_KEY_BYTES = 32;

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

// Short, non-reversible identifier for a key. Shown in the UI so an operator
// can tell "the key changed" without ever seeing the key.
function fingerprint(secret) {
  return sha256(Buffer.from(secret, "utf8")).slice(0, 16);
}

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// The cheap seal: the file digest is already unique, the id is the salt.
function saltedSeal(digest, id) {
  return crypto.createHash("sha256").update(`${digest}:${id}`).digest("hex");
}

async function sealBuffer(buffer, { id }) {
  const startedAt = Date.now();
  const digest = sha256(buffer);
  return {
    algorithm: SEAL_ALGORITHM,
    iterations: 0,
    digest,
    seal: saltedSeal(digest, id),
    ms: Date.now() - startedAt,
  };
}

// PBKDF2 is used in exactly two places: /debug/load (the HPA demo) and
// verifySeal for records written before the seal became cheap.
function workFactor(seed, salt, iterations) {
  return pbkdf2(seed, salt, iterations, SEAL_KEY_BYTES, "sha256");
}

async function verifySeal(buffer, record) {
  if (!record) return { ok: false, reason: "unsupported_seal" };
  const startedAt = Date.now();
  const digest = sha256(buffer);

  if (record.algorithm === SEAL_ALGORITHM) {
    const ok = safeEqual(digest, record.digest) && safeEqual(saltedSeal(digest, record.id), record.seal);
    return { ok, digest, ms: Date.now() - startedAt };
  }

  if (record.algorithm === LEGACY_SEAL_ALGORITHM && Number.isInteger(record.iterations)) {
    const derived = await workFactor(digest, record.id, record.iterations);
    const ok = safeEqual(digest, record.digest) && safeEqual(derived.toString("hex"), record.seal);
    return { ok, digest, ms: Date.now() - startedAt };
  }

  return { ok: false, reason: "unsupported_seal" };
}

function signLink({ id, exp, keyVersion, key }) {
  return crypto
    .createHmac("sha256", key)
    .update(`${id}.${exp}.${keyVersion}`)
    .digest("base64url");
}

function verifyLink({ id, exp, keyVersion, sig, key, now = Date.now() }) {
  if (!id || !keyVersion || !sig) return { ok: false, reason: "malformed" };
  if (!Number.isInteger(exp) || exp * 1000 <= now) return { ok: false, reason: "expired" };
  const expected = signLink({ id, exp, keyVersion, key });
  return safeEqual(sig, expected) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

function sharePath({ id, exp, keyVersion, sig }) {
  const params = new URLSearchParams({ exp: String(exp), v: keyVersion, sig });
  return `/s/${encodeURIComponent(id)}?${params.toString()}`;
}

module.exports = {
  LEGACY_SEAL_ALGORITHM,
  SEAL_ALGORITHM,
  fingerprint,
  safeEqual,
  sealBuffer,
  sha256,
  sharePath,
  signLink,
  verifyLink,
  verifySeal,
  workFactor,
};
