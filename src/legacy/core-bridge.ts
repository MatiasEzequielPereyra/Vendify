import "./auth-bridge.js";
import "./cash-bridge.js";
import "./dashboard-bridge.js";
import "./inventory-bridge.js";
import "./offline-bridge.js";
import "./products-bridge.js";
import "./purchases-bridge.js";
import "./sales-bridge.js";
import "./team-bridge.js";
import { escapeHtml, queryAll, queryOne } from "../core/dom.js";
import { formatArs, productDisplayName } from "../core/format.js";
import { showToast } from "../core/toast.js";

export interface VendifyCoreV232Api {
  readonly queryOne: typeof queryOne;
  readonly queryAll: typeof queryAll;
  readonly escapeHtml: typeof escapeHtml;
  readonly formatArs: typeof formatArs;
  readonly productDisplayName: typeof productDisplayName;
  readonly showToast: typeof showToast;
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
  showToast
});
