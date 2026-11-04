// Centralised, validated configuration. Failing fast here is cheaper than failing
// at the first request. (12factor III: config in env, with sane defaults.)
function intEnv(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`invalid integer env value: ${value}`);
  return n;
}

// Values that control demo behaviour have hard bounds: an accidental
// SEAL_ITERATIONS=100000000 would turn a share into a denial of service.
function boundedIntEnv(env, name, fallback, min, max) {
  const value = intEnv(env[name], fallback);
  if (value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max} (got ${value})`);
  }
  return value;
}

function getConfig(env = process.env) {
  const port = intEnv(env.PORT, 8080);
  if (port === 0 || port > 65535) throw new Error(`PORT out of range: ${port}`);

  const maxUploadBytes = intEnv(env.MAX_UPLOAD_BYTES, 5 * 1024 * 1024);
  if (maxUploadBytes < 1) throw new Error("MAX_UPLOAD_BYTES must be >= 1");

  const shutdownTimeoutMs = intEnv(env.SHUTDOWN_TIMEOUT_MS, 10000);

  return {
    port,
    keyVaultUrl: env.KEY_VAULT_URL || "",
    secretName: env.SECRET_NAME || "app-message",
    // The key that signs share links. It is a separate secret on purpose:
    // rotating it must not touch the message demo or the vault itself.
    signingSecretName: env.SHARE_SIGNING_SECRET || "share-signing-key",
    storageAccountUrl: env.STORAGE_ACCOUNT_URL || "",
    containerName: env.CONTAINER_NAME || "demo",
    dropContainer: env.DROP_CONTAINER || "drops",
    // "memory" is a developer convenience, never the deployed default. It is
    // reported by /api/config so the UI can label the instance honestly.
    dropStore: env.DROP_STORE || "",
    // Azure Container Apps with a user-assigned managed identity needs the
    // client id to request tokens; DefaultAzureCredential does not guess it.
    azureClientId: env.AZURE_CLIENT_ID || "",
    // Used by the RBAC probe to attempt a control-plane call that must fail.
    subscriptionId: env.AZURE_SUBSCRIPTION_ID || "",
    resourceGroup: env.AZURE_RESOURCE_GROUP || "",
    maxUploadBytes,
    // A seal is CPU work by design; 600k PBKDF2 iterations is roughly a third
    // of a core-second on a D2as_v5, which is enough for HPA to react.
    sealIterations: boundedIntEnv(env, "SEAL_ITERATIONS", 600000, 10000, 2000000),
    shareTtlSeconds: boundedIntEnv(env, "SHARE_TTL_SECONDS", 900, 60, 86400),
    shutdownTimeoutMs,
    logLevel: env.LOG_LEVEL || "info",
    nodeEnv: env.NODE_ENV || "development",
    // Off by default: a public switch that can drain a replica is a lab tool,
    // not a production feature.
    enableDebugEndpoints: env.ENABLE_DEBUG_ENDPOINTS === "true",
  };
}

module.exports = { getConfig };
