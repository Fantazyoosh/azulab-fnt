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
const pkg = require("../package.json");

const { getConfig } = require("./config");
const { createLogger } = require("./logger");
const { metrics } = require("./metrics");

function createCredential(cfg = {}) {
  return cfg.azureClientId
    ? new DefaultAzureCredential({ managedIdentityClientId: cfg.azureClientId })
    : new DefaultAzureCredential();
}

function createState(cfg) {
  return {
    cfg,
    secretCache: process.env.APP_MESSAGE || "hello from azulab (no Key Vault configured)",
    secretLoaded: false,
    secretError: null,
    ready: false,
    shuttingDown: false,
    // Readiness is a *runtime* signal: the pod can be alive but unable to serve
    // traffic (dependency down, or an operator forcing it out of rotation).
    failReadiness: false,
    failReadinessUntil: 0,
    storageOk: null,
    storageCheckedAt: 0,
    storageFailures: 0,
    startedAt: new Date().toISOString(),
  };
}

// Identity of the process as seen by the orchestrator. In Kubernetes these come
// from the downward API (HOSTNAME is the pod name by default); locally they are
// "unknown" and that is fine.
function runtimeInfo(state) {
  return {
    service: "azulab",
    version: process.env.APP_VERSION || pkg.version,
    pod: process.env.HOSTNAME || "unknown",
    node: process.env.NODE_NAME || "unknown",
    namespace: process.env.POD_NAMESPACE || "unknown",
    image: process.env.APP_IMAGE || "unknown",
    startedAt: state.startedAt,
    now: new Date().toISOString(),
  };
}

// Bounded dependency check for the readiness probe. A probe must never hang:
// if Storage does not answer within the timeout, the pod is "not ready", not
// "stuck". Results are cached briefly so a 2s probe interval cannot hammer
// the Storage account (and burn request quota).
async function checkStorage(cfg) {
  if (!cfg.storageAccountUrl) return "not_configured";
  let timer;
  try {
    const { container } = getBlobClient(cfg);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("storage check timed out")), 2000);
    });
    await Promise.race([container.exists(), timeout]);
    return "ok";
  } catch (_err) {
    return "error";
  } finally {
    clearTimeout(timer);
  }
}

// Time-bounded readiness override. A permanent switch would leave a replica
// out of rotation forever (and unreachable through the Service, so you could
// not even turn it back off remotely).
function readinessForced(state) {
  if (!state.failReadiness) return false;
  if (state.failReadinessUntil && Date.now() >= state.failReadinessUntil) {
    state.failReadiness = false;
    state.failReadinessUntil = 0;
    return false;
  }
  return true;
}

async function loadSecret(cfg, logger, state) {
  const s = state || createState(cfg);
  if (!cfg.keyVaultUrl) {
    s.secretLoaded = true;
    return s.secretCache;
  }
  try {
    const credential = createCredential(cfg);
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

// Key Vault is a network dependency that can be slow at pod start. A single
// attempt would leave /ready at 503 forever, so retry with capped exponential
// backoff. Failures are logged but never crash the process.
async function loadSecretWithRetry(cfg, logger, state, attempts = 5) {
  for (let i = 0; i < attempts; i += 1) {
    await loadSecret(cfg, logger, state);
    if (state.secretLoaded) return state.secretCache;
    if (i === attempts - 1) break;
    const delay = Math.min(1000 * 2 ** i, 15000);
    logger.warn({ attempt: i + 1, delayMs: delay }, "retrying keyvault secret load");
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return state.secretCache;
}

function getBlobClient(cfg) {
  const service = new BlobServiceClient(cfg.storageAccountUrl, createCredential(cfg));
  const container = service.getContainerClient(cfg.containerName);
  return { service, container };
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
    // Lets you prove load balancing with one curl loop: every response tells
    // you which replica served it.
    res.setHeader("x-pod-name", process.env.HOSTNAME || "local");
    next();
  });

  // Structured request log + metrics.
  app.use(express.static("public"));

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

  app.get("/version", (_req, res) => {
    res.status(200).json(runtimeInfo(state));
  });

  app.get("/ready", async (_req, res) => {
    if (state.shuttingDown) {
      return res.status(503).json({ status: "shutting_down" });
    }
    if (readinessForced(state)) {
      // Deliberate failure used to demonstrate that Kubernetes removes a pod
      // from Service endpoints instead of sending users to an error page.
      return res.status(503).json({
        status: "not_ready",
        checks: { debug: "forced_failure" },
        autoResetInSeconds: Math.max(0, Math.ceil((state.failReadinessUntil - Date.now()) / 1000)),
      });
    }

    const now = Date.now();
    if (state.storageCheckedAt === 0 || now - state.storageCheckedAt > 10000) {
      const result = await checkStorage(cfg);
      state.storageOk = result;
      state.storageCheckedAt = now;
      state.storageFailures = result === "error" ? state.storageFailures + 1 : 0;
    }

    const checks = {
      keyVault: cfg.keyVaultUrl ? (state.secretLoaded ? "ok" : "error") : "not_configured",
      storage: state.storageOk,
      storageConsecutiveFailures: state.storageFailures,
    };
    // One transient failure is not enough to remove a pod from rotation — that
    // would make the Service flap. Two in a row is a real dependency outage.
    const storageOk = checks.storage !== "error" || state.storageFailures < 2;
    const ok = checks.keyVault !== "error" && storageOk;
    res.status(ok ? 200 : 503).json({ status: ok ? "ready" : "not_ready", checks });
  });

  // Debug endpoint, disabled unless ENABLE_DEBUG_ENDPOINTS=true. It is a lab
  // affordance, not something you expose in production: anyone who can reach it
  // could pull every replica out of the load balancer.
  app.post("/debug/fail-readiness", (req, res) => {
    if (!cfg.enableDebugEndpoints) {
      return res.status(404).json({ error: "not_found" });
    }
    const raw = req.query.value !== undefined ? req.query.value : req.body && req.body.value;
    state.failReadiness = raw === undefined ? !state.failReadiness : String(raw) === "true";
    const ttl = Math.min(Math.max(Number(req.query.ttl) || 60, 5), 600);
    state.failReadinessUntil = state.failReadiness ? Date.now() + ttl * 1000 : 0;
    logger.warn({ failReadiness: state.failReadiness, ttlSeconds: state.failReadiness ? ttl : 0 }, "readiness override changed");
    res.status(200).json({
      failReadiness: state.failReadiness,
      autoResetInSeconds: state.failReadiness ? ttl : 0,
    });
  });

  app.get("/api/message", async (_req, res) => {
    if (!cfg.storageAccountUrl) {
      return res.json({ message: `${state.secretCache} (Sekret z Vault)`, source: "vault" });
    }
    try {
      const { container } = getBlobClient(cfg);
      const block = container.getBlockBlobClient("current_message.txt");
      const download = await block.download(0);
      let content = "";
      for await (const chunk of download.readableStreamBody) {
        content += chunk.toString();
      }
      res.json({ message: content || state.secretCache, source: "blob" });
    } catch (err) {
      res.json({ message: `${state.secretCache} (Sekret z Vault)`, source: "vault" });
    }
  });

  app.post("/api/message", async (req, res) => {
    const { message } = req.body || {};
    if (!cfg.storageAccountUrl) return res.status(503).json({ error: "storage not configured" });

    try {
      const { container } = getBlobClient(cfg);
      const block = container.getBlockBlobClient("current_message.txt");
      await container.createIfNotExists();

      if (!message || typeof message !== "string" || message.trim() === "") {
        await block.deleteIfExists();
        return res.status(200).json({ success: true, message: "Message cleared, falling back to Key Vault" });
      }

      await block.uploadData(Buffer.from(message, "utf8"), {
        blobHTTPHeaders: { blobContentType: "text/plain; charset=utf-8" },
      });
      res.status(201).json({ success: true, message: "Message updated in cloud storage" });
    } catch (err) {
      res.status(500).json({ error: "update_failed", message: err.message });
    }
  });

  app.get("/api/blobs", async (_req, res) => {
    if (!cfg.storageAccountUrl) return res.status(503).json({ error: "storage not configured" });
    try {
      const { container } = getBlobClient(cfg);
      const items = [];
      for await (const b of container.listBlobsFlat()) items.push(b.name);
      res.json({ container: cfg.containerName, blobs: items });
    } catch (err) {
      logger.error({ err: err.message, stack: err.stack }, "blob list failed");

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
      const { container } = getBlobClient(cfg);
      const block = container.getBlockBlobClient(name);
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
      const { container } = getBlobClient(cfg);
      const block = container.getBlockBlobClient(name);
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
      const { container } = getBlobClient(cfg);
      const block = container.getBlockBlobClient(name);
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
  // Load the secret before reporting ready. Retries keep a slow Key Vault from
  // leaving the pod permanently unready; a hard failure still degrades rather
  // than crashes, so the pod stays alive for debugging.
  loadSecretWithRetry(cfg, logger, state).catch((e) => logger.error({ err: e.message }, "loadSecret rejected"));
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

module.exports = { buildApp, loadSecret, loadSecretWithRetry, start, createState, getConfig };

if (require.main === module) {
  start();
}
