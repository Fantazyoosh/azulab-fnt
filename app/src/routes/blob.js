// Blob chapter endpoints.
//
// They expose only what the presentation needs: an honest snapshot of the
// account, a way to create write traffic on demand, and a soft-delete round
// trip that proves the data is recoverable. Nothing here is part of the drop
// product flow.

const express = require("express");

const BULK_DEFAULT = 20;
const BULK_MAX = 200;

function createBlobRouter({ logger, blobAdmin }) {
  const router = express.Router();

  function requireAdmin(res) {
    if (blobAdmin) return true;
    res.status(503).json({ error: "storage_not_configured" });
    return false;
  }

  router.get("/stats", async (_req, res, next) => {
    if (!requireAdmin(res)) return undefined;
    try {
      return res.json(await blobAdmin.stats());
    } catch (err) {
      return next(err);
    }
  });

  router.post("/bulk", async (req, res, next) => {
    if (!requireAdmin(res)) return undefined;
    const requested = Number(req.body && req.body.count);
    const count = Number.isInteger(requested) ? Math.min(Math.max(requested, 1), BULK_MAX) : BULK_DEFAULT;
    try {
      const result = await blobAdmin.bulk(count);
      logger.info({ count, prefix: result.prefix }, "bulk blob write");
      return res.status(201).json(result);
    } catch (err) {
      return next(err);
    }
  });

  router.post("/soft-delete-demo", async (_req, res, next) => {
    if (!requireAdmin(res)) return undefined;
    try {
      const result = await blobAdmin.softDeleteDemo();
      logger.info({ name: result.name }, "soft delete demo completed");
      return res.json(result);
    } catch (err) {
      return next(err);
    }
  });

  return router;
}

module.exports = { BULK_DEFAULT, BULK_MAX, createBlobRouter };
