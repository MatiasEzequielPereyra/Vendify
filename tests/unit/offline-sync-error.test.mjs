import test from "node:test";
import assert from "node:assert/strict";

import { classifyOfflineSyncError } from "../../dist-ts/offline/sync-error.js";

test("network failures are retryable", () => {
  assert.equal(classifyOfflineSyncError(new TypeError("Failed to fetch")).kind, "retryable");
});

test("HTTP 503 is retryable", () => {
  const result = classifyOfflineSyncError({ message: "Service unavailable", status: 503 });
  assert.equal(result.kind, "retryable");
  assert.equal(result.status, 503);
});

test("HTTP 429 is retryable", () => {
  assert.equal(
    classifyOfflineSyncError({ message: "Too many requests", statusCode: 429 }).kind,
    "retryable"
  );
});

test("serialization failures are retryable", () => {
  const result = classifyOfflineSyncError({ message: "serialization failure", code: "40001" });
  assert.equal(result.kind, "retryable");
  assert.equal(result.code, "40001");
});

test("unknown business/database errors require review", () => {
  assert.equal(
    classifyOfflineSyncError({ message: "stock insuficiente", code: "P0001" }).kind,
    "review"
  );
});
