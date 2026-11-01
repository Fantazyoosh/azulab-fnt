const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { buildApp } = require("../src/server.js");

function request(app, method, path, body) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      const data = body ? JSON.stringify(body) : undefined;
      const opts = {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {},
      };
      const req = http.request(opts, (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          server.close();
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch (_e) { parsed = raw; }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers });
        });
      });
      req.on("error", (e) => { server.close(); reject(e); });
      if (data) req.write(data);
      req.end();
    });
  });
}

//test("health returns ok", async () => {
//  const app = buildApp();
//  const r = await request(app, "GET", "/health");
//  assert.equal(r.status, 200);
//  assert.equal(r.body.status, "ok");
//  assert.equal(r.body.service, "azulab");
//  assert.ok(r.headers["x-request-id"], "correlation id is set");
//});

test("ready reflects missing storage/keyvault gracefully", async () => {
  const app = buildApp();
  const r = await request(app, "GET", "/ready");
  assert.ok([200, 503].includes(r.status));
  assert.ok(r.body.checks, "checks present");
});

test("message endpoint returns fallback message", async () => {
  const app = buildApp();
  const r = await request(app, "GET", "/api/message");
  assert.equal(r.status, 200);
  assert.ok(typeof r.body.message === "string" && r.body.message.length > 0);
});

test("metrics endpoint returns snapshot", async () => {
  const app = buildApp();
  await request(app, "GET", "/health");
  const r = await request(app, "GET", "/metrics");
  assert.equal(r.status, 200);
  assert.ok(r.body.requests >= 1);
});

test("blob upload rejects invalid names and missing storage", async () => {
  const app = buildApp();
  const r1 = await request(app, "POST", "/api/blobs", { name: "../evil", content: "x" });
  assert.equal(r1.status, 400);
  const r2 = await request(app, "POST", "/api/blobs", { name: "ok.txt", content: "x" });
  // No storage configured in tests -> 503, never 500 with a leak.
  assert.equal(r2.status, 503);
});

test("blob upload enforces size limit", async () => {
  const cfg = { ...require("../src/config").getConfig(), storageAccountUrl: "https://x.blob.core.windows.net", maxUploadBytes: 4 };
  const app = buildApp(cfg);
  const r = await request(app, "POST", "/api/blobs", { name: "big.txt", content: "too large" });
  assert.equal(r.status, 413);
});
