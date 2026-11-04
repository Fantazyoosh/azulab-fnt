const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { getConfig } = require("../src/config");
const { createLogger } = require("../src/logger");
const { buildApp } = require("../src/server");
const { createMemoryDropStore } = require("../src/memory-store");

function request(app, { method = "GET", path, body } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: payload
            ? { "content-type": "application/json", "content-length": payload.length }
            : {},
        },
        (res) => {
          const chunks = [];
          res.on("data", (chunk) => chunks.push(chunk));
          res.on("end", () => {
            server.close();
            const raw = Buffer.concat(chunks).toString("utf8");
            let parsed = raw;
            try {
              parsed = raw ? JSON.parse(raw) : null;
            } catch (_err) {
              // Leave the raw text for a readable assertion message.
            }
            resolve({ status: res.statusCode, body: parsed });
          });
        }
      );
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function makeApp(blobAdmin) {
  const cfg = { ...getConfig(), keyVaultUrl: "", storageAccountUrl: "", dropStore: "memory" };
  const keys = { get: async () => null, snapshot: () => null };
  return buildApp(cfg, createLogger("error"), null, {
    store: createMemoryDropStore(),
    keys,
    credential: null,
    blobAdmin,
  });
}

const fakeAdmin = (calls) => ({
  container: "drops",
  async stats() {
    return { container: "drops", objects: 3, bytes: 42, versions: 1, deleted: 0, tiers: { Hot: 3 } };
  },
  async bulk(count) {
    calls.push(count);
    return { count, prefix: "bulk/test", bytes: count * 16 };
  },
  async softDeleteDemo() {
    return { name: "demo/soft-delete-test.txt", steps: [{ step: "undelete", ok: true }] };
  },
});

test("blob routes answer 503 when storage is not configured", async () => {
  const app = makeApp(null);
  assert.equal((await request(app, { path: "/api/blob/stats" })).status, 503);
  assert.equal((await request(app, { method: "POST", path: "/api/blob/bulk" })).status, 503);
  assert.equal((await request(app, { method: "POST", path: "/api/blob/soft-delete-demo" })).status, 503);
});

test("blob stats returns the admin snapshot", async () => {
  const app = makeApp(fakeAdmin([]));
  const r = await request(app, { path: "/api/blob/stats" });
  assert.equal(r.status, 200);
  assert.equal(r.body.objects, 3);
  assert.equal(r.body.tiers.Hot, 3);
});

test("bulk defaults to 20 and clamps an oversized count", async () => {
  const calls = [];
  const app = makeApp(fakeAdmin(calls));

  const defaults = await request(app, { method: "POST", path: "/api/blob/bulk" });
  assert.equal(defaults.status, 201);
  assert.equal(defaults.body.count, 20);

  const clamped = await request(app, { method: "POST", path: "/api/blob/bulk", body: { count: 9999 } });
  assert.equal(clamped.body.count, 200);
  assert.deepEqual(calls, [20, 200]);
});

test("soft delete demo reports its steps", async () => {
  const app = makeApp(fakeAdmin([]));
  const r = await request(app, { method: "POST", path: "/api/blob/soft-delete-demo" });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.steps));
});
