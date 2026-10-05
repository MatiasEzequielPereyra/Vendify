import { createActiveBranchController } from "../branches/active-branch-controller.js";
import { createBranchAdministrationController } from "../branches/branch-administration-controller.js";
import {
  createBranch,
  listAdminBranches,
  updateBranch
} from "../branches/branches-service.js";

export interface VendifyBranchesV232Api {
  readonly createActiveBranchController: typeof createActiveBranchController;
  readonly createBranchAdministrationController: typeof createBranchAdministrationController;
  readonly listAdmin: typeof listAdminBranches;
  readonly create: typeof createBranch;
  readonly update: typeof updateBranch;
}

declare global {
  interface Window {
    VendifyBranchesV232?: VendifyBranchesV232Api;
  }
}

window.VendifyBranchesV232 = Object.freeze({
  createActiveBranchController,
  createBranchAdministrationController,
  listAdmin: listAdminBranches,
  create: createBranch,
  update: updateBranch
});