// Blob Storage operations used by the "Blob" chapter.
//
// These are not part of the product flow; they exist so the storage account can
// be demonstrated live: how many objects and versions it holds, how a bulk write
// looks from the inside, and that a deleted blob is recoverable because soft
// delete is on.

const { BlobServiceClient } = require("@azure/storage-blob");

function createBlobAdmin({ cfg, credential }) {
  if (!cfg.storageAccountUrl) return null;

  const container = new BlobServiceClient(cfg.storageAccountUrl, credential).getContainerClient(cfg.dropContainer);

  return {
    container: cfg.dropContainer,

    async stats() {
      await container.createIfNotExists();

      const current = [];
      for await (const item of container.listBlobsFlat()) current.push(item);

      let all = 0;
      for await (const _item of container.listBlobsFlat({ includeVersions: true })) all += 1;

      let deleted = 0;
      for await (const item of container.listBlobsFlat({ includeDeleted: true })) {
        if (item.deleted) deleted += 1;
      }

      const tiers = {};
      let bytes = 0;
      for (const item of current) {
        bytes += item.contentLength || 0;
        const tier = item.tier || "Hot";
        tiers[tier] = (tiers[tier] || 0) + 1;
      }

      return {
        container: cfg.dropContainer,
        objects: current.length,
        bytes,
        versions: all - current.length,
        deleted,
        tiers,
      };
    },

    async bulk(count) {
      await container.createIfNotExists();
      const prefix = `bulk/${Date.now()}`;
      const body = Buffer.from("transaction demo\n");
      const writes = [];
      for (let i = 0; i < count; i += 1) {
        writes.push(container.getBlockBlobClient(`${prefix}-${String(i).padStart(2, "0")}.txt`).uploadData(body));
      }
      await Promise.all(writes);
      return { count, prefix, bytes: body.length * count };
    },

    async softDeleteDemo() {
      await container.createIfNotExists();
      const name = `demo/soft-delete-${Date.now()}.txt`;
      const blob = container.getBlockBlobClient(name);

      await blob.uploadData(Buffer.from("soft delete demo\n"));
      await blob.delete();

      let listedAsDeleted = false;
      for await (const item of container.listBlobsFlat({ includeDeleted: true })) {
        if (item.name === name && item.deleted) listedAsDeleted = true;
      }

      await blob.undelete();
      const restored = await blob.exists();

      return {
        name,
        steps: [
          { step: "upload", ok: true },
          { step: "delete", ok: true },
          { step: "listed_as_deleted", ok: listedAsDeleted },
          { step: "undelete", ok: true },
          { step: "exists_again", ok: restored },
        ],
      };
    },
  };
}

module.exports = { createBlobAdmin };
