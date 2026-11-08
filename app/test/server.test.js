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

test("health returns ok", async () => {
  const app = buildApp();
  const r = await request(app, "GET", "/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "ok");
  assert.equal(r.body.service, "azulab");
  assert.ok(r.headers["x-request-id"], "correlation id is set");
});

test("ready reflects missing storage/keyvault gracefully", async () => {
  const app = buildApp();
  const r = await request(app, "GET", "/ready");
  assert.ok([200, 503].includes(r.status));
  assert.ok(r.body.checks, "checks present");
});

test("metrics endpoint returns snapshot", async () => {
  const app = buildApp();
  await request(app, "GET", "/health");
  const r = await request(app, "GET", "/metrics");
  assert.equal(r.status, 200);
  assert.ok(r.body.requests >= 1);
});

test("version exposes runtime identity and every response carries x-pod-name", async () => {
  const app = buildApp();
  const r = await request(app, "GET", "/version");
  assert.equal(r.status, 200);
  assert.equal(r.body.service, "azulab");
  assert.ok(typeof r.body.pod === "string" && r.body.pod.length > 0);
  assert.ok(typeof r.body.node === "string");
  assert.ok(r.body.startedAt, "start timestamp present");
  assert.ok(r.headers["x-pod-name"], "pod name header present");
});

test("debug readiness switch is disabled by default", async () => {
  const app = buildApp();
  const r = await request(app, "POST", "/debug/fail-readiness");
  assert.equal(r.status, 404);
});

test("debug load is disabled by default", async () => {
  const app = buildApp();
  const r = await request(app, "POST", "/debug/load", { iterations: 10000, rounds: 1 });
  assert.equal(r.status, 404);
});

test("debug load burns CPU without touching the store", async () => {
  const cfg = { ...require("../src/config").getConfig(), enableDebugEndpoints: true };
  const app = buildApp(cfg);
  const r = await request(app, "POST", "/debug/load", { iterations: 10000, rounds: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.iterations, 10000);
  assert.equal(r.body.rounds, 2);
  assert.ok(r.body.ms >= 0);
  assert.ok(typeof r.body.pod === "string" && r.body.pod.length > 0);
});

test("debug load refuses unbounded work", async () => {
  const cfg = { ...require("../src/config").getConfig(), enableDebugEndpoints: true };
  const app = buildApp(cfg);
  const r = await request(app, "POST", "/debug/load", { iterations: 2000000, rounds: 32 });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "too_much_work");
});

test("forced readiness failure returns 503 while health stays 200", async () => {
  const cfg = { ...require("../src/config").getConfig(), enableDebugEndpoints: true };
  const app = buildApp(cfg);

  const on = await request(app, "POST", "/debug/fail-readiness?value=true");
  assert.equal(on.status, 200);
  assert.equal(on.body.failReadiness, true);
  assert.equal(on.body.autoResetInSeconds, 60, "override is time-bounded by default");

  const ready = await request(app, "GET", "/ready");
  assert.equal(ready.status, 503, "readiness must fail");
  assert.equal(ready.body.checks.debug, "forced_failure");

  const health = await request(app, "GET", "/health");
  assert.equal(health.status, 200, "liveness must not fail, or the pod would restart");

  await request(app, "POST", "/debug/fail-readiness?value=false");
  const recovered = await request(app, "GET", "/ready");
  assert.equal(recovered.status, 200);
});

test("expired readiness override no longer fails the probe", async () => {
  const { createState, buildApp: build } = require("../src/server.js");
  const { createLogger } = require("../src/logger");
  const cfg = { ...require("../src/config").getConfig(), enableDebugEndpoints: true };
  const state = createState(cfg);
  state.failReadiness = true;
  state.failReadinessUntil = Date.now() - 1000;
  const app = build(cfg, createLogger("error"), state);
  const r = await request(app, "GET", "/ready");
  assert.equal(r.status, 200);
});
