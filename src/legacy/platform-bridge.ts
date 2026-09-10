import { isPlatformAdmin, loadPlatformBackoffice, updateBusinessPlan } from "../platform/platform-service.js";

declare global {
  interface Window {
    VendifyPlatformV232?: {
      readonly isAdmin: typeof isPlatformAdmin;
      readonly loadBackoffice: typeof loadPlatformBackoffice;
      readonly updatePlan: typeof updateBusinessPlan;
    };
  }
}

window.VendifyPlatformV232 = Object.freeze({
  isAdmin: isPlatformAdmin,
  loadBackoffice: loadPlatformBackoffice,
  updatePlan: updateBusinessPlan
});
