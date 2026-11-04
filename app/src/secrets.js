// The share-signing key, read from Key Vault and cached by version.
//
// Key Vault secret versions are immutable, so a version can be cached for the
// life of the process. The *current* version is re-read every five minutes so a
// rotation is picked up without a redeploy. Keeping the previous versions
// cached is what makes old links survive a rotation: the link names the version
// it was signed with.
//
// Without a vault (local development, unit tests) the store generates an
// ephemeral key and says so, instead of pretending to use Key Vault.

const crypto = require("node:crypto");

const { SecretClient } = require("@azure/keyvault-secrets");

const { fingerprint } = require("./seal");

const CURRENT_TTL_MS = 5 * 60 * 1000;

function publicView(entry) {
  if (!entry) return null;
  return {
    version: entry.version,
    source: entry.source,
    loadedAt: entry.loadedAt,
    fingerprint: entry.fingerprint,
    stale: Boolean(entry.stale),
  };
}

function createSigningKeyStore({ cfg, credential, logger, now = Date.now }) {
  const cache = new Map();
  let current = null;
  let inflight = null;
  let ephemeral = null;

  function ephemeralKey() {
    if (!ephemeral) {
      const value = crypto.randomBytes(32).toString("base64");
      ephemeral = {
        value,
        version: "ephemeral",
        source: "ephemeral",
        loadedAt: new Date(now()).toISOString(),
        loadedAtMs: now(),
        fingerprint: fingerprint(value),
      };
    }
    return ephemeral;
  }

  async function fetchVersion(version) {
    const client = new SecretClient(cfg.keyVaultUrl, credential);
    const options = version ? { version } : undefined;
    const secret = await client.getSecret(cfg.signingSecretName, options);
    const resolved = secret.properties.version;
    const entry = {
      value: secret.value,
      version: resolved,
      source: "keyvault",
      loadedAt: new Date(now()).toISOString(),
      loadedAtMs: now(),
      fingerprint: fingerprint(secret.value),
    };
    cache.set(resolved, entry);
    return entry;
  }

  function loadCurrent() {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        current = await fetchVersion(null);
        return current;
      } catch (err) {
        logger.error({ err: err.message }, "signing key fetch failed");
        if (current) return { ...current, stale: true };
        throw err;
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  }

  return {
    async get(version = null) {
      if (!cfg.keyVaultUrl) return ephemeralKey();

      if (version) {
        if (cache.has(version)) return cache.get(version);
        return fetchVersion(version);
      }

      if (current && now() - current.loadedAtMs < CURRENT_TTL_MS) return current;
      return loadCurrent();
    },

    snapshot() {
      return publicView(current || ephemeral);
    },
  };
}

module.exports = { CURRENT_TTL_MS, createSigningKeyStore, publicView };
