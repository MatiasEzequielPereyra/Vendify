import {
  loadDashboard,
  loadOperationalAlerts
} from "../dashboard/dashboard-service.js";
import { createDashboardController } from "../dashboard/dashboard-controller.js";
import { dashboardEmpty, renderDashboardRows } from "../dashboard/dashboard-ui.js";

export interface VendifyDashboardV232Api {
  readonly loadDashboard: typeof loadDashboard;
  readonly loadOperationalAlerts: typeof loadOperationalAlerts;
  readonly createController: typeof createDashboardController;
  readonly dashboardEmpty: typeof dashboardEmpty;
  readonly renderDashboardRows: typeof renderDashboardRows;
}

declare global {
  interface Window {
    VendifyDashboardV232?: VendifyDashboardV232Api;
  }
}

window.VendifyDashboardV232 = Object.freeze({
  loadDashboard,
  loadOperationalAlerts,
  createController: createDashboardController,
  dashboardEmpty,
  renderDashboardRows
});
