// Integrity seals and signed share links.
//
// A seal is a deliberately slow fingerprint of a file. SHA-256 gives the
// digest; PBKDF2 stretches it with a work factor. Recomputing it is real CPU
// work, which is exactly what the autoscaling demo needs, and changing a single
// byte changes the result.
//
// A share link is an HMAC over (id, expiry, key version). The key lives in Key
// Vault and its version travels in the URL, so rotating the secret does not
// break links that were already handed out; disabling an old version revokes
// them. The version is part of the signed payload, so a signature made with v1
// cannot be replayed against v2.

const crypto = require("node:crypto");
const { promisify } = require("node:util");

const pbkdf2 = promisify(crypto.pbkdf2);

const SEAL_ALGORITHM = "PBKDF2-SHA256";
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

async function sealBuffer(buffer, { id, iterations }) {
  const startedAt = Date.now();
  const digest = sha256(buffer);
  const derived = await pbkdf2(digest, id, iterations, SEAL_KEY_BYTES, "sha256");
  return {
    algorithm: SEAL_ALGORITHM,
    iterations,
    digest,
    seal: derived.toString("hex"),
    ms: Date.now() - startedAt,
  };
}

async function verifySeal(buffer, record) {
  if (!record || record.algorithm !== SEAL_ALGORITHM || !Number.isInteger(record.iterations)) {
    return { ok: false, reason: "unsupported_seal" };
  }
  const startedAt = Date.now();
  const digest = sha256(buffer);
  const derived = await pbkdf2(digest, record.id, record.iterations, SEAL_KEY_BYTES, "sha256");
  const ok = safeEqual(derived.toString("hex"), record.seal) && safeEqual(digest, record.digest);
  return { ok, digest, ms: Date.now() - startedAt };
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
  SEAL_ALGORITHM,
  fingerprint,
  safeEqual,
  sealBuffer,
  sha256,
  sharePath,
  signLink,
  verifyLink,
  verifySeal,
};
