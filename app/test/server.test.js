const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");

const { buildApp } = require("../src/server.js");

function request(app, path) {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      http.get(`http://127.0.0.1:${port}${path}`, (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          server.close();
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        });
      }).on("error", (e) => {
        server.close();
        reject(e);
      });
    });
  });
}

test("health returns ok", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/health");
  assert.equal(status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.service, "azureflow");
});

test("message endpoint returns fallback message", async () => {
  const app = buildApp();
  const { status, body } = await request(app, "/api/message");
  assert.equal(status, 200);
  assert.ok(typeof body.message === "string");
  assert.ok(body.message.length > 0);
});
