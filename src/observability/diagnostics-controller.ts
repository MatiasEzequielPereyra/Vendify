import { escapeHtml, queryOne } from "../core/dom.js";

export interface DiagnosticsControllerDependencies {
  readonly getRole: () => string | null | undefined;
  readonly isOnline: () => boolean;
  readonly getBranchName: () => string | null | undefined;
  readonly getCashRegisterName: () => string | null | undefined;
  readonly runDiagnostic: () => Promise<unknown>;
  readonly showToast: (message: string, type: "error") => void;
  readonly getElement?: (selector: string) => Element | null;
}

export interface DiagnosticsController {
  readonly setup: () => void;
  readonly open: () => void;
  readonly close: () => void;
  readonly run: () => Promise<void>;
}

type DiagnosticRow = Record<string, unknown>;
type DiagnosticSeverity = "critical" | "warning" | "ok";

const PERMISSION_ERROR =
  "Solo Propietario o Administrador pueden ejecutar diagnósticos";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function diagnosticRows(data: unknown): DiagnosticRow[] {
  if (!isRecord(data) || !Array.isArray(data.issues)) return [];
  return data.issues.filter(isRecord);
}

function normalizeSeverity(value: unknown): DiagnosticSeverity {
  if (
    value === "critical"
    || value === "warning"
    || value === "ok"
  ) {
    return value;
  }

  return "warning";
}

function getErrorMessage(error: unknown): string {
  if (!isRecord(error)) return "Error desconocido";

  const message = error.message;

  if (typeof message === "string" && message) {
    return message;
  }

  return "Error desconocido";
}

function getLegacyTextFallback(
  value: string | null | undefined,
  fallback: string
): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return fallback;
}
function getIssueText(
  value: unknown,
  fallback: string
): string {
  if (typeof value === "string" && value) {
    return value;
  }

  return fallback;
}

function getIssueCount(value: unknown): number {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === "string" && value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

export function createDiagnosticsController(
  dependencies: DiagnosticsControllerDependencies
): DiagnosticsController {
  const getElement = dependencies.getElement ?? queryOne;
  let listenersBound = false;

  const element = (selector: string): Element | null =>
    getElement(selector);

  function open(): void {
    const role = dependencies.getRole();

    if (role !== "owner" && role !== "admin") {
      dependencies.showToast(PERMISSION_ERROR, "error");
      return;
    }

    const connection = element(
      "#diag-connection-v23011"
    ) as HTMLElement | null;

    const branch = element(
      "#diag-branch-v23011"
    ) as HTMLElement | null;

    const cash = element(
      "#diag-cash-v23011"
    ) as HTMLElement | null;

    const summary = element(
      "#diagnostic-summary-v23011"
    ) as HTMLElement | null;

    const issues = element(
      "#diagnostic-issues-v23011"
    ) as HTMLElement | null;

    const modal = element(
      "#modal-diagnostico-v23011"
    ) as HTMLElement | null;

    if (connection) {
      connection.textContent = dependencies.isOnline()
        ? "Online"
        : "Sin conexión";
    }

    const branchName = dependencies.getBranchName();

    if (branch) {
      branch.textContent = getLegacyTextFallback(
        branchName,
        "Sin sucursal"
      );
    }

    const cashRegisterName =
      dependencies.getCashRegisterName();

    if (cash) {
      cash.textContent = getLegacyTextFallback(
        cashRegisterName,
        "Sin caja"
      );
    }

    if (summary) {
      summary.textContent =
        "Ejecutá el diagnóstico para revisar la integridad.";
    }

    if (issues) {
      issues.innerHTML = "";
    }

    modal?.classList.remove("hidden");
  }

  function close(): void {
    (
      element(
        "#modal-diagnostico-v23011"
      ) as HTMLElement | null
    )?.classList.add("hidden");
  }

  function render(data: unknown): void {
    const summary = element(
      "#diagnostic-summary-v23011"
    ) as HTMLElement | null;

    const issues = element(
      "#diagnostic-issues-v23011"
    ) as HTMLElement | null;

    if (!summary || !issues) return;

    const rows = diagnosticRows(data);

    const critical = rows.filter(
      (issue) => issue.severity === "critical"
    ).length;

    const warning = rows.filter(
      (issue) => issue.severity === "warning"
    ).length;

    summary.className =
      `diagnostic-summary-v23011 ${
        critical ? "critical" : warning ? "warning" : "ok"
      }`;

    summary.innerHTML = critical
      ? `<strong>${String(critical)} problema(s) crítico(s)</strong><span>Revisalos antes de continuar operando.</span>`
      : warning
        ? `<strong>${String(warning)} advertencia(s)</strong><span>No bloquean la operación, pero conviene revisarlas.</span>`
        : `<strong>Integridad OK</strong><span>No se detectaron inconsistencias en los controles automáticos.</span>`;

    if (!rows.length) {
      issues.innerHTML = `
        <div class="diagnostic-empty-v23011">
          <svg class="vendify-icon"><use href="#vi-check"></use></svg>
          <span>Sin problemas detectados.</span>
        </div>`;
      return;
    }

    issues.innerHTML = rows
      .map((issue) => {
        const severity = normalizeSeverity(
          issue.severity
        );

        const title = escapeHtml(
          getIssueText(issue.title, "Control")
        );

        const detail = escapeHtml(
          getIssueText(issue.detail, "")
        );

        const count = getIssueCount(issue.count);

        const icon =
          issue.severity === "critical"
            ? "alert"
            : "diagnostic";

        return `
          <article class="diagnostic-issue-v23011 ${severity}">
            <div class="diagnostic-issue-icon-v23011">
              <svg class="vendify-icon"><use href="#vi-${icon}"></use></svg>
            </div>
            <div>
              <strong>${title}</strong>
              <p>${detail}</p>
            </div>
            <span>${String(count)}</span>
          </article>
        `;
      })
      .join("");
  }

  async function run(): Promise<void> {
    const button = element(
      "#btn-run-diagnostic-v23011"
    ) as HTMLButtonElement | null;

    const original = button?.innerHTML;

    if (button) {
      button.disabled = true;
      button.innerHTML = "Ejecutando...";
    }

    try {
      const data = await dependencies.runDiagnostic();
      render(data);
    } catch (error: unknown) {
      const summary = element(
        "#diagnostic-summary-v23011"
      ) as HTMLElement | null;

      if (summary) {
        summary.className =
          "diagnostic-summary-v23011 critical";

        summary.innerHTML =
          `<strong>No se pudo ejecutar el diagnóstico</strong>`
          + `<span>${escapeHtml(getErrorMessage(error))}</span>`;
      }
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = original ?? "";
      }
    }
  }

  function setup(): void {
    if (listenersBound) return;
    listenersBound = true;

    getElement("#btn-diagnostico-v23011")
      ?.addEventListener("click", open);

    getElement("#btn-close-diagnostic-v23011")
      ?.addEventListener("click", close);

    getElement(
      "#modal-diagnostico-v23011 .modal-backdrop"
    )?.addEventListener("click", close);

    getElement("#btn-run-diagnostic-v23011")
      ?.addEventListener("click", () => {
        void run();
      });
  }

  return Object.freeze({
    setup,
    open,
    close,
    run
  });
}
