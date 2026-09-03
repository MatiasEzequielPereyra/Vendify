import {
  getAdminBusiness,
  listTeam,
  setMemberActive,
  updateMemberRole,
  updateStockPermission
} from "../team/team-service.js";
import {
  createEmployee,
  deleteEmployee,
  resetEmployeePassword,
  updateEmployee
} from "../team/team-edge-service.js";
import { createTeamController } from "../team/team-controller.js";

export interface VendifyTeamV232Api {
  readonly createController: typeof createTeamController;
  readonly getAdminBusiness: typeof getAdminBusiness;
  readonly listTeam: typeof listTeam;
  readonly updateStockPermission: typeof updateStockPermission;
  readonly updateMemberRole: typeof updateMemberRole;
  readonly setMemberActive: typeof setMemberActive;
  readonly createEmployee: typeof createEmployee;
  readonly updateEmployee: typeof updateEmployee;
  readonly deleteEmployee: typeof deleteEmployee;
  readonly resetEmployeePassword: typeof resetEmployeePassword;
}

declare global {
  interface Window {
    VendifyTeamV232?: VendifyTeamV232Api;
  }
}

window.VendifyTeamV232 = Object.freeze({
  createController: createTeamController,
  getAdminBusiness,
  listTeam,
  updateStockPermission,
  updateMemberRole,
  setMemberActive,
  createEmployee,
  updateEmployee,
  deleteEmployee,
  resetEmployeePassword
});
