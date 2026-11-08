// Operator endpoints: identity introspection, live RBAC probes, chaos.
//
// The probes are the point. They call Azure with the pod's own managed identity
// and return whatever Azure says, so "allowed" and "denied" are not claims in a
// slide — they are status codes produced at request time.

const crypto = require("node:crypto");
const express = require("express");

const { SEAL_ALGORITHM, workFactor } = require("../seal");

// The load endpoint is a demo, not a benchmark service. Two caps keep a single
// request from pinning the threadpool for minutes: per-round iterations and
// total work across all rounds.
const LOAD_MAX_ITERATIONS = 2000000;
const LOAD_MAX_ROUNDS = 32;
const LOAD_MAX_WORK = 8000000;

function clampInt(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

function decodeJwtPayload(token) {
  const part = String(token).split(".")[1];
  if (!part) throw new Error("malformed token");
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
}

async function listStorageKeys({ cfg, credential }) {
  if (!cfg.storageAccountUrl || !cfg.subscriptionId || !cfg.resourceGroup) {
    const err = new Error("AZURE_SUBSCRIPTION_ID and AZURE_RESOURCE_GROUP are required");
    err.statusCode = 400;
    err.code = "probe_not_configured";
    throw err;
  }
  const account = new URL(cfg.storageAccountUrl).hostname.split(".")[0];
  const token = await credential.getToken("https://management.azure.com/.default");
  const url =
    `https://management.azure.com/subscriptions/${cfg.subscriptionId}` +
    `/resourceGroups/${cfg.resourceGroup}` +
    `/providers/Microsoft.Storage/storageAccounts/${account}/listKeys?api-version=2023-05-01`;

  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token.token}`, "content-length": "0" },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error((body.error && body.error.message) || `HTTP ${response.status}`);
    err.statusCode = response.status;
    err.code = (body.error && body.error.code) || `HTTP_${response.status}`;
    throw err;
  }
  return body;
}

function createOpsRouter({ cfg, logger, keys, store, credential }) {
  const router = express.Router();

  // The UI reports which store and which key it is actually using. Without
  // this, a memory-backed local run looks identical to the deployed system.
  router.get("/api/config", (_req, res) => {
    const key = keys.snapshot();
    res.json({
      store: store ? store.kind || "azure" : "none",
      container: store ? store.container : null,
      keyVault: key ? key.source : "none",
      keyVersion: key ? key.version : null,
      keyFingerprint: key ? key.fingerprint : null,
      keyLoadedAt: key ? key.loadedAt : null,
      sealAlgorithm: SEAL_ALGORITHM,
      debugLoadIterations: cfg.debugLoadIterations,
      debugEndpoints: cfg.enableDebugEndpoints,
      maxUploadBytes: cfg.maxUploadBytes,
      shareTtlSeconds: cfg.shareTtlSeconds,
    });
  });

  router.get("/api/self", async (_req, res) => {
    if (!credential) return res.json({ configured: false });
    try {
      const token = await credential.getToken("https://management.azure.com/.default");
      const claims = decodeJwtPayload(token.token);
      res.json({
        configured: true,
        oid: claims.oid,
        appid: claims.appid,
        tenantId: claims.tid,
        idtyp: claims.idtyp || "app",
        expiresAt: new Date(token.expiresOnTimestamp).toISOString(),
        credential: process.env.AZURE_TOKEN_CREDENTIALS || "default",
      });
    } catch (err) {
      logger.error({ err: err.message }, "identity token unavailable");
      res.status(503).json({ configured: true, error: "token_unavailable", message: err.message });
    }
  });

  router.post("/api/probe", async (req, res) => {
    const action = req.body && req.body.action;
    const startedAt = Date.now();
    const duration = () => Date.now() - startedAt;

    try {
      if (action === "read-secret") {
        const key = await keys.get(null);
        return res.json({
          action,
          ok: true,
          status: 200,
          detail: { keyVersion: key.version, source: key.source, fingerprint: key.fingerprint },
          durationMs: duration(),
        });
      }

      if (action === "read-blob") {
        if (!store) return res.status(503).json({ action, ok: false, status: 503, code: "storage_not_configured" });
        const items = await store.list(5);
        return res.json({
          action,
          ok: true,
          status: 200,
          detail: { container: store.container, objects: items.length },
          durationMs: duration(),
        });
      }

      if (action === "list-keys") {
        await listStorageKeys({ cfg, credential });
        return res.json({ action, ok: true, status: 200, durationMs: duration() });
      }

      return res.status(400).json({ action, ok: false, status: 400, code: "unknown_action" });
    } catch (err) {
      return res.status(err.statusCode || 500).json({
        action,
        ok: false,
        status: err.statusCode || 500,
        code: err.code || "probe_failed",
        message: err.message,
        durationMs: duration(),
      });
    }
  });

  // Lab-only chaos switch. Killing the process is the most honest way to show
  // that a replica can die without users noticing; the Deployment restarts it.
  router.post("/debug/crash", (req, res) => {
    if (!cfg.enableDebugEndpoints) return res.status(404).json({ error: "not_found" });
    const pod = process.env.HOSTNAME || "local";
    logger.warn({ pod }, "crash requested");
    res.json({ crashing: true, pod });
    res.on("finish", () => setTimeout(() => process.exit(1), 50));
  });

  // The only place where the app burns CPU on purpose. The product seal is
  // cheap; this endpoint exists so the Debug chapter can push real work
  // through the libuv threadpool and let the HPA react. It never touches
  // storage, so a load run cannot flood Blob with seal records.
  router.post("/debug/load", async (req, res) => {
    if (!cfg.enableDebugEndpoints) return res.status(404).json({ error: "not_found" });

    const iterations = clampInt(req.body && req.body.iterations, cfg.debugLoadIterations, 10000, LOAD_MAX_ITERATIONS);
    const rounds = clampInt(req.body && req.body.rounds, 1, 1, LOAD_MAX_ROUNDS);
    if (iterations * rounds > LOAD_MAX_WORK) {
      return res.status(400).json({ error: "too_much_work", maxWork: LOAD_MAX_WORK, iterations, rounds });
    }

    const pod = process.env.HOSTNAME || "local";
    const startedAt = Date.now();
    try {
      // Parallel work lands on separate libuv threads, which is exactly the
      // shape a normal request burst has. The event loop stays free to answer
      // health checks while the CPU is saturated.
      await Promise.all(
        Array.from({ length: rounds }, (_, index) =>
          workFactor(crypto.randomUUID(), `debug-load-${index}`, iterations)
        )
      );
      const ms = Date.now() - startedAt;
      logger.warn({ pod, iterations, rounds, ms }, "debug load");
      return res.json({ ok: true, pod, iterations, rounds, ms });
    } catch (err) {
      logger.error({ err: err.message }, "debug load failed");
      return res.status(500).json({ error: "load_failed", message: err.message });
    }
  });

  return router;
}

module.exports = { createOpsRouter, decodeJwtPayload, listStorageKeys };
