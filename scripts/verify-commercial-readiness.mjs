import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const allowedStatuses = new Set([
  "control_configured",
  "pass_manual",
  "pass_local",
  "pass_dynamic",
  "pending_live",
  "pending_manual",
  "pending_implementation",
  "blocked"
]);

const allowedVerificationKinds = new Set([
  "static_control",
  "manual_observation",
  "local_observation",
  "dynamic_observation",
  "implementation"
]);

const expectedVerificationKind = new Map([
  ["control_configured", "static_control"],
  ["pass_manual", "manual_observation"],
  ["pass_local", "local_observation"],
  ["pass_dynamic", "dynamic_observation"],
  ["pending_manual", "manual_observation"],
  ["pending_live", "dynamic_observation"],
  ["pending_implementation", "implementation"]
]);

const observedPassStatuses = new Set(["pass_manual", "pass_local", "pass_dynamic"]);
const pendingStatuses = new Set(["pending_live", "pending_manual", "pending_implementation"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const shaPattern = /^[0-9a-f]{40}$/u;

const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;

export function classifyGate(gate) {
  if (gate?.status === "control_configured") return "configured_control";
  if (observedPassStatuses.has(gate?.status)) return "verified_observation";
  if (pendingStatuses.has(gate?.status)) return "pending_requirement";
  if (gate?.status === "blocked") return "blocked_requirement";
  return "invalid";
}

export function getPilotBlockers(contract) {
  return (Array.isArray(contract?.gates) ? contract.gates : []).filter((gate) => {
    if (gate?.blocksPilot !== true) return false;
    return ["pending_requirement", "blocked_requirement"].includes(classifyGate(gate));
  });
}

export function createReadinessValidationContext(root) {
  return {
    evidenceExists: (path) => existsSync(resolve(root, path)),
    actualMigrations: readdirSync(resolve(root, "supabase/migrations"))
      .filter((file) => file.endsWith(".sql") && !file.endsWith(".local.sql"))
      .sort()
      .map((file) => `supabase/migrations/${file}`),
    packageJson: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")),
    matrix: readFileSync(resolve(root, "docs/audit/MATRIZ-QA-v2.31.1.md"), "utf8")
  };
}

export function validateReadinessContract(contract, context) {
  const errors = [];
  const gates = Array.isArray(contract?.gates) ? contract.gates : [];

  if (contract?.schemaVersion !== 2) errors.push("unsupported commercial readiness schema");
  if (contract?.branch !== "refactor/modular-runtime") errors.push("unexpected readiness branch");
  if (!datePattern.test(contract?.updatedAt ?? "")) errors.push("invalid readiness update date");
  if (!Array.isArray(contract?.gates)) errors.push("commercial readiness gates must be an array");

  const ids = new Set();
  for (const gate of gates) {
    if (!gate?.id || ids.has(gate.id)) {
      errors.push(`invalid or duplicate gate id: ${gate?.id ?? "missing"}`);
    } else {
      ids.add(gate.id);
    }

    if (!allowedStatuses.has(gate?.status)) {
      errors.push(`gate ${gate?.id ?? "missing"} has unknown status ${gate?.status}`);
    }

    if (!allowedVerificationKinds.has(gate?.verificationKind)) {
      errors.push(
        `gate ${gate?.id ?? "missing"} has unknown verification kind ${gate?.verificationKind}`
      );
    }

    const expectedKind = expectedVerificationKind.get(gate?.status);
    if (expectedKind && gate?.verificationKind !== expectedKind) {
      errors.push(
        `gate ${gate.id} status ${gate.status} requires verification kind ${expectedKind}`
      );
    }

    if (typeof gate?.blocksPilot !== "boolean") {
      errors.push(`gate ${gate?.id ?? "missing"} must declare blocksPilot`);
    }

    if (!Array.isArray(gate?.evidence) || gate.evidence.length === 0) {
      errors.push(`gate ${gate?.id ?? "missing"} has no evidence`);
    } else {
      for (const evidence of gate.evidence) {
        if (!nonEmptyString(evidence) || !context.evidenceExists(evidence)) {
          errors.push(`gate ${gate.id} references missing evidence: ${evidence}`);
        }
      }
    }

    if (gate?.observedAt !== undefined && !datePattern.test(gate.observedAt)) {
      errors.push(`gate ${gate.id} has malformed observation timestamp`);
    }

    if (gate?.observedAtSha !== undefined && !shaPattern.test(gate.observedAtSha)) {
      errors.push(`gate ${gate.id} has malformed observed SHA`);
    }

    if (observedPassStatuses.has(gate?.status)) {
      if (!datePattern.test(gate?.observedAt ?? "")) {
        errors.push(`observed gate ${gate.id} needs an observation date`);
      }
      if (!nonEmptyString(gate?.observationScope)) {
        errors.push(`observed gate ${gate.id} needs an observation scope`);
      }
    }

    if (gate?.status === "pass_dynamic") {
      if (!nonEmptyString(gate?.dynamicSource)) {
        errors.push(`dynamic observation ${gate.id} needs a dynamic source`);
      }
      if (!shaPattern.test(gate?.observedAtSha ?? "")) {
        errors.push(`dynamic observation ${gate.id} needs an observed SHA`);
      }
    }

    if (gate?.status === "control_configured") {
      if (!nonEmptyString(gate?.dynamicSource)) {
        errors.push(`configured control ${gate.id} needs a dynamic execution source`);
      }
      if (
        gate?.observedAt !== undefined ||
        gate?.observedAtSha !== undefined ||
        gate?.observationScope !== undefined
      ) {
        errors.push(
          `configured control ${gate.id} cannot contain observation metadata or imply a current result`
        );
      }
    }

    if (pendingStatuses.has(gate?.status)) {
      if (gate?.observedAt !== undefined || gate?.observedAtSha !== undefined) {
        errors.push(`pending gate ${gate.id} cannot contain pass observation metadata`);
      }
    }

    if (gate?.status === "blocked" && !nonEmptyString(gate?.reason)) {
      errors.push(`blocked gate ${gate.id} has no reason`);
    }
  }

  const declaredMigrations = contract?.migrationChain?.files ?? [];
  if (JSON.stringify(declaredMigrations) !== JSON.stringify(context.actualMigrations)) {
    errors.push("commercial readiness migration inventory is stale or out of order");
  }

  if (declaredMigrations.some((file) => file.includes("/legacy/") || file.includes("/sources/"))) {
    errors.push("non-executable legacy/source SQL entered the migration chain");
  }

  const bootstrapGate = gates.find((gate) => gate.id === "database-clean-bootstrap");
  if (contract?.migrationChain?.baselineRequired && !contract?.migrationChain?.baselineManifest) {
    if (
      bootstrapGate?.status !== "blocked" ||
      bootstrapGate?.blocksPilot !== true ||
      !nonEmptyString(bootstrapGate?.reason)
    ) {
      errors.push("missing database baseline must remain an explicit pilot blocker");
    }
  }

  if (context.packageJson?.scripts?.["qa:commercial"] !== "node scripts/verify-commercial-readiness.mjs") {
    errors.push("package.json does not expose qa:commercial");
  }

  if (!context.packageJson?.scripts?.ci?.includes("npm run qa:commercial")) {
    errors.push("commercial readiness verification is not part of CI");
  }

  if (!context.packageJson?.scripts?.ci?.includes("npm run qa:database-baseline")) {
    errors.push("database baseline verification is not part of CI");
  }

  for (const marker of [
    "PENDIENTE LIVE",
    "Condiciones del gate de piloto",
    "dos cajas distintas del mismo negocio",
    "baseline SQL ejecutable"
  ]) {
    if (!context.matrix.includes(marker)) {
      errors.push(`QA matrix is missing marker: ${marker}`);
    }
  }

  return errors;
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

function runCli() {
  const root = resolve(import.meta.dirname, "..");
  const contract = JSON.parse(
    readFileSync(resolve(root, "contracts/commercial-readiness.json"), "utf8")
  );
  const context = createReadinessValidationContext(root);
  const errors = validateReadinessContract(contract, context);

  for (const error of errors) console.error(`FAIL: ${error}`);
  if (errors.length > 0) process.exit(1);

  const configuredControls = contract.gates.filter(
    (gate) => classifyGate(gate) === "configured_control"
  );
  const observations = contract.gates.filter(
    (gate) => classifyGate(gate) === "verified_observation"
  );
  const blockers = getPilotBlockers(contract);

  pass(`${contract.gates.length} commercial readiness gates have valid schema and evidence references`);
  pass(`${context.actualMigrations.length} reviewed migrations are inventoried in execution order`);
  pass(`${configuredControls.length} automated/static controls are represented as configured controls`);
  pass(`${observations.length} historical observations have explicit verification scope`);
  pass("commercial readiness verification is wired into the repository CI command");
  console.log(
    "INFO: dynamic execution results are external to this versioned contract and are not inferred from evidence files"
  );
  console.log(`INFO: pilot blockers open: ${blockers.length}`);
  for (const gate of blockers) {
    console.log(`PENDING: ${gate.id} (${gate.status})`);
  }
  pass("commercial readiness contract semantics are internally consistent");
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) runCli();
