export type HtmlEscapable = string | number | boolean | null | undefined;

export function queryOne(
  selector: string,
  root: ParentNode = document
): Element | null {
  return root.querySelector(selector);
}

export function queryAll(
  selector: string,
  root: ParentNode = document
): NodeListOf<Element> {
  return root.querySelectorAll(selector);
}

export function escapeHtml(value: HtmlEscapable): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
