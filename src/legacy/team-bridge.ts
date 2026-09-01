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

export interface VendifyTeamV232Api {
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
