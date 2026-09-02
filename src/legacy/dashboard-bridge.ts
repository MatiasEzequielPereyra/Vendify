import {
  loadDashboard,
  loadOperationalAlerts
} from "../dashboard/dashboard-service.js";

export interface VendifyDashboardV232Api {
  readonly loadDashboard: typeof loadDashboard;
  readonly loadOperationalAlerts: typeof loadOperationalAlerts;
}

declare global {
  interface Window {
    VendifyDashboardV232?: VendifyDashboardV232Api;
  }
}

window.VendifyDashboardV232 = Object.freeze({
  loadDashboard,
  loadOperationalAlerts
});
