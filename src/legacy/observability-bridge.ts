import {
  logClientError,
  sanitizeClientErrorMessage
} from "../observability/error-log-service.js";

export interface VendifyObservabilityV232Api {
  readonly logClientError: typeof logClientError;
  readonly sanitizeClientErrorMessage: typeof sanitizeClientErrorMessage;
}

declare global {
  interface Window {
    VendifyObservabilityV232?: VendifyObservabilityV232Api;
  }
}

window.VendifyObservabilityV232 = Object.freeze({
  logClientError,
  sanitizeClientErrorMessage
});
