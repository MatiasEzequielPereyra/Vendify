import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { findRuntimeRpcNames } from "../../scripts/rpc-runtime-sources.mjs";

test("RPC inventory follows wrappers and ignores comments, strings and unrelated helpers", () => {
  const output = resolve("qa-output");
  mkdirSync(output, { recursive: true });
  const root = mkdtempSync(resolve(output, "rpc-inventory-"));
  mkdirSync(resolve(root, "src"));
  writeFileSync(resolve(root, "app.js"), `
    client.rpc("direct_v1");
    // client.rpc("comment_v1");
    const example = 'client.rpc("example_v1")';
  `);
  writeFileSync(resolve(root, "src/service.ts"), `
    export {};
    async function call(client, name, args) { return client.rpc(name, args); }
    call(client, "wrapped_v1", {});
    call(client, "direct_v1");
    function unrelated() {
      function call(client, name) { return name; }
      call(client, "not_rpc_v1");
    }
  `);
  writeFileSync(resolve(root, "src/other.ts"), `
    export {};
    function call(client, name) { return name; }
    call(client, "other_file_v1");
  `);
  assert.deepEqual(findRuntimeRpcNames(root), ["direct_v1", "wrapped_v1"]);
});

test("current runtime still implements the unchanged RPC contract", () => {
  const root = resolve(import.meta.dirname, "../..");
  const contract = JSON.parse(readFileSync(resolve(root, "contracts/rpc-contract.json"), "utf8"));
  assert.deepEqual(findRuntimeRpcNames(root), [...contract.rpcs].sort());
});
