const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { getConfig } = require("../src/config");
const { createLogger } = require("../src/logger");
const { buildApp } = require("../src/server");
const { createMemoryDropStore } = require("../src/memory-store");
const { sharePath, signLink } = require("../src/seal");

const KEY = "test-signing-key";
const VERSION = "test-version-1";

function memoryKeys() {
  const entry = {
    value: KEY,
    version: VERSION,
    source: "test",
    loadedAt: new Date().toISOString(),
    fingerprint: "test-fingerprint",
  };
  return {
    async get(version) {
      if (version && version !== VERSION) {
        const err = new Error("secret is disabled");
        err.statusCode = 403;
        throw err;
      }
      return entry;
    },
    snapshot() {
      return { version: entry.version, source: entry.source, loadedAt: entry.loadedAt, fingerprint: entry.fingerprint };
    },
  };
}

function request(app, { method = "GET", path, body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const payload = body === undefined ? null : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
      const opts = {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: { ...headers, ...(payload ? { "content-length": payload.length } : {}) },
      };
      const req = http.request(opts, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          server.close();
          const raw = Buffer.concat(chunks);
          const type = res.headers["content-type"] || "";
          let parsed = raw;
          if (type.includes("application/json")) {
            try {
              parsed = JSON.parse(raw.toString("utf8"));
            } catch (_err) {
              parsed = raw.toString("utf8");
            }
          }
          resolve({ status: res.statusCode, body: parsed, raw, headers: res.headers });
        });
      });
      req.on("error", (err) => {
        server.close();
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    });
  });
}

function makeApp() {
  const cfg = {
    ...getConfig(),
    keyVaultUrl: "",
    storageAccountUrl: "",
    maxUploadBytes: 1024,
    sealIterations: 10000,
    shareTtlSeconds: 900,
    enableDebugEndpoints: true,
  };
  const store = createMemoryDropStore();
  const app = buildApp(cfg, createLogger("error"), null, { store, keys: memoryKeys(), credential: null });
  return { app, store };
}

function upload(app, { name = "hello.txt", type = "text/plain", content = "hello" } = {}) {
  return request(app, {
    method: "POST",
    path: "/api/drops",
    body: Buffer.from(content),
    headers: { "content-type": type, "x-filename": name },
  });
}

test("upload stores the bytes and returns metadata", async () => {
  const { app } = makeApp();
  const r = await upload(app);
  assert.equal(r.status, 201);
  assert.match(r.body.id, /^[A-Za-z0-9_-]{12}$/);
  assert.equal(r.body.name, "hello.txt");
  assert.equal(r.body.size, 5);
  assert.equal(r.body.sha256, "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
});

test("upload rejects an empty body", async () => {
  const { app } = makeApp();
  const r = await request(app, { method: "POST", path: "/api/drops" });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "empty_body");
});

test("upload rejects a body over the configured limit", async () => {
  const { app } = makeApp();
  const r = await upload(app, { content: "x".repeat(2000) });
  assert.equal(r.status, 413);
  assert.equal(r.body.error, "too_large");
});

test("list returns every uploaded drop", async () => {
  const { app } = makeApp();
  await upload(app, { name: "a.txt", content: "a" });
  await upload(app, { name: "b.txt", content: "b" });
  const r = await request(app, { path: "/api/drops" });
  assert.equal(r.status, 200);
  assert.equal(r.body.container, "drops");
  assert.equal(r.body.items.length, 2);
});

test("seal then verify succeeds", async () => {
  const { app } = makeApp();
  const drop = (await upload(app)).body;

  const sealed = await request(app, { method: "POST", path: `/api/drops/${drop.id}/seal` });
  assert.equal(sealed.status, 200);
  assert.equal(sealed.body.iterations, 10000);
  assert.equal(sealed.body.algorithm, "PBKDF2-SHA256");
  assert.ok(sealed.body.seal);

  const verified = await request(app, { method: "POST", path: `/api/drops/${drop.id}/verify` });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.ok, true);
});

test("verify fails when the stored bytes change", async () => {
  const { app, store } = makeApp();
  const drop = (await upload(app)).body;
  await request(app, { method: "POST", path: `/api/drops/${drop.id}/seal` });

  await store.putFile(drop.id, Buffer.from("tampered"));
  const verified = await request(app, { method: "POST", path: `/api/drops/${drop.id}/verify` });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.ok, false);
});

test("a share link downloads the file without any session", async () => {
  const { app } = makeApp();
  const drop = (await upload(app)).body;
  const share = await request(app, {
    method: "POST",
    path: `/api/drops/${drop.id}/share`,
    body: JSON.stringify({ ttlSeconds: 120 }),
    headers: { "content-type": "application/json" },
  });
  assert.equal(share.status, 200);
  assert.equal(share.body.keyVersion, VERSION);
  assert.ok(share.body.path.startsWith(`/s/${drop.id}?`));

  const download = await request(app, { path: share.body.path });
  assert.equal(download.status, 200);
  assert.equal(download.raw.toString(), "hello");
  assert.equal(download.headers["x-content-type-options"], "nosniff");
});

test("a tampered signature is rejected", async () => {
  const { app } = makeApp();
  const drop = (await upload(app)).body;
  const share = await request(app, { method: "POST", path: `/api/drops/${drop.id}/share` });
  const tampered = share.body.path.replace(/sig=[^&]+/, "sig=AAAA");
  const r = await request(app, { path: tampered });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "bad_signature");
});

test("an expired link returns 410", async () => {
  const { app } = makeApp();
  const drop = (await upload(app)).body;
  const exp = Math.floor(Date.now() / 1000) - 60;
  const sig = signLink({ id: drop.id, exp, keyVersion: VERSION, key: KEY });
  const r = await request(app, { path: sharePath({ id: drop.id, exp, keyVersion: VERSION, sig }) });
  assert.equal(r.status, 410);
  assert.equal(r.body.error, "link_expired");
});

test("a link signed with an unavailable key version is rejected", async () => {
  const { app } = makeApp();
  const drop = (await upload(app)).body;
  const share = await request(app, { method: "POST", path: `/api/drops/${drop.id}/share` });
  const r = await request(app, { path: share.body.path.replace(/v=[^&]+/, "v=missing") });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "key_unavailable");
});

test("delete removes the drop from the list", async () => {
  const { app } = makeApp();
  const drop = (await upload(app)).body;
  const deleted = await request(app, { method: "DELETE", path: `/api/drops/${drop.id}` });
  assert.equal(deleted.status, 204);
  const list = await request(app, { path: "/api/drops" });
  assert.equal(list.body.items.length, 0);
});

test("an invalid id is rejected before touching storage", async () => {
  const { app } = makeApp();
  const r = await request(app, { path: "/api/drops/short" });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "invalid_id");
});

test("the crash switch is guarded by the debug flag", async () => {
  const cfg = { ...getConfig(), keyVaultUrl: "", storageAccountUrl: "", enableDebugEndpoints: false };
  const app = buildApp(cfg, createLogger("error"), null, {
    store: createMemoryDropStore(),
    keys: memoryKeys(),
    credential: null,
  });
  const r = await request(app, { method: "POST", path: "/debug/crash" });
  assert.equal(r.status, 404);
});
