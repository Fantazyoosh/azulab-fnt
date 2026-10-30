// azureflow application entry point.
// Runs locally with `npm start` and in Azure Container Apps.
// Cloud credentials are resolved with DefaultAzureCredential (managed identity in
// Azure, `az login` / env vars locally). No secrets are baked into the image.

const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");
const { BlobServiceClient } = require("@azure/storage-blob");
const express = require("express");

const PORT = process.env.PORT || 8080;
const KEY_VAULT_URL = process.env.KEY_VAULT_URL;
const SECRET_NAME = process.env.SECRET_NAME || "app-message";
const STORAGE_ACCOUNT_URL = process.env.STORAGE_ACCOUNT_URL;
const CONTAINER_NAME = process.env.CONTAINER_NAME || "demo";

const credential = new DefaultAzureCredential();

let secretCache = process.env.APP_MESSAGE || "hello from azureflow (no Key Vault configured)";

async function loadSecret() {
  if (!KEY_VAULT_URL) return;
  try {
    const client = new SecretClient(KEY_VAULT_URL, credential);
    const s = await client.getSecret(SECRET_NAME);
    secretCache = s.value;
  } catch (err) {
    // Keep the fallback; surface the error in logs only.
    console.error(`keyvault secret load failed: ${err.message}`);
  }
}

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "azureflow", timestamp: new Date().toISOString() });
  });

  app.get("/api/message", (_req, res) => {
    res.json({ message: secretCache, source: KEY_VAULT_URL ? "keyvault" : "env" });
  });

  app.get("/api/blobs", async (_req, res) => {
    if (!STORAGE_ACCOUNT_URL) return res.status(503).json({ error: "storage not configured" });
    try {
      const service = new BlobServiceClient(STORAGE_ACCOUNT_URL, credential);
      const container = service.getContainerClient(CONTAINER_NAME);
      const items = [];
      for await (const b of container.listBlobsFlat()) items.push(b.name);
      res.json({ container: CONTAINER_NAME, blobs: items });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/blobs", async (req, res) => {
    if (!STORAGE_ACCOUNT_URL) return res.status(503).json({ error: "storage not configured" });
    const { name, content } = req.body || {};
    if (!name) return res.status(400).json({ error: "name required" });
    try {
      const service = new BlobServiceClient(STORAGE_ACCOUNT_URL, credential);
      const container = service.getContainerClient(CONTAINER_NAME);
      await container.createIfNotExists();
      const block = container.getBlockBlobClient(name);
      await block.upload(content || "", Buffer.byteLength(content || ""), {
        blobHTTPHeaders: { contentType: "text/plain" },
      });
      res.status(201).json({ name, container: CONTAINER_NAME });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

module.exports = { buildApp, loadSecret };

if (require.main === module) {
  (async () => {
    await loadSecret();
    const app = buildApp();
    app.listen(PORT, () => console.log(`azureflow listening on ${PORT}`));
  })();
}
