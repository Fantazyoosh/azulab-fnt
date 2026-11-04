const test = require("node:test");
const assert = require("node:assert/strict");

const { VERSION_CHECK_TTL_MS, createSigningKeyStore } = require("../src/secrets");

// The store talks to Key Vault through one method; a fake client is enough to
// prove the cache policy without network access.
function fakeClient() {
  const calls = [];
  let failure = null;
  return {
    calls,
    failWith(err) {
      failure = err;
    },
    succeed() {
      failure = null;
    },
    async getSecret(name, options) {
      calls.push({ name, version: options && options.version });
      if (failure) throw failure;
      return {
        value: "test-signing-value",
        properties: { version: (options && options.version) || "version-1" },
      };
    },
  };
}

function vaultError(statusCode, message = "vault error") {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function makeStore(client, now) {
  return createSigningKeyStore({
    cfg: { keyVaultUrl: "https://fake.vault.azure.net/", signingSecretName: "share-signing-key" },
    credential: null,
    logger: { error() {} },
    now,
    secretClient: client,
  });
}

test("a cached version is re-checked after the TTL and dropped when disabled", async () => {
  let clock = 1_000_000;
  const client = fakeClient();
  const store = makeStore(client, () => clock);

  const first = await store.get("version-1");
  assert.equal(first.value, "test-signing-value");
  assert.equal(client.calls.length, 1);

  // Inside the TTL the cache answers without a vault call.
  clock += VERSION_CHECK_TTL_MS - 1;
  await store.get("version-1");
  assert.equal(client.calls.length, 1);

  // After the TTL an enabled version is re-read.
  clock += 2;
  await store.get("version-1");
  assert.equal(client.calls.length, 2);

  // A disabled version answers 403; the entry must not survive in cache.
  clock += VERSION_CHECK_TTL_MS + 1;
  client.failWith(vaultError(403, "secret disabled"));
  await assert.rejects(() => store.get("version-1"));

  client.succeed();
  clock += 1;
  const after = await store.get("version-1");
  assert.equal(after.value, "test-signing-value");
  assert.equal(client.calls.length, 4);
});

test("a transient vault failure keeps the cached key and marks it stale", async () => {
  let clock = 2_000_000;
  const client = fakeClient();
  const store = makeStore(client, () => clock);

  await store.get("version-1");
  clock += VERSION_CHECK_TTL_MS + 1;
  client.failWith(vaultError(503, "vault unavailable"));

  const result = await store.get("version-1");
  assert.equal(result.value, "test-signing-value");
  assert.equal(result.stale, true);
});
