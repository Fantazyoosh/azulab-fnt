// In-memory drop store, used only when DROP_STORE=memory.
//
// It exists so the UI can be developed and tested without an Azure subscription
// (and without a data-plane role). It is never the default: production runs
// against Blob Storage, and /api/config reports which store is active so a
// memory-backed instance cannot be mistaken for the real thing.

function createMemoryDropStore() {
  const files = new Map();
  const metas = new Map();
  const seals = new Map();

  return {
    kind: "memory",
    container: "drops",

    async putFile(id, buffer) {
      files.set(id, Buffer.from(buffer));
    },
    async getFile(id) {
      const value = files.get(id);
      return value ? Buffer.from(value) : null;
    },
    async putMeta(id, meta) {
      metas.set(id, { ...meta });
    },
    async getMeta(id) {
      return metas.get(id) || null;
    },
    async putSeal(id, seal) {
      seals.set(id, { ...seal });
    },
    async getSeal(id) {
      return seals.get(id) || null;
    },
    async list(limit = 50) {
      return [...metas.values()]
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
        .slice(0, limit);
    },
    async remove(id) {
      files.delete(id);
      metas.delete(id);
      seals.delete(id);
    },
  };
}

module.exports = { createMemoryDropStore };
