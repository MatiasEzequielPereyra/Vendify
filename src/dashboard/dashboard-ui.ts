import { escapeHtml, type HtmlEscapable } from "../core/dom.js";

export type DashboardRow = Record<string, unknown>;

export function dashboardRows(value: unknown): DashboardRow[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (item): item is DashboardRow => typeof item === "object" && item !== null && !Array.isArray(item)
  );
}

export function dashboardEmpty(text: HtmlEscapable): string {
  return `<div class="dashboard-empty-v231">${escapeHtml(text)}</div>`;
}

export function renderDashboardRows(
  container: Element | null,
  rows: unknown,
  renderRow: (row: DashboardRow, index: number) => string,
  emptyText: string
): void {
  if (!container) return;

  const records = dashboardRows(rows);
  container.innerHTML = records.length
    ? records.map(renderRow).join("")
    : dashboardEmpty(emptyText);
}
