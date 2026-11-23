import test from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./server.mjs";

const manualReview = { status: "manual_review", topic: null, draft: null };

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function post(port, body, { raw = false } = {}) {
  const response = await fetch(`http://127.0.0.1:${port}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: raw ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

test("сбой модели отдаёт ручной разбор без черновика", async () => {
  const server = createApp();
  const port = await listen(server);
  try {
    const ready = await post(port, { text: "Когда будет доставка?" });
    assert.equal(ready.status, 200);
    assert.equal(ready.body.status, "ready");
    assert.equal(ready.body.topic, "delivery");
    assert.equal(typeof ready.body.draft, "string");
    assert.notEqual(ready.body.draft.trim(), "");

    const blank = await post(port, { text: "   " });
    assert.equal(blank.status, 400);
    assert.deepEqual(blank.body, { status: "invalid_input" });

    const broken = await post(port, "{", { raw: true });
    assert.equal(broken.status, 400);
    assert.deepEqual(broken.body, { status: "invalid_input" });

    const failures = ["заказ [timeout]", "заказ [error]", "заказ [bad-json]", "заказ [bad-topic]", "заказ [empty-draft]"];
    for (const text of failures) {
      const started = Date.now();
      const failed = await post(port, { text });
      assert.equal(failed.status, 200, text);
      assert.deepEqual(failed.body, manualReview, text);
      assert.ok(Date.now() - started < 1000, text);
    }
  } finally {
    await close(server);
  }
});
