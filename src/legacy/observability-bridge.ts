import {
  logClientError,
  sanitizeClientErrorMessage
} from "../observability/error-log-service.js";
import {
  createDiagnosticsController
} from "../observability/diagnostics-controller.js";

export interface VendifyObservabilityV232Api {
  readonly logClientError: typeof logClientError;
  readonly sanitizeClientErrorMessage: typeof sanitizeClientErrorMessage;
  readonly createDiagnosticsController: typeof createDiagnosticsController;
}

declare global {
  interface Window {
    VendifyObservabilityV232?: VendifyObservabilityV232Api;
  }
}

window.VendifyObservabilityV232 = Object.freeze({
  logClientError,
  sanitizeClientErrorMessage,
  createDiagnosticsController
});
