// Azure Blob Storage layout for drops.
//
//   <container>/<id>/file       the bytes, exactly as uploaded
//   <container>/<id>/meta.json  name, size, content type, sha256, pod, timestamps
//   <container>/<id>/seal.json  algorithm, iterations, digest, seal
//
// The blob name is always "file"; the original filename lives in metadata. That
// keeps user input out of blob paths entirely, so no amount of "../" can escape
// the container.

const { BlobServiceClient } = require("@azure/storage-blob");

const META = "meta.json";
const SEAL = "seal.json";
const DATA = "file";

function createDropStore({ cfg, credential }) {
  if (!cfg.storageAccountUrl) return null;

  const service = new BlobServiceClient(cfg.storageAccountUrl, credential);
  const container = service.getContainerClient(cfg.dropContainer);
  let ensured = null;

  function blob(name) {
    return container.getBlockBlobClient(name);
  }

  function ensure() {
    if (!ensured) {
      // Never cache a rejected promise: one transient failure at startup would
      // otherwise disable the store for the life of the process.
      ensured = container.createIfNotExists().catch((err) => {
        ensured = null;
        throw err;
      });
    }
    return ensured;
  }

  async function readJson(name) {
    try {
      const response = await blob(name).download();
      const chunks = [];
      for await (const chunk of response.readableStreamBody) chunks.push(chunk);
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (err) {
      if (err.statusCode === 404 || err.code === "BlobNotFound") return null;
      throw err;
    }
  }

  async function writeJson(name, value) {
    await ensure();
    await blob(name).uploadData(Buffer.from(JSON.stringify(value)), {
      blobHTTPHeaders: { blobContentType: "application/json" },
    });
  }

  return {
    kind: "azure",
    container: cfg.dropContainer,

    async putFile(id, buffer, contentType) {
      await ensure();
      await blob(`${id}/${DATA}`).uploadData(buffer, {
        blobHTTPHeaders: { blobContentType: contentType || "application/octet-stream" },
      });
    },

    async getFile(id) {
      try {
        const response = await blob(`${id}/${DATA}`).download();
        const chunks = [];
        for await (const chunk of response.readableStreamBody) chunks.push(chunk);
        return Buffer.concat(chunks);
      } catch (err) {
        if (err.statusCode === 404 || err.code === "BlobNotFound") return null;
        throw err;
      }
    },

    putMeta(id, meta) {
      return writeJson(`${id}/${META}`, meta);
    },

    getMeta(id) {
      return readJson(`${id}/${META}`);
    },

    putSeal(id, seal) {
      return writeJson(`${id}/${SEAL}`, seal);
    },

    getSeal(id) {
      return readJson(`${id}/${SEAL}`);
    },

    // One container listing, then one small read per drop. Fine at lab scale;
    // a real catalogue would keep an index instead of listing on every request.
    async list(limit = 50) {
      await ensure();
      const ids = [];
      for await (const item of container.listBlobsFlat()) {
        if (item.name.endsWith(`/${META}`)) ids.push(item.name.slice(0, -`/${META}`.length));
      }
      const metas = await Promise.all(ids.map((id) => readJson(`${id}/${META}`)));
      return metas
        .filter(Boolean)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit);
    },

    async remove(id) {
      await Promise.all([
        blob(`${id}/${DATA}`).deleteIfExists(),
        blob(`${id}/${META}`).deleteIfExists(),
        blob(`${id}/${SEAL}`).deleteIfExists(),
      ]);
    },
  };
}

module.exports = { createDropStore };
