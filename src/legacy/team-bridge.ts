import {
  getAdminBusiness,
  listTeam,
  setMemberActive,
  updateMemberRole,
  updateStockPermission
} from "../team/team-service.js";

export interface VendifyTeamV232Api {
  readonly getAdminBusiness: typeof getAdminBusiness;
  readonly listTeam: typeof listTeam;
  readonly updateStockPermission: typeof updateStockPermission;
  readonly updateMemberRole: typeof updateMemberRole;
  readonly setMemberActive: typeof setMemberActive;
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
  setMemberActive
});
