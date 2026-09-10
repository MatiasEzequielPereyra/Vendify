import {
  createBranch,
  listAdminBranches,
  updateBranch
} from "../branches/branches-service.js";

export interface VendifyBranchesV232Api {
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
  listAdmin: listAdminBranches,
  create: createBranch,
  update: updateBranch
});
