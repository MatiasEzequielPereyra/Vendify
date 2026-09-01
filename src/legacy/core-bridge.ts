import { escapeHtml, queryAll, queryOne } from "../core/dom.js";
import { formatArs, productDisplayName } from "../core/format.js";

export interface VendifyCoreV232Api {
  readonly queryOne: typeof queryOne;
  readonly queryAll: typeof queryAll;
  readonly escapeHtml: typeof escapeHtml;
  readonly formatArs: typeof formatArs;
  readonly productDisplayName: typeof productDisplayName;
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
  productDisplayName
});
