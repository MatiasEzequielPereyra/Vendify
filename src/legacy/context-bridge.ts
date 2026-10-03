import { createContextPickerController } from "../context/context-picker-controller.js";
import {
  getAppContext,
  getBranchContext,
  getCurrentEmployeeProfile,
  getCustomPermissions,
  listAppBranches,
  runIntegrityDiagnostic
} from "../context/context-service.js";

export interface VendifyContextV232Api {
  readonly getApp: typeof getAppContext;
  readonly getPermissions: typeof getCustomPermissions;
  readonly getEmployee: typeof getCurrentEmployeeProfile;
  readonly listBranches: typeof listAppBranches;
  readonly getBranch: typeof getBranchContext;
  readonly runDiagnostic: typeof runIntegrityDiagnostic;
  readonly createContextPickerController: typeof createContextPickerController;
}

declare global {
  interface Window {
    VendifyContextV232?: VendifyContextV232Api;
  }
}

window.VendifyContextV232 = Object.freeze({
  getApp: getAppContext,
  getPermissions: getCustomPermissions,
  getEmployee: getCurrentEmployeeProfile,
  listBranches: listAppBranches,
  getBranch: getBranchContext,
  runDiagnostic: runIntegrityDiagnostic,
  createContextPickerController
});
