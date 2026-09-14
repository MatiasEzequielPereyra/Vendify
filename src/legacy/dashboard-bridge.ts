import {
  loadDashboard,
  loadOperationalAlerts
} from "../dashboard/dashboard-service.js";
import { createDashboardController } from "../dashboard/dashboard-controller.js";
import { dashboardEmpty, renderDashboardRows } from "../dashboard/dashboard-ui.js";
import { createDashboardNavigationCoordinator } from "../dashboard/dashboard-navigation.js";

export interface VendifyDashboardV232Api {
  readonly loadDashboard: typeof loadDashboard;
  readonly loadOperationalAlerts: typeof loadOperationalAlerts;
  readonly createController: typeof createDashboardController;
  readonly dashboardEmpty: typeof dashboardEmpty;
  readonly renderDashboardRows: typeof renderDashboardRows;
  readonly createNavigationCoordinator: typeof createDashboardNavigationCoordinator;
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
  renderDashboardRows,
  createNavigationCoordinator: createDashboardNavigationCoordinator
});

