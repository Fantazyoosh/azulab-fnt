// Centralised, validated configuration. Failing fast here is cheaper than failing
// at the first request. (12factor III: config in env, with sane defaults.)
function intEnv(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`invalid integer env value: ${value}`);
  return n;
}

function getConfig(env = process.env) {
  const port = intEnv(env.PORT, 8080);
  if (port === 0 || port > 65535) throw new Error(`PORT out of range: ${port}`);

  const maxUploadBytes = intEnv(env.MAX_UPLOAD_BYTES, 1024 * 1024);
  if (maxUploadBytes < 1) throw new Error("MAX_UPLOAD_BYTES must be >= 1");

  const shutdownTimeoutMs = intEnv(env.SHUTDOWN_TIMEOUT_MS, 10000);

  return {
    port,
    keyVaultUrl: env.KEY_VAULT_URL || "",
    secretName: env.SECRET_NAME || "app-message",
    storageAccountUrl: env.STORAGE_ACCOUNT_URL || "",
    containerName: env.CONTAINER_NAME || "demo",
    // Azure Container Apps with a user-assigned managed identity needs the
    // client id to request tokens; DefaultAzureCredential does not guess it.
    azureClientId: env.AZURE_CLIENT_ID || "",
    maxUploadBytes,
    shutdownTimeoutMs,
    logLevel: env.LOG_LEVEL || "info",
    nodeEnv: env.NODE_ENV || "development",
  };
}

module.exports = { getConfig };
