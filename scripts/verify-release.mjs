import { resolve } from "node:path";
import {
  loadProductionReleaseContract,
  verifyProductionReleaseArtifact
} from "./production-release-baseline.mjs";

const root = resolve(import.meta.dirname, "..");
const targetArg = process.argv[2] ?? "dist";
const target = resolve(root, targetArg);

try {
  const contract = loadProductionReleaseContract(root);
  const result = verifyProductionReleaseArtifact({
    root,
    target,
    contract
  });

  console.log(
    "PASS: production baseline provenance, inventory and content verified"
  );
  console.log(
    "Source: " +
      contract.tag +
      " -> " +
      result.targetCommitSha +
      " (tag object " +
      result.tagObjectSha +
      ")"
  );
  console.log(
    "Production release digest SHA-256: " + result.digest
  );
} catch (error) {
  console.error(
    "FAIL: " + (error instanceof Error ? error.message : String(error))
  );
  process.exit(1);
}
