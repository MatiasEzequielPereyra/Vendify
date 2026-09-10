import {
  exportOperationalBackup,
  getCommercialOnboarding,
  getCurrentPlan,
  getOperationalConfig,
  saveOperationalConfig
} from "../commercial/commercial-service.js";

export interface VendifyCommercialV232Api {
  readonly getOnboarding: typeof getCommercialOnboarding;
  readonly getPlan: typeof getCurrentPlan;
  readonly getOperationalConfig: typeof getOperationalConfig;
  readonly saveOperationalConfig: typeof saveOperationalConfig;
  readonly exportBackup: typeof exportOperationalBackup;
}

declare global {
  interface Window { VendifyCommercialV232?: VendifyCommercialV232Api; }
}

window.VendifyCommercialV232 = Object.freeze({
  getOnboarding: getCommercialOnboarding,
  getPlan: getCurrentPlan,
  getOperationalConfig,
  saveOperationalConfig,
  exportBackup: exportOperationalBackup
});
