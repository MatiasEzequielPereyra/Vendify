import { resolve } from "node:path";
import {
  ensureProductionBaselineGitObjects,
  loadProductionReleaseContract
} from "./production-release-baseline.mjs";

const root = resolve(import.meta.dirname, "..");

try {
  const contract = loadProductionReleaseContract(root);
  const verified = ensureProductionBaselineGitObjects(root, contract, {
    remote: "https://github.com/MatiasEzequielPereyra/Vendify.git"
  });

  console.log(
    "Vercel release provenance prepared: " +
      contract.tag +
      " -> " +
      verified.targetCommitSha +
      " (tag object " +
      verified.tagObjectSha +
      ")"
  );
} catch (error) {
  console.error(
    "FAIL: " + (error instanceof Error ? error.message : String(error))
  );
  process.exit(1);
}
