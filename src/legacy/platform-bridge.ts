import { createPlatformAdminController } from "../platform/platform-admin-controller.js";
import {
  isPlatformAdmin,
  loadPlatformBackoffice,
  updateBusinessPlan
} from "../platform/platform-service.js";

declare global {
  interface Window {
    VendifyPlatformV232?: {
      readonly isAdmin: typeof isPlatformAdmin;
      readonly loadBackoffice: typeof loadPlatformBackoffice;
      readonly updatePlan: typeof updateBusinessPlan;
      readonly createPlatformAdminController: typeof createPlatformAdminController;
    };
  }
}

window.VendifyPlatformV232 = Object.freeze({
  isAdmin: isPlatformAdmin,
  loadBackoffice: loadPlatformBackoffice,
  updatePlan: updateBusinessPlan,
  createPlatformAdminController
});
