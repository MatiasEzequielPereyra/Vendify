import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  classifyGate,
  createReadinessValidationContext,
  getPilotBlockers,
  validateReadinessContract
} from "../../scripts/verify-commercial-readiness.mjs";

const root = resolve(import.meta.dirname, "../..");
const contractPath = resolve(root, "contracts/commercial-readiness.json");
const verifierPath = resolve(root, "scripts/verify-commercial-readiness.mjs");
const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const context = createReadinessValidationContext(root);

const validate = (candidate) => validateReadinessContract(candidate, context);
const cloneContract = () => structuredClone(contract);

test("commercial readiness schema accepts the repository contract", () => {
  assert.deepEqual(validate(contract), []);
});

test("commercial readiness fails closed when evidence is missing", () => {
  const candidate = cloneContract();
  candidate.gates[0].evidence = ["does/not/exist.txt"];

  assert.ok(
    validate(candidate).some((error) => error.includes("references missing evidence")),
    "missing evidence must invalidate the contract"
  );
});

test("manual pass requires explicit observation metadata", () => {
  const candidate = cloneContract();
  const gate = candidate.gates.find((item) => item.id === "two-register-realtime-stock");
  delete gate.observedAt;

  assert.ok(
    validate(candidate).some((error) =>
      error.includes("observed gate two-register-realtime-stock needs an observation date")
    )
  );
});

test("local observations remain historical verified observations when metadata is valid", () => {
  const gate = contract.gates.find((item) => item.id === "database-clean-bootstrap");

  assert.equal(gate.status, "pass_local");
  assert.equal(gate.verificationKind, "local_observation");
  assert.match(gate.observedAt, /^\d{4}-\d{2}-\d{2}$/u);
  assert.ok(gate.observationScope);
  assert.equal(classifyGate(gate), "verified_observation");
  assert.deepEqual(validate(contract), []);
});

test("dynamic execution cannot be declared passed from evidence files alone", () => {
  const candidate = cloneContract();
  const gate = candidate.gates.find((item) => item.id === "automated-ci");
  gate.status = "pass_dynamic";
  gate.verificationKind = "dynamic_observation";
  gate.observedAt = "2026-10-01";
  gate.observationScope = "current-head";
  delete gate.dynamicSource;
  delete gate.observedAtSha;

  const errors = validate(candidate);
  assert.ok(errors.some((error) => error.includes("needs a dynamic source")));
  assert.ok(errors.some((error) => error.includes("needs an observed SHA")));
});

test("configured controls cannot masquerade as current observations", () => {
  const candidate = cloneContract();
  const gate = candidate.gates.find((item) => item.id === "automated-ci");
  gate.observedAt = "2026-10-01";
  gate.observationScope = "current-head";

  assert.ok(
    validate(candidate).some((error) =>
      error.includes("cannot contain observation metadata or imply a current result")
    )
  );
});

test("pwa device matrix remains a pilot blocker", () => {
  const blockerIds = getPilotBlockers(contract).map((gate) => gate.id);

  assert.ok(blockerIds.includes("pwa-device-matrix"));
  assert.ok(!blockerIds.includes("self-hosted-critical-runtime"));
});

test("unknown status and verification kind fail closed", () => {
  const unknownStatus = cloneContract();
  unknownStatus.gates[0].status = "definitely_passed";

  assert.ok(validate(unknownStatus).some((error) => error.includes("unknown status")));

  const unknownKind = cloneContract();
  unknownKind.gates[0].verificationKind = "magic";

  assert.ok(
    validate(unknownKind).some((error) => error.includes("unknown verification kind"))
  );
});

test("migration inventory must remain exactly aligned with executable migrations", () => {
  const candidate = cloneContract();
  candidate.migrationChain.files = candidate.migrationChain.files.slice(0, -1);

  assert.ok(
    validate(candidate).some((error) =>
      error.includes("migration inventory is stale or out of order")
    )
  );
});

test("commercial readiness verification stays deterministic and offline", () => {
  const verifier = readFileSync(verifierPath, "utf8");

  assert.doesNotMatch(verifier, /\bfetch\s*\(/u);
  assert.doesNotMatch(verifier, /https?:\/\//u);
  assert.doesNotMatch(verifier, /node:child_process/u);
});
