// Drop API: upload, list, seal, verify, share.
//
// The upload route owns its body parser (raw bytes), which is why the drops
// router is mounted before the global JSON parser in server.js. Everything else
// in this router speaks JSON.

const crypto = require("node:crypto");
const express = require("express");

const { sealBuffer, sha256, sharePath, signLink, verifyLink, verifySeal } = require("../seal");

const ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;
const INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf"]);

function newId() {
  return crypto.randomBytes(9).toString("base64url");
}

// The name is metadata only: the blob is always called "file". Even so, strip
// control characters and path separators so the name is safe to render and to
// put in a Content-Disposition header.
function safeName(raw) {
  if (!raw) return "file";
  let name = String(raw);
  try {
    name = decodeURIComponent(name);
  } catch (_err) {
    // Keep the raw value; a malformed escape is not worth a 400.
  }
  name = name
    .replace(/[\\/]/g, "_")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 120);
  return name && name !== "." && name !== ".." ? name : "file";
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function wrap(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function idFrom(req, res) {
  const { id } = req.params;
  if (!ID_PATTERN.test(id)) {
    res.status(400).json({ error: "invalid_id" });
    return null;
  }
  return id;
}

function sendFile(res, meta, buffer, { inline }) {
  const type = meta.contentType || "application/octet-stream";
  const disposition = inline && INLINE_TYPES.has(type) ? "inline" : "attachment";
  res.set("content-type", type);
  res.set("content-disposition", `${disposition}; filename*=UTF-8''${encodeURIComponent(meta.name)}`);
  res.set("x-content-type-options", "nosniff");
  res.set("cache-control", "private, max-age=0, must-revalidate");
  res.send(buffer);
}

function createDropsRouter({ cfg, logger, store, keys }) {
  const router = express.Router();

  function requireStore(res) {
    if (store) return true;
    res.status(503).json({ error: "storage_not_configured" });
    return false;
  }

  // Raw upload. The file name travels in a header so the body stays untouched.
  router.post(
    "/",
    express.raw({ type: () => true, limit: cfg.maxUploadBytes }),
    wrap(async (req, res) => {
      if (!requireStore(res)) return;

      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (body.length === 0) return res.status(400).json({ error: "empty_body" });

      const id = newId();
      const contentType = (req.get("content-type") || "application/octet-stream").split(";")[0].trim();
      const meta = {
        id,
        name: safeName(req.get("x-filename")),
        size: body.length,
        contentType,
        sha256: sha256(body),
        createdAt: new Date().toISOString(),
        pod: process.env.HOSTNAME || "local",
      };

      await store.putFile(id, body, contentType);
      await store.putMeta(id, meta);
      logger.info({ id, size: meta.size, name: meta.name }, "drop uploaded");
      res.status(201).json(meta);
    })
  );

  // Bodies for the remaining routes are small JSON documents.
  router.use(express.json({ limit: "64kb" }));

  router.get(
    "/",
    wrap(async (_req, res) => {
      if (!requireStore(res)) return;
      const items = await store.list(50);
      res.json({ container: store.container, items });
    })
  );

  router.get(
    "/:id",
    wrap(async (req, res) => {
      if (!requireStore(res)) return;
      const id = idFrom(req, res);
      if (!id) return;
      const meta = await store.getMeta(id);
      if (!meta) return res.status(404).json({ error: "not_found" });
      res.json(meta);
    })
  );

  router.get(
    "/:id/download",
    wrap(async (req, res) => {
      if (!requireStore(res)) return;
      const id = idFrom(req, res);
      if (!id) return;
      const meta = await store.getMeta(id);
      const buffer = meta ? await store.getFile(id) : null;
      if (!meta || !buffer) return res.status(404).json({ error: "not_found" });
      sendFile(res, meta, buffer, { inline: true });
    })
  );

  router.delete(
    "/:id",
    wrap(async (req, res) => {
      if (!requireStore(res)) return;
      const id = idFrom(req, res);
      if (!id) return;
      await store.remove(id);
      logger.info({ id }, "drop deleted");
      res.status(204).end();
    })
  );

  router.post(
    "/:id/seal",
    wrap(async (req, res) => {
      if (!requireStore(res)) return;
      const id = idFrom(req, res);
      if (!id) return;

      const meta = await store.getMeta(id);
      const buffer = meta ? await store.getFile(id) : null;
      if (!meta || !buffer) return res.status(404).json({ error: "not_found" });

      const seal = await sealBuffer(buffer, { id, iterations: cfg.sealIterations });
      const record = {
        ...seal,
        id,
        sealedAt: new Date().toISOString(),
        pod: process.env.HOSTNAME || "local",
      };
      await store.putSeal(id, record);

      const updated = {
        ...meta,
        seal: {
          algorithm: record.algorithm,
          iterations: record.iterations,
          digest: record.digest,
          seal: record.seal,
          sealedAt: record.sealedAt,
          ms: record.ms,
        },
      };
      await store.putMeta(id, updated);

      logger.info({ id, iterations: record.iterations, ms: record.ms }, "drop sealed");
      res.json({ ok: true, ...record });
    })
  );

  router.post(
    "/:id/verify",
    wrap(async (req, res) => {
      if (!requireStore(res)) return;
      const id = idFrom(req, res);
      if (!id) return;

      const record = await store.getSeal(id);
      const buffer = record ? await store.getFile(id) : null;
      if (!record || !buffer) return res.status(404).json({ error: "not_sealed" });

      const result = await verifySeal(buffer, record);
      res.json({ ...result, sealedAt: record.sealedAt, iterations: record.iterations });
    })
  );

  router.post(
    "/:id/share",
    wrap(async (req, res) => {
      if (!requireStore(res)) return;
      const id = idFrom(req, res);
      if (!id) return;

      const meta = await store.getMeta(id);
      if (!meta) return res.status(404).json({ error: "not_found" });

      let key;
      try {
        key = await keys.get(null);
      } catch (err) {
        logger.error({ err: err.message }, "cannot sign share link");
        return res.status(503).json({ error: "signing_key_unavailable" });
      }

      const ttlSeconds = clamp(Number(req.body && req.body.ttlSeconds) || cfg.shareTtlSeconds, 60, 86400);
      const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
      const sig = signLink({ id, exp, keyVersion: key.version, key: key.value });
      const path = sharePath({ id, exp, keyVersion: key.version, sig });

      res.json({
        path,
        url: `${req.protocol}://${req.get("host")}${path}`,
        expiresAt: new Date(exp * 1000).toISOString(),
        ttlSeconds,
        keyVersion: key.version,
        fingerprint: key.fingerprint,
      });
    })
  );

  return router;
}

// Public, unauthenticated download. The signature is the credential: no session,
// no cookie, no shared access key.
function createShareRouter({ store, keys, logger }) {
  const router = express.Router();
  const requireStore = (res) => {
    if (store) return true;
    res.status(503).json({ error: "storage_not_configured" });
    return false;
  };

  router.get(
    "/:id",
    wrap(async (req, res) => {
      if (!requireStore(res)) return;
      const id = idFrom(req, res);
      if (!id) return;

      const exp = Number(req.query.exp);
      const keyVersion = req.query.v ? String(req.query.v) : "";
      const sig = req.query.sig ? String(req.query.sig) : "";
      if (!Number.isInteger(exp)) return res.status(400).json({ error: "malformed_link" });
      if (exp * 1000 <= Date.now()) {
        return res.status(410).json({ error: "link_expired", expiresAt: new Date(exp * 1000).toISOString() });
      }

      let key;
      try {
        key = await keys.get(keyVersion);
      } catch (err) {
        logger.warn({ err: err.message, keyVersion }, "share key unavailable");
        return res.status(403).json({ error: "key_unavailable" });
      }

      const check = verifyLink({ id, exp, keyVersion, sig, key: key.value });
      if (!check.ok) {
        const status = check.reason === "expired" ? 410 : 403;
        return res.status(status).json({ error: check.reason });
      }

      const meta = await store.getMeta(id);
      const buffer = meta ? await store.getFile(id) : null;
      if (!meta || !buffer) return res.status(404).json({ error: "not_found" });

      logger.info({ id, keyVersion }, "share link used");
      sendFile(res, meta, buffer, { inline: true });
    })
  );

  return router;
}

module.exports = { ID_PATTERN, createDropsRouter, createShareRouter, safeName };
