import "./auth-bridge.js";
import "./branches-bridge.js";
import "./cash-bridge.js";
import "./dashboard-bridge.js";
import "./inventory-bridge.js";
import "./observability-bridge.js";
import "./offline-bridge.js";
import "./products-bridge.js";
import "./purchases-bridge.js";
import "./sales-bridge.js";
import "./team-bridge.js";
import { escapeHtml, queryAll, queryOne } from "../core/dom.js";
import { formatArs, productDisplayName } from "../core/format.js";
import { showToast } from "../core/toast.js";
import { loadTheme, toggleTheme } from "../core/theme.js";
import { dismissConfirmation, showConfirmation } from "../core/confirm.js";

export interface VendifyCoreV232Api {
  readonly queryOne: typeof queryOne;
  readonly queryAll: typeof queryAll;
  readonly escapeHtml: typeof escapeHtml;
  readonly formatArs: typeof formatArs;
  readonly productDisplayName: typeof productDisplayName;
  readonly showToast: typeof showToast;
  readonly loadTheme: typeof loadTheme;
  readonly toggleTheme: typeof toggleTheme;
  readonly showConfirmation: typeof showConfirmation;
  readonly dismissConfirmation: typeof dismissConfirmation;
}

declare global {
  interface Window {
    VendifyCoreV232?: VendifyCoreV232Api;
  }
}

window.VendifyCoreV232 = Object.freeze({
  queryOne,
  queryAll,
  escapeHtml,
  formatArs,
  productDisplayName,
  showToast,
  loadTheme,
  toggleTheme,
  showConfirmation,
  dismissConfirmation
});
