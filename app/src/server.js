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
const { BlobServiceClient } = require("@azure/storage-blob");
const crypto = require("node:crypto");
const express = require("express");
const pkg = require("../package.json");

const { getConfig } = require("./config");
const { createLogger } = require("./logger");
const { metrics } = require("./metrics");
const { createSigningKeyStore } = require("./secrets");
const { createDropStore } = require("./storage");
const { createMemoryDropStore } = require("./memory-store");
const { createBlobAdmin } = require("./blob-admin");
const { createBlobRouter } = require("./routes/blob");
const { createDropsRouter, createShareRouter } = require("./routes/drops");
const { createOpsRouter } = require("./routes/ops");

function createCredential(cfg = {}) {
  return cfg.azureClientId
    ? new DefaultAzureCredential({ managedIdentityClientId: cfg.azureClientId })
    : new DefaultAzureCredential();
}

function createState(cfg) {
  return {
    cfg,
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

function getBlobClient(cfg) {
  const service = new BlobServiceClient(cfg.storageAccountUrl, createCredential(cfg));
  const container = service.getContainerClient(cfg.containerName);
  return { service, container };
}

function buildApp(cfg = getConfig(), logger = createLogger(cfg.logLevel), state = null, deps = {}) {
  if (!state) state = createState(cfg);
  const app = express();

  const credential = deps.credential !== undefined ? deps.credential : createCredential(cfg);
  const keys = deps.keys || createSigningKeyStore({ cfg, credential, logger });
  const store = deps.store !== undefined
    ? deps.store
    : cfg.dropStore === "memory"
      ? createMemoryDropStore()
      : createDropStore({ cfg, credential });
  // The blob chapter talks to the real storage account; in memory mode there is
  // nothing to inspect, so the route answers 503 instead of inventing numbers.
  const blobAdmin = deps.blobAdmin !== undefined
    ? deps.blobAdmin
    : cfg.dropStore === "memory"
      ? null
      : createBlobAdmin({ cfg, credential });

  app.locals.state = state;
  app.locals.cfg = cfg;
  app.locals.logger = logger;
  app.locals.keys = keys;
  app.locals.store = store;
  app.locals.blobAdmin = blobAdmin;

  // Behind the Container Apps proxy and the AKS load balancer the protocol is
  // decided by the forwarded header, not by the socket. Share links must come
  // back with the same scheme the user is browsing.
  app.set("trust proxy", true);

  app.use((req, res, next) => {
    const id = req.get("x-request-id") || crypto.randomUUID();
    req.requestId = id;
    res.setHeader("x-request-id", id);
    // Lets you prove load balancing with one curl loop: every response tells
    // you which replica served it.
    res.setHeader("x-pod-name", process.env.HOSTNAME || "local");
    next();
  });

  // Structured request log + metrics. Static assets stay out of the counters.
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

  // The upload route parses raw bytes itself, so the drop routers must be
  // mounted before the global JSON parser. A 5 MB binary is not JSON.
  app.use("/api/drops", createDropsRouter({ cfg, logger, store, keys }));
  app.use("/s", createShareRouter({ store, keys, logger }));

  app.use(express.json({ limit: cfg.maxUploadBytes }));
  app.use("/api/blob", createBlobRouter({ logger, blobAdmin }));

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

    // A share link cannot be signed without the key, so a missing key is a real
    // readiness failure. The probe never blocks on Key Vault: it reports the
    // cached state and kicks a refresh in the background.
    const signing = keys.snapshot();
    if (!signing && cfg.keyVaultUrl) keys.get(null).catch(() => {});

    const checks = {
      keyVault: !cfg.keyVaultUrl ? "not_configured" : signing ? "ok" : "pending",
      signingKey: signing ? signing.version : null,
      storage: state.storageOk,
      storageConsecutiveFailures: state.storageFailures,
    };
    // One transient failure is not enough to remove a pod from rotation — that
    // would make the Service flap. Two in a row is a real dependency outage.
    const storageOk = checks.storage !== "error" || state.storageFailures < 2;
    const ok = checks.keyVault !== "pending" && storageOk;
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

  app.get("/metrics", (_req, res) => {
    res.json(metrics.snapshot());
  });

  app.use(createOpsRouter({ cfg, logger, keys, store, credential }));

  // Central error handler. Never leak stack traces to clients.
  app.use((err, req, res, _next) => {
    if (err && err.type === "entity.too.large") {
      return res.status(413).json({
        error: "too_large",
        message: `max ${cfg.maxUploadBytes} bytes`,
        requestId: req.requestId,
      });
    }
    logger.error({ err: err && err.message, stack: err && err.stack, requestId: req.requestId }, "unhandled error");
    const status = err && err.status ? err.status : 500;
    res.status(status).json({ error: "internal_error", message: "something went wrong", requestId: req.requestId });
  });

  return app;
}

function start(cfg = getConfig(), logger = createLogger(cfg.logLevel)) {
  const state = createState(cfg);
  const app = buildApp(cfg, logger, state);
  // Warm the signing key so the first share does not pay the Key Vault round
  // trip. Failure is not fatal: /ready reports "pending" and retries.
  app.locals.keys.get(null).catch((e) => logger.warn({ err: e.message }, "signing key not loaded yet"));

  const server = app.listen(cfg.port, () => {
    logger.info({ port: cfg.port }, "azulab listening");
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    state.shuttingDown = true;
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

  return server;
}

module.exports = { buildApp, start, createState, getConfig };

if (require.main === module) {
  start();
}
