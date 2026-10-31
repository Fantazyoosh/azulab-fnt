// azulab application entry point.
//
// Design notes (12factor-flavoured):
//  * config in env (config.js)
//  * no state in processes (no sessions; secret is a cache, reproducible)
//  * port binding; logs to stdout as JSON
//  * graceful shutdown on SIGTERM
//
// Runs locally with `npm start` and in Azure Container Apps.

const { DefaultAzureCredential } = require("@azure/identity");
const { SecretClient } = require("@azure/keyvault-secrets");
const { BlobServiceClient } = require("@azure/storage-blob");
const crypto = require("node:crypto");
const express = require("express");

const { getConfig } = require("./config");
const { createLogger } = require("./logger");
const { metrics } = require("./metrics");

const credential = new DefaultAzureCredential();

function createState(cfg) {
  return {
    cfg,
    secretCache: process.env.APP_MESSAGE || "hello from azulab (no Key Vault configured)",
    secretLoaded: false,
    secretError: null,
    ready: false,
    shuttingDown: false,
  };
}

async function loadSecret(cfg, logger, state) {
  const s = state || createState(cfg);
  if (!cfg.keyVaultUrl) {
    s.secretLoaded = true;
    return s.secretCache;
  }
  try {
    const client = new SecretClient(cfg.keyVaultUrl, credential);
    const sec = await client.getSecret(cfg.secretName);
    s.secretCache = sec.value || s.secretCache;
    s.secretLoaded = true;
    s.secretError = null;
    return s.secretCache;
  } catch (err) {
    s.secretError = err.message;
    s.secretLoaded = false;
    logger.error({ err: err.message }, "keyvault secret load failed");
    return s.secretCache;
  }
}

function blobNameValid(name) {
  return typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name);
}

function getBlobClient(cfg, name) {
  const service = new BlobServiceClient(cfg.storageAccountUrl, credential);
  const container = service.getContainerClient(cfg.containerName);
  return { service, container, block: container.getBlockBlobClient(name) };
}

function buildApp(cfg = getConfig(), logger = createLogger(cfg.logLevel), state = null) {
  if (!state) state = createState(cfg);
  const app = express();

  app.locals.state = state;
  app.locals.cfg = cfg;
  app.locals.logger = logger;

  app.use(express.json({ limit: cfg.maxUploadBytes }));
  app.use((req, res, next) => {
    const id = req.get("x-request-id") || crypto.randomUUID();
    req.requestId = id;
    res.setHeader("x-request-id", id);
    next();
  });

  // Structured request log + metrics.
  app.use((req, res, next) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      metrics.record(res.statusCode, duration);
      logger.info(
        {
          requestId: req.requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: duration,
        },
        "request"
      );
    });
    next();
  });

  app.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", service: "azulab", now: new Date().toISOString() });
  });

  app.get("/ready", async (_req, res) => {
    if (state.shuttingDown) {
      return res.status(503).json({ status: "shutting_down" });
    }
    const checks = {
      config: true,
      keyVault: cfg.keyVaultUrl ? (state.secretLoaded ? "ok" : "degraded") : "not_configured",
      storage: cfg.storageAccountUrl ? "configured" : "not_configured",
    };
    const ok = (cfg.keyVaultUrl && !state.secretLoaded) ? false : true;
    res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "not_ready", checks });
  });

  app.get("/api/message", (_req, res) => {
    res.json({ message: state.secretCache, source: cfg.keyVaultUrl ? "keyvault" : "env" });
  });

  app.get("/api/blobs", async (_req, res) => {
    if (!cfg.storageAccountUrl) return res.status(503).json({ error: "storage not configured" });
    try {
      const { container } = getBlobClient(cfg);
      const items = [];
      for await (const b of container.listBlobsFlat()) items.push(b.name);
      res.json({ container: cfg.containerName, blobs: items });
    } catch (err) {
      logger.error({ err: err.message }, "blob list failed");
      res.status(500).json({ error: "blob_list_failed", message: err.message });
    }
  });

  app.post("/api/blobs", async (req, res) => {
    const { name, content } = req.body || {};
    if (!blobNameValid(name)) {
      return res.status(400).json({ error: "invalid_name", message: "name must be 1-128 safe chars" });
    }
    const body = content === undefined || content === null ? "" : String(content);
    if (Buffer.byteLength(body, "utf8") > cfg.maxUploadBytes) {
      return res.status(413).json({ error: "too_large", message: `max ${cfg.maxUploadBytes} bytes` });
    }
    if (!cfg.storageAccountUrl) return res.status(503).json({ error: "storage not configured" });

    try {
      const { container, block } = getBlobClient(cfg, name);
      await container.createIfNotExists();
      await block.uploadData(Buffer.from(body, "utf8"), {
        blobHTTPHeaders: { blobContentType: "text/plain; charset=utf-8" },
      });
      res.status(201).json({ name, container: cfg.containerName, bytes: Buffer.byteLength(body, "utf8") });
    } catch (err) {
      logger.error({ err: err.message, name }, "blob upload failed");
      res.status(500).json({ error: "blob_upload_failed", message: err.message });
    }
  });

  app.get("/api/blobs/:name", async (req, res) => {
    const name = decodeURIComponent(req.params.name);
    if (!blobNameValid(name)) return res.status(400).json({ error: "invalid_name" });
    if (!cfg.storageAccountUrl) return res.status(503).json({ error: "storage not configured" });

    try {
      const { block } = getBlobClient(cfg, name);
      const download = await block.download(0);
      res.type("text/plain; charset=utf-8");
      download.readableStreamBody.pipe(res);
    } catch (err) {
      const status = err.statusCode === 404 ? 404 : 500;
      res.status(status).json({ error: status === 404 ? "not_found" : "blob_download_failed", message: err.message });
    }
  });

  app.delete("/api/blobs/:name", async (req, res) => {
    const name = decodeURIComponent(req.params.name);
    if (!blobNameValid(name)) return res.status(400).json({ error: "invalid_name" });
    if (!cfg.storageAccountUrl) return res.status(503).json({ error: "storage not configured" });

    try {
      const { block } = getBlobClient(cfg, name);
      await block.deleteIfExists();
      res.status(204).send();
    } catch (err) {
      logger.error({ err: err.message, name }, "blob delete failed");
      res.status(500).json({ error: "blob_delete_failed", message: err.message });
    }
  });

  app.get("/metrics", (_req, res) => {
    res.json(metrics.snapshot());
  });

  // Central error handler. Never leak stack traces to clients.
  app.use((err, req, res, _next) => {
    logger.error({ err: err && err.message, stack: err && err.stack, requestId: req.requestId }, "unhandled error");
    const status = err && err.status ? err.status : 500;
    res.status(status).json({ error: "internal_error", message: "something went wrong", requestId: req.requestId });
  });

  return app;
}

function start(cfg = getConfig(), logger = createLogger(cfg.logLevel)) {
  const state = createState(cfg);
  // Load secret before reporting ready; failures are recorded but do not crash.
  loadSecret(cfg, logger, state).catch((e) => logger.error({ err: e.message }, "loadSecret rejected"));
  const app = buildApp(cfg, logger, state);

  const server = app.listen(cfg.port, () => {
    logger.info({ port: cfg.port }, "azulab listening");
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    state.shuttingDown = true;
    state.ready = false;
    logger.info({ signal }, "shutting down gracefully");
    server.close(() => {
      logger.info("http server closed");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("forced exit after timeout");
      process.exit(1);
    }, cfg.shutdownTimeoutMs).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  server.on("listening", () => {
    state.ready = !state.secretError;
  });

  return server;
}

module.exports = { buildApp, loadSecret, start, createState, getConfig };

if (require.main === module) {
  start();
}
