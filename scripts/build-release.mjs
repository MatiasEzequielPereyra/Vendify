import { resolve } from "node:path";
import {
  loadProductionReleaseContract,
  materializeProductionRelease
} from "./production-release-baseline.mjs";

const root = resolve(import.meta.dirname, "..");

try {
  const contract = loadProductionReleaseContract(root);
  const result = materializeProductionRelease({ root, contract });

  console.log("Baseline production release created in dist/");
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
